/**
 * Persistent (ledger-backed) team backend for the orchestration approval plane.
 *
 * `createSophiaPersistentBackend` builds the `TeamBackend` that materializes an
 * owner-approved plan into an `AgentTeamLedger` team: one Channel named after
 * the approved goal, one Agent Member per `plan.members`, and one Task per
 * `plan.tasks`. All ledger mutations are submitted with the Human actor —
 * `agentTeamHumanActor()` (ledger identity `AGENT_TEAM_HUMAN_MEMBER_ID`).
 *
 * SEMANTICS —「主人批准后代为提交」(design §4.8 point 3): this backend runs only
 * after the owner has approved the request; it then commits the approved plan
 * into the ledger ON THE HUMAN's behalf, exactly as approved. This is NOT a
 * permission bypass: the ledger's `assertHumanActor` still requires the durable
 * Human identity (`member:human`), and every operation is attributed to it and
 * becomes part of the audit trail. The backend supplies no authority of its
 * own — it is a deterministic projection of one approved `ApprovalRequest` onto
 * the ledger's public surface.
 *
 * KNOWN LIMITATIONS (reported to the Lead; ledger.ts stays untouched):
 * - `AgentTeamTask` carries no `assignee` / `decidedBy` fields: "decided by the
 *   Human" is evidenced by the Human sender on the task-creating message, and a
 *   planned `assignee` (matched by member name) is approximated via the message
 *   `recipients` (the assignee's inbox references the task).
 * - A ledger Channel has `createdAtSequence` (an operation sequence, not an
 *   epoch), so `TeamSummary.createdAt` is captured at materialization time in a
 *   closure map and falls back to `0` after a host restart.
 * - Every create call uses deterministic requestIds derived from the approval
 *   request id, so un-awaited retries resolve idempotently inside the ledger.
 */
import type { AgentTeamAgentMember, AgentTeamAgentMemberStatus, AgentTeamChannel, AgentTeamChannelRef, AgentTeamMemberId, AgentTeamRequestId } from './types/entities.ts'
import type {
  AgentTeamAddMemberRequest,
  AgentTeamAddMemberResult,
  AgentTeamCreateChannelRequest,
  AgentTeamCreateChannelResult,
  AgentTeamSendMessageRequest,
  AgentTeamSendMessageResult,
  AgentTeamRemoveMemberRequest,
  AgentTeamRemoveMemberResult,
  AgentTeamView,
  AgentTeamViewRequest,
} from './types/requests-results.ts'
import type {
  ApprovalRequest,
  MaterializeResult,
  PlannedMember,
  TeamBackend,
  TeamMemberRow,
  TeamSummary,
} from 'dsh-sophia-entities/orchestration'

/** Brand derivation keeps this file to relative imports + the orchestration type import. */
type WorkspaceId = AgentTeamAgentMember['workspaceId']
type ReasoningEffortId = NonNullable<NonNullable<AgentTeamAgentMember['model']>['reasoningEffort']>

/**
 * Structural narrow pick of the `AgentTeam` host's public surface, so the
 * orchestration plane drives the backend with the live host instance (from
 * `exec.agent.ctx.get('agentTeam')`) instead of the private `AgentTeamLedger`.
 * Every mutating method forces the Human actor internally
 * (`agentTeamHumanActor()`), preserving the「主人批准后代为提交」semantics without
 * the backend supplying an actor. `addMember` returns the host-generated
 * member (memberId/sessionId/privateMemoryPath come from the host), which the
 * backend uses to map planned handles to memberIds.
 */
export interface PersistentHostAPI {
  readonly createChannel: (request: AgentTeamCreateChannelRequest) => Promise<AgentTeamCreateChannelResult>
  readonly addMember: (request: AgentTeamAddMemberRequest) => Promise<AgentTeamAddMemberResult>
  readonly sendMessage: (request: AgentTeamSendMessageRequest) => Promise<AgentTeamSendMessageResult>
  /** Synchronous Human-facing projection; used for reads only, never mutation. */
  readonly view: (request: AgentTeamViewRequest) => AgentTeamView
  /**
   * Durable Member rows across the workspace. Optional so a host build that
   * only implements the mutating surface still runs — row rendering then falls
   * back to the channel's `memberCount`.
   *
   * READ-ONLY, and the reason the panel can draw real member rows: a Channel
   * membership fact carries ids only (`{ channelRef, memberId }`), so the
   * display `handle` and `description` — the two strings the client matches OC
   * artwork against — can only come from here.
   */
  readonly members?: () => readonly AgentTeamAgentMemberStatus[]
  /**
   * Irreversibly remove one Member, so its handle becomes available again.
   *
   * WHY THE PLUGIN NEEDS THIS: handle uniqueness is enforced against every
   * member that is not `inactive` AND still participates in the workspace, so
   * archiving a member (`state: 'archived'`) does NOT free its name. A team that
   * came up short therefore poisons every handle it managed to create, and no
   * later attempt can reuse those posts — only a real removal clears the name.
   *
   * The host wires this from `AgentTeam.removeMember`; unlike `archiveMember`
   * that method carries no `@Remote` decorator (it is intentionally kept off the
   * client surface), so the plugin calls it server-side through the live service
   * instance. Optional so a host build without it still runs: the backend then
   * reports that removal is unavailable instead of pretending to free the name.
   */
  readonly removeMember?: (request: AgentTeamRemoveMemberRequest) => Promise<AgentTeamRemoveMemberResult>
}

export interface SophiaPersistentBackendDeps {
  /** The live `AgentTeam` host instance, narrowed to the backend's structural needs. */
  readonly host: PersistentHostAPI
  /** The workspace the materialized team lives in (matches the channel workspace so member participation seeds correctly). */
  readonly workspaceId: string
}

/** Display-name budget for the materialized Channel (board: goal truncated to ~80 chars). */
const CHANNEL_NAME_MAX = 80

/**
 * The host's own roster cap, which it enforces with
 * `Team member limit ${maxMembers} reached` (code `TEAM_MEMBER_LIMIT`,
 * `@deepseek-ai/dsh-experimental-agent-team`). The cap is a CONSTRUCTOR
 * argument there, so it is not readable from the service — the only signal we
 * ever get is this throw, at whatever member index happened to cross it.
 */
const HOST_MEMBER_LIMIT = /Team member limit (\d+) reached/

/**
 * Turn the host's bare roster-cap rejection into something the owner can act on.
 *
 * The host counts only AI members, so the Human owner is not part of the
 * number, and its message names neither the plan size nor which knob to turn.
 * Since a 20-post organisation (the 钦天监 tree) is well past the shipped
 * default of 8, this is the difference between 「改哪里？」 and a clear fix.
 * @param error - whatever `addMember` threw.
 * @param planned - how many members the approved plan asked for.
 * @param index - the zero-based index that failed.
 * @param handle - the member name that failed.
 * @returns the original error when it is not the roster cap, else a wrapped one.
 */
function memberLimitError(error: unknown, planned: number, index: number, handle: string): unknown {
  const match = HOST_MEMBER_LIMIT.exec(error instanceof Error ? error.message : String(error))
  if (match === null) return error
  const cap = match[1] ?? '?'
  return new Error(
    `这次计划的 ${planned} 名成员超出了宿主 agent-team 插件的成员上限（${cap}）：`
    + `第 ${index + 1} 名「${handle}」被拒绝。`
    + `宿主只统计 AI 成员，主人本人不计入。`
    + `请在自己的 profile 里把上限调高后再批准，例如在 cordis.patch.yml 加：\n`
    + `- id: agent-team\n  name: "@deepseek-ai/dsh-experimental-agent-team"\n`
    + `  config:\n    maxMembers: ${planned}`,
  )
}

/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/**
 * Create the persistent backend bound to one host + workspace.
 *
 * `describe`/`list` resolve teams through `host.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export function createSophiaPersistentBackend(deps: SophiaPersistentBackendDeps): TeamBackend {
  const workspaceId = deps.workspaceId as WorkspaceId
  /** Epoch of each materialized team, recorded at create time (channels expose only a sequence). */
  const createdAtByChannel = new Map<AgentTeamChannelRef, number>()
  const requestId = (stamp: string): AgentTeamRequestId => stamp as AgentTeamRequestId

  const summary = (channel: AgentTeamChannel, memberCount: number, taskCount: number, teamWorkspaceId: WorkspaceId = workspaceId): TeamSummary =>
    Object.freeze({
      mode: 'persistent' as const,
      teamId: `${teamWorkspaceId}/${channel.channelRef}`,
      name: channel.name,
      memberCount,
      taskCount,
      createdAt: createdAtByChannel.get(channel.channelRef) ?? 0,
    })

  return Object.freeze({
    mode: 'persistent' as const,

    async create(_ctx: unknown, request: ApprovalRequest): Promise<MaterializeResult> {
      // 1) Channel first: the durable team identity; no initial members (each
      //    planned member is added explicitly so participation seeds to this
      //    workspace).
      const channelResult = await deps.host.createChannel({
        requestId: requestId(`persistent:channel:${request.id}`),
        workspaceId,
        name: truncateText(request.goal, CHANNEL_NAME_MAX),
        description: request.goal,
        memberIds: [],
      })
      const channel = channelResult.channel
      createdAtByChannel.set(channel.channelRef, Date.now())

      // 2) Members: the host provisions one ledger Agent Member per planned
      //    member — it generates the member identity (memberId/sessionId/
      //    privateMemoryPath) and seeds the creation Workspace participation.
      //    Model selection is taken from the plan; the returned stored member
      //    (handle → memberId) keys the assignee map below.
      const memberIdByHandle = new Map<string, AgentTeamMemberId>()
      for (const [index, planned] of request.plan.members.entries()) {
        const model = planned.provider === undefined || planned.model === undefined ? undefined
          : Object.freeze({
              provider: planned.provider,
              model: planned.model,
              ...(planned.reasoningEffort === undefined ? {} : { reasoningEffort: planned.reasoningEffort as ReasoningEffortId }),
            })
        let memberResult: AgentTeamAddMemberResult
        try {
          memberResult = await deps.host.addMember({
            requestId: requestId(`persistent:member:${request.id}:${index}`),
            workspaceId,
            handle: planned.name,
            description: planned.role ?? '',
            presetId: 'team-member',
            ...(model === undefined ? {} : { model }),
            channelRefs: Object.freeze([channel.channelRef]),
          })
        } catch (error: unknown) {
          throw memberLimitError(error, request.plan.members.length, index, planned.name)
        }
        const stored = memberResult.status.member
        memberIdByHandle.set(stored.handle, stored.memberId)
      }

      // 3) Tasks: one atomic Message+Thread+Task('todo') per planned task, so
      //    every task is durable, sequential and owned by a Thread. The task
      //    decision is attributed to the Human sender; the assignee (matched by
      //    member name) follows the task through its inbox via `recipients`.
      for (const planned of request.plan.tasks) {
        const subject = planned.subject.trim()
        const assigneeMemberId = planned.assignee === undefined ? undefined : memberIdByHandle.get(planned.assignee)
        await deps.host.sendMessage({
          requestId: requestId(`persistent:task:${request.id}:${planned.id}`),
          workspaceId,
          channelRef: channel.channelRef,
          body: subject === '' ? planned.id : subject,
          ...(assigneeMemberId === undefined ? {} : { recipients: Object.freeze([assigneeMemberId]) }),
          asTask: true,
        })
      }

      return Object.freeze({
        mode: 'persistent' as const,
        teamRef: `${workspaceId}/${channel.channelRef}`,
        teamName: channel.name,
        detail: `ledger team materialized from approval '${request.id}'`,
      })
    },

    async describe(_ctx: unknown, teamRef: string): Promise<TeamSummary | undefined> {
      const slash = teamRef.lastIndexOf('/')
      const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash) as WorkspaceId
      const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1)) as AgentTeamChannelRef
      const view = deps.host.view({ workspaceId: resolvedWorkspace })
      const channel = view.channels.find(candidate => candidate.channelRef === channelRef)
      if (channel === undefined) return undefined
      return summary(
        channel,
        view.members.filter(membership => membership.channelRef === channelRef).length,
        view.tasks.filter(task => task.channelRef === channelRef).length,
      )
    },

    async list(_ctx: unknown): Promise<TeamSummary[]> {
      const view = deps.host.view({ workspaceId })
      return view.channels.map(channel => summary(
        channel,
        view.members.filter(membership => membership.channelRef === channel.channelRef).length,
        view.tasks.filter(task => task.channelRef === channel.channelRef).length,
      ))
    },

    /**
     * Per-row members of one Channel, so the activity panel can draw real rows
     * (with OC artwork) instead of the two-number volume card.
     *
     * Two ledger projections have to be joined: `view.members` says WHO is in
     * the channel (`{ channelRef, memberId }` only), and `host.members()` says
     * what each of them is CALLED (`handle`, `description`, `state`). Neither
     * alone is enough — that is exactly why the first-stage canary returned an
     * empty array.
     *
     * `role` is filled from the member's `description`, which the backend writes
     * from `planned.role` at materialization, so the planned role text survives
     * verbatim and `memberArtUrl(name, role)` can still find the portrait. A
     * host without the optional `members()` reader gets an empty list rather
     * than fabricated rows.
     */
    async membersOf(_ctx: unknown, teamRef: string): Promise<readonly TeamMemberRow[]> {
      if (deps.host.members === undefined) return Object.freeze([])
      const slash = teamRef.lastIndexOf('/')
      const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash) as WorkspaceId
      const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1)) as AgentTeamChannelRef
      const view = deps.host.view({ workspaceId: resolvedWorkspace })
      const inChannel = new Set(
        view.members
          .filter(membership => membership.channelRef === channelRef)
          .map(membership => membership.memberId as string),
      )
      if (inChannel.size === 0) return Object.freeze([])
      const rows = deps.host.members()
        .filter(status => inChannel.has(status.member.memberId as string))
        .map(status => Object.freeze({
          id: status.member.memberId as string,
          name: status.member.handle,
          role: status.member.description,
          state: status.member.state,
          ...(status.member.model === undefined ? {} : { model: status.member.model.model }),
        }))
      return Object.freeze(rows)
    },

    /**
     * Staff one more member into an existing Channel.
     *
     * The plan rosters a team once, so a team that came up short (the host
     * refused a name, someone was retired again) had no way to be completed —
     * and rebuilding it is impossible, because the first attempt already holds
     * every handle it created. This closes that gap.
     *
     * The member is attached to the team's own Channel, so `membersOf` and the
     * activity panel see the new row immediately and the planned `role` text
     * still selects the OC portrait.
     */
    async addMember(_ctx: unknown, teamRef: string, member: PlannedMember): Promise<TeamMemberRow> {
      const slash = teamRef.lastIndexOf('/')
      const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash) as WorkspaceId
      const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1)) as AgentTeamChannelRef
      const model = member.provider === undefined || member.model === undefined ? undefined
        : Object.freeze({
            provider: member.provider,
            model: member.model,
            ...(member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort as ReasoningEffortId }),
          })
      // A unique stamp per call: re-adding the same name after a removal is a
      // legitimate second attempt, so the id must not be derived from the name
      // alone or the ledger would treat it as a duplicate request.
      const stamp = `${channelRef}:${member.name}:${Date.now().toString(36)}`
      let result: AgentTeamAddMemberResult
      try {
        result = await deps.host.addMember({
          requestId: requestId(`persistent:add:${stamp}`),
          workspaceId: resolvedWorkspace,
          handle: member.name,
          description: member.role ?? '',
          presetId: 'team-member',
          ...(model === undefined ? {} : { model }),
          channelRefs: Object.freeze([channelRef]),
        })
      } catch (error: unknown) {
        // One added member is never a roster-cap overflow, but the host's cap is
        // a constructor value we cannot read, so surface the same actionable
        // message when the cap is what refused it.
        throw memberLimitError(error, 1, 0, member.name)
      }
      const stored = result.status.member
      return Object.freeze({
        id: stored.memberId as string,
        name: stored.handle,
        role: stored.description,
        state: stored.state,
        ...(stored.model === undefined ? {} : { model: stored.model.model }),
      })
    },

    /**
     * Retire one member by HANDLE, so its name can be used again.
     *
     * Callers speak in handles (that is what the owner sees and what the plan
     * wrote), while the host removes by `memberId`, so the name is resolved
     * through the same roster read `membersOf` uses. Refusing on an unknown or
     * ambiguous name is deliberate: silently removing the wrong member would be
     * far worse than an error the caller can act on.
     *
     * A removal that leaves the member in other Channels is not possible here —
     * the host removes the member from the ledger entirely.
     */
    async removeMember(_ctx: unknown, teamRef: string, memberName: string): Promise<TeamMemberRow> {
      if (deps.host.members === undefined || deps.host.removeMember === undefined) {
        throw new Error(
          '这个宿主版本没有暴露移除成员的能力（AgentTeam.removeMember 未接线），'
          + '所以无法释放「' + memberName + '」这个名字。',
        )
      }
      const slash = teamRef.lastIndexOf('/')
      const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash) as WorkspaceId
      const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1)) as AgentTeamChannelRef
      const view = deps.host.view({ workspaceId: resolvedWorkspace })
      const inChannel = new Set(
        view.members
          .filter(membership => membership.channelRef === channelRef)
          .map(membership => membership.memberId as string),
      )
      const matched = deps.host.members()
        .filter(status => inChannel.has(status.member.memberId as string) && status.member.handle === memberName)
      if (matched.length === 0) {
        throw new Error(`队伍里没有叫「${memberName}」的成员，无法移除。`)
      }
      if (matched.length > 1) {
        throw new Error(`队伍里有 ${matched.length} 个叫「${memberName}」的成员，名字不唯一，无法确定移除哪一个。`)
      }
      const target = matched[0]!.member
      const result = await deps.host.removeMember({
        requestId: requestId(`persistent:remove:${target.memberId}:${Date.now().toString(36)}`),
        memberId: target.memberId,
      })
      const removed = result.member
      return Object.freeze({
        id: removed.memberId as string,
        name: removed.handle,
        role: removed.description,
        state: removed.state,
        ...(removed.model === undefined ? {} : { model: removed.model.model }),
      })
    },
  })
}