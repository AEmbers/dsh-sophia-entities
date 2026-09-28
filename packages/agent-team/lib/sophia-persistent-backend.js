/** Display-name budget for the materialized Channel (board: goal truncated to ~80 chars). */
const CHANNEL_NAME_MAX = 80;
/**
 * The host's own roster cap, which it enforces with
 * `Team member limit ${maxMembers} reached` (code `TEAM_MEMBER_LIMIT`,
 * `@deepseek-ai/dsh-experimental-agent-team`). The cap is a CONSTRUCTOR
 * argument there, so it is not readable from the service — the only signal we
 * ever get is this throw, at whatever member index happened to cross it.
 */
const HOST_MEMBER_LIMIT = /Team member limit (\d+) reached/;
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
function memberLimitError(error, planned, index, handle) {
    const match = HOST_MEMBER_LIMIT.exec(error instanceof Error ? error.message : String(error));
    if (match === null)
        return error;
    const cap = match[1] ?? '?';
    return new Error(`这次计划的 ${planned} 名成员超出了宿主 agent-team 插件的成员上限（${cap}）：`
        + `第 ${index + 1} 名「${handle}」被拒绝。`
        + `宿主只统计 AI 成员，主人本人不计入。`
        + `请在自己的 profile 里把上限调高后再批准，例如在 cordis.patch.yml 加：\n`
        + `- id: agent-team\n  name: "@deepseek-ai/dsh-experimental-agent-team"\n`
        + `  config:\n    maxMembers: ${planned}`);
}
/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text, max) {
    const points = [...text];
    return points.length <= max ? text : points.slice(0, max).join('');
}
/**
 * Create the persistent backend bound to one host + workspace.
 *
 * `describe`/`list` resolve teams through `host.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export function createSophiaPersistentBackend(deps) {
    const workspaceId = deps.workspaceId;
    /** Epoch of each materialized team, recorded at create time (channels expose only a sequence). */
    const createdAtByChannel = new Map();
    const requestId = (stamp) => stamp;
    const summary = (channel, memberCount, taskCount, teamWorkspaceId = workspaceId) => Object.freeze({
        mode: 'persistent',
        teamId: `${teamWorkspaceId}/${channel.channelRef}`,
        name: channel.name,
        memberCount,
        taskCount,
        createdAt: createdAtByChannel.get(channel.channelRef) ?? 0,
    });
    return Object.freeze({
        mode: 'persistent',
        async create(_ctx, request) {
            // 1) Channel first: the durable team identity; no initial members (each
            //    planned member is added explicitly so participation seeds to this
            //    workspace).
            const channelResult = await deps.host.createChannel({
                requestId: requestId(`persistent:channel:${request.id}`),
                workspaceId,
                name: truncateText(request.goal, CHANNEL_NAME_MAX),
                description: request.goal,
                memberIds: [],
            });
            const channel = channelResult.channel;
            createdAtByChannel.set(channel.channelRef, Date.now());
            // 2) Members: the host provisions one ledger Agent Member per planned
            //    member — it generates the member identity (memberId/sessionId/
            //    privateMemoryPath) and seeds the creation Workspace participation.
            //    Model selection is taken from the plan; the returned stored member
            //    (handle → memberId) keys the assignee map below.
            const memberIdByHandle = new Map();
            for (const [index, planned] of request.plan.members.entries()) {
                const model = planned.provider === undefined || planned.model === undefined ? undefined
                    : Object.freeze({
                        provider: planned.provider,
                        model: planned.model,
                        ...(planned.reasoningEffort === undefined ? {} : { reasoningEffort: planned.reasoningEffort }),
                    });
                let memberResult;
                try {
                    memberResult = await deps.host.addMember({
                        requestId: requestId(`persistent:member:${request.id}:${index}`),
                        workspaceId,
                        handle: planned.name,
                        description: planned.role ?? '',
                        presetId: 'team-member',
                        ...(model === undefined ? {} : { model }),
                        channelRefs: Object.freeze([channel.channelRef]),
                    });
                }
                catch (error) {
                    throw memberLimitError(error, request.plan.members.length, index, planned.name);
                }
                const stored = memberResult.status.member;
                memberIdByHandle.set(stored.handle, stored.memberId);
            }
            // 3) Tasks: one atomic Message+Thread+Task('todo') per planned task, so
            //    every task is durable, sequential and owned by a Thread. The task
            //    decision is attributed to the Human sender; the assignee (matched by
            //    member name) follows the task through its inbox via `recipients`.
            for (const planned of request.plan.tasks) {
                const subject = planned.subject.trim();
                const assigneeMemberId = planned.assignee === undefined ? undefined : memberIdByHandle.get(planned.assignee);
                await deps.host.sendMessage({
                    requestId: requestId(`persistent:task:${request.id}:${planned.id}`),
                    workspaceId,
                    channelRef: channel.channelRef,
                    body: subject === '' ? planned.id : subject,
                    ...(assigneeMemberId === undefined ? {} : { recipients: Object.freeze([assigneeMemberId]) }),
                    asTask: true,
                });
            }
            return Object.freeze({
                mode: 'persistent',
                teamRef: `${workspaceId}/${channel.channelRef}`,
                teamName: channel.name,
                detail: `ledger team materialized from approval '${request.id}'`,
            });
        },
        async describe(_ctx, teamRef) {
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1));
            const view = deps.host.view({ workspaceId: resolvedWorkspace });
            const channel = view.channels.find(candidate => candidate.channelRef === channelRef);
            if (channel === undefined)
                return undefined;
            return summary(channel, view.members.filter(membership => membership.channelRef === channelRef).length, view.tasks.filter(task => task.channelRef === channelRef).length);
        },
        async list(_ctx) {
            const view = deps.host.view({ workspaceId });
            return view.channels.map(channel => summary(channel, view.members.filter(membership => membership.channelRef === channel.channelRef).length, view.tasks.filter(task => task.channelRef === channel.channelRef).length));
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
        async membersOf(_ctx, teamRef) {
            if (deps.host.members === undefined)
                return Object.freeze([]);
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1));
            const view = deps.host.view({ workspaceId: resolvedWorkspace });
            const inChannel = new Set(view.members
                .filter(membership => membership.channelRef === channelRef)
                .map(membership => membership.memberId));
            if (inChannel.size === 0)
                return Object.freeze([]);
            const rows = deps.host.members()
                .filter(status => inChannel.has(status.member.memberId))
                .map(status => Object.freeze({
                id: status.member.memberId,
                name: status.member.handle,
                role: status.member.description,
                state: status.member.state,
                ...(status.member.model === undefined ? {} : { model: status.member.model.model }),
            }));
            return Object.freeze(rows);
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
        async addMember(_ctx, teamRef, member) {
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            const channelRef = (slash === -1 ? teamRef : teamRef.slice(slash + 1));
            const model = member.provider === undefined || member.model === undefined ? undefined
                : Object.freeze({
                    provider: member.provider,
                    model: member.model,
                    ...(member.reasoningEffort === undefined ? {} : { reasoningEffort: member.reasoningEffort }),
                });
            // A unique stamp per call: re-adding the same name after a removal is a
            // legitimate second attempt, so the id must not be derived from the name
            // alone or the ledger would treat it as a duplicate request.
            const stamp = `${channelRef}:${member.name}:${Date.now().toString(36)}`;
            let result;
            try {
                result = await deps.host.addMember({
                    requestId: requestId(`persistent:add:${stamp}`),
                    workspaceId: resolvedWorkspace,
                    handle: member.name,
                    description: member.role ?? '',
                    presetId: 'team-member',
                    ...(model === undefined ? {} : { model }),
                    channelRefs: Object.freeze([channelRef]),
                });
            }
            catch (error) {
                // One added member is never a roster-cap overflow, but the host's cap is
                // a constructor value we cannot read, so surface the same actionable
                // message when the cap is what refused it.
                throw memberLimitError(error, 1, 0, member.name);
            }
            const stored = result.status.member;
            return Object.freeze({
                id: stored.memberId,
                name: stored.handle,
                role: stored.description,
                state: stored.state,
                ...(stored.model === undefined ? {} : { model: stored.model.model }),
            });
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
        async removeMember(_ctx, teamRef, memberName) {
            if (deps.host.members === undefined || deps.host.removeMember === undefined) {
                throw new Error('这个宿主版本没有暴露移除成员的能力（AgentTeam.removeMember 未接线），'
                    + '所以无法释放「' + memberName + '」这个名字。');
            }
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            // WHY THE SEARCH IS WORKSPACE-WIDE AND NOT CHANNEL-SCOPED: the members
            // that most need releasing are exactly the ones that are in NO channel —
            // a member added by a failed attempt, then archived when the attempt was
            // abandoned, keeps holding its handle while belonging to nothing. Scoping
            // the lookup to the team's own channel made those members unreachable and
            // the tool answered "队伍里没有叫 X 的成员" for a name that was, in fact,
            // occupied. The ledger's uniqueness rule is workspace-wide, so the lookup
            // must be too.
            const matched = deps.host.members()
                .filter(status => status.member.workspaceId === resolvedWorkspace && status.member.handle === memberName);
            if (matched.length === 0) {
                throw new Error(`这个 workspace 里没有叫「${memberName}」的成员，无法移除。`
                    + '如果这个名字现在能用，说明它已经被释放了。');
            }
            if (matched.length > 1) {
                throw new Error(`这个 workspace 里有 ${matched.length} 个叫「${memberName}」的成员，名字不唯一，无法确定移除哪一个。`);
            }
            const target = matched[0].member;
            const result = await deps.host.removeMember({
                requestId: requestId(`persistent:remove:${target.memberId}:${Date.now().toString(36)}`),
                memberId: target.memberId,
            });
            const removed = result.member;
            return Object.freeze({
                id: removed.memberId,
                name: removed.handle,
                role: removed.description,
                state: removed.state,
                ...(removed.model === undefined ? {} : { model: removed.model.model }),
            });
        },
        /**
         * Hot-swap one member's model route, keeping their session and history.
         *
         * The host's `updateMember` is a full-row edit (handle, description,
         * capabilities), but callers of this method only ever mean "move this
         * member to another model route" — so the backend reads the stored row and
         * echoes every OTHER mutable field back verbatim. An edit that silently
         * blanked the description or cleared a capabilities override would be a
         * much worse bug than a refused swap. The request contract itself demands
         * the echo: absent optional facts CLEAR the stored override.
         */
        async updateMemberModel(_ctx, teamRef, memberName, selection) {
            if (deps.host.members === undefined || deps.host.updateMember === undefined) {
                throw new Error('这个宿主版本没有暴露成员编辑能力（AgentTeam.updateMember 未接线），'
                    + '所以无法切换「' + memberName + '」的模型。');
            }
            const slash = teamRef.lastIndexOf('/');
            const resolvedWorkspace = slash === -1 ? workspaceId : teamRef.slice(0, slash);
            // Workspace-wide lookup, for the same reason as removeMember above: the
            // ledger's identity rules are workspace-scoped, and a name must resolve
            // the same way in every roster operation.
            const matched = deps.host.members()
                .filter(status => status.member.workspaceId === resolvedWorkspace && status.member.handle === memberName);
            if (matched.length === 0) {
                throw new Error(`这个 workspace 里没有叫「${memberName}」的成员，无法切换模型。`);
            }
            if (matched.length > 1) {
                throw new Error(`这个 workspace 里有 ${matched.length} 个叫「${memberName}」的成员，名字不唯一，无法确定切换哪一个。`);
            }
            const target = matched[0].member;
            const model = Object.freeze({
                provider: selection.provider,
                model: selection.model,
                ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
            });
            const result = await deps.host.updateMember({
                requestId: requestId(`persistent:model:${target.memberId}:${Date.now().toString(36)}`),
                memberId: target.memberId,
                handle: target.handle,
                description: target.description,
                model,
                // No capabilities field: the host clears an override only when the
                // key is PRESENT-AND-ABSENT-of-value is indistinguishable here, so we
                // omit the key entirely and the stored override survives untouched.
                ...(target.capabilities === undefined ? {} : { capabilities: target.capabilities }),
            });
            const stored = result.status.member;
            return Object.freeze({
                id: stored.memberId,
                name: stored.handle,
                role: stored.description,
                state: stored.state,
                ...(stored.model === undefined ? {} : { model: stored.model.model }),
            });
        },
    });
}
