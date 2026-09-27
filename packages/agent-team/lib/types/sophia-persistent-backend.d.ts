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
import type { AgentTeamAgentMemberStatus } from './types/entities.ts';
import type { AgentTeamAddMemberRequest, AgentTeamAddMemberResult, AgentTeamCreateChannelRequest, AgentTeamCreateChannelResult, AgentTeamSendMessageRequest, AgentTeamSendMessageResult, AgentTeamView, AgentTeamViewRequest } from './types/requests-results.ts';
import type { TeamBackend } from 'dsh-sophia-entities/orchestration';
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
    readonly createChannel: (request: AgentTeamCreateChannelRequest) => Promise<AgentTeamCreateChannelResult>;
    readonly addMember: (request: AgentTeamAddMemberRequest) => Promise<AgentTeamAddMemberResult>;
    readonly sendMessage: (request: AgentTeamSendMessageRequest) => Promise<AgentTeamSendMessageResult>;
    /** Synchronous Human-facing projection; used for reads only, never mutation. */
    readonly view: (request: AgentTeamViewRequest) => AgentTeamView;
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
    readonly members?: () => readonly AgentTeamAgentMemberStatus[];
}
export interface SophiaPersistentBackendDeps {
    /** The live `AgentTeam` host instance, narrowed to the backend's structural needs. */
    readonly host: PersistentHostAPI;
    /** The workspace the materialized team lives in (matches the channel workspace so member participation seeds correctly). */
    readonly workspaceId: string;
}
/**
 * Create the persistent backend bound to one host + workspace.
 *
 * `describe`/`list` resolve teams through `host.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export declare function createSophiaPersistentBackend(deps: SophiaPersistentBackendDeps): TeamBackend;
//# sourceMappingURL=sophia-persistent-backend.d.ts.map