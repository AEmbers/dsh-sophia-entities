/**
 * SophiaTeamFacade (design §4.2).
 *
 * The orchestration plane's public API: propose / setMode / review / approve /
 * materialize / list / activity. Materialize is the ONLY crossing point into a
 * backend — the facade resolves the request's mode and dispatches to the
 * matching TeamBackend (dag → DAG subagent teams, persistent → ledger-backed
 * Human/agent teams).
 *
 * Permissions (§4.3.2): `review` only for the team's captain; `approve` only
 * for the Human owner; `propose` open to everyone. Depth guard (§4.8):
 * members past `maxTeamDepth` levels may not propose new teams.
 */
import { ApprovalRouter } from "./router.js";
import { ApprovalTransitionError } from "./errors.js";
import { approvalsRootOf } from "./store.js";
export class SophiaTeamFacade {
    options;
    router;
    dagBackend;
    persistentBackend;
    constructor(options) {
        this.options = options;
        const { workspace, host, notify, now } = options;
        this.dagBackend = options.dagBackend;
        this.persistentBackend = options.persistentBackend;
        this.router = new ApprovalRouter(workspace, host, { now, notify });
        this.router.setMaterializeHook((request, mode) => this.materialize(request, mode));
    }
    get host() {
        return this.options.host;
    }
    workspace() {
        return this.options.workspace;
    }
    requesterOf(caller) {
        if (caller.isHuman)
            return { kind: 'human' };
        return {
            kind: 'member',
            memberId: caller.sessionId,
            handle: caller.handle,
            teamId: caller.teamId,
        };
    }
    // -- public API -----------------------------------------------------------
    /** File a proposal (any caller). */
    async propose(caller, input) {
        if (!caller.isHuman) {
            const depth = await this.host.depthOf?.(caller) ?? 0;
            if (depth >= this.host.maxTeamDepth) {
                throw new Error(`team depth limit reached (${depth} >= ${this.host.maxTeamDepth}): deeper teams are not allowed`);
            }
        }
        return this.router.propose(this.requesterOf(caller), input);
    }
    /** Owner/Human picks the final backend mode before/while pending. */
    async setMode(caller, requestId, mode) {
        if (!caller.isHuman) {
            // A member may set the mode on their own draft; anything pending the
            // owner is owner-only.
            const request = await this.router.get(requestId);
            const ownDraft = request && request.state === 'draft'
                && request.requester.kind === 'member'
                && request.requester.memberId === caller.sessionId;
            if (!ownDraft) {
                throw new ApprovalTransitionError('human_only', 'only the Human owner may set the mode of a pending request', request?.state);
            }
        }
        return this.router.setMode(requestId, mode);
    }
    /** Captain verdict (captain-only, §4.3.2). */
    async review(caller, requestId, verdict) {
        if (caller.isHuman) {
            throw new ApprovalTransitionError('captain_only', 'the Human owner cannot review member proposals — use approve');
        }
        const request = await this.requireRequest(requestId);
        const captain = request.requester.teamId
            ? await this.host.captainOf?.(request.requester.teamId)
            : undefined;
        if (!captain || captain !== caller.sessionId) {
            throw new ApprovalTransitionError('captain_only', 'only the team captain may review this proposal', request.state);
        }
        return this.router.review(requestId, {
            ...verdict,
            decidedBy: caller.sessionId,
            decidedAt: Date.now(),
        });
    }
    /** Owner approval (Human-only, §4.3.2). */
    async approve(caller, requestId, verdict) {
        if (!caller.isHuman) {
            throw new ApprovalTransitionError('human_only', 'only the Human owner may approve a request', (await this.router.get(requestId))?.state);
        }
        return this.router.approve(requestId, {
            ...verdict,
            decidedAt: Date.now(),
        });
    }
    /**
     * THE single materialization dispatch point (§4.2). Publishes to the
     * backend matching the request's mode. Fails loudly when the backend is not
     * wired (host integration not yet attached).
     */
    async materialize(request, mode) {
        const backend = mode === 'dag' ? this.dagBackend : this.persistentBackend;
        if (!backend) {
            throw new Error(`materialization backend for '${mode}' is not wired — attach it in the host integration`);
        }
        return backend.create(this, request);
    }
    /** Cross-backend team listing for the workspace. */
    async list(filter = {}) {
        const results = [];
        if (!filter.mode || filter.mode === 'dag') {
            results.push(...(await this.dagBackend?.list(this) ?? []));
        }
        if (!filter.mode || filter.mode === 'persistent') {
            results.push(...(await this.persistentBackend?.list(this) ?? []));
        }
        return results;
    }
    /** Pending approval queue, newest first. */
    async pendingApprovals() {
        const all = await this.router.listAll();
        return all.filter((r) => r.state === 'pending_captain' || r.state === 'pending_owner' || r.state === 'draft');
    }
    /** Resolve one approval request. */
    get(requestId) {
        return this.router.get(requestId);
    }
    /** Activity snapshots for a team ref (P4 expands). */
    async activity(ref) {
        const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend;
        const summary = await backend?.describe(this, ref.teamRef);
        return {
            mode: ref.mode,
            teamRef: ref.teamRef,
            payload: summary ?? null,
        };
    }
    /**
     * Staff one more member into an existing team.
     *
     * A plan rosters a team once; this is the only way to grow it afterwards, so a
     * team that came up short (the host refused one name, a member was retired
     * again) can be completed instead of rebuilt. Rebuilding is NOT an option: the
     * first attempt already claimed every handle it managed to create.
     *
     * Human-only: adding a member creates a durable session that costs tokens, so
     * it carries the same authority as approving the original roster.
     */
    async addMember(caller, ref, member) {
        if (!caller.isHuman) {
            throw new Error('only the Human owner may add a team member');
        }
        const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend;
        if (!backend) {
            throw new Error(`no backend is wired for mode '${ref.mode}'`);
        }
        if (!backend.addMember) {
            throw new Error(`the '${ref.mode}' backend cannot add members — a ${ref.mode} team's roster is fixed when it materializes`);
        }
        return backend.addMember(this, ref.teamRef, member);
    }
    /**
     * Retire one member from an existing team, releasing their handle.
     *
     * This is the counterpart the ledger's own rules force: handle uniqueness is
     * checked against every member that is not `inactive` and still participates in
     * the workspace, so archiving does NOT free a name. Without a real removal, a
     * name claimed by a failed attempt stays unusable forever.
     *
     * Human-only, and irreversible: the member's private namespace is dropped and
     * its session is disposed — the same contract as the host's own removal.
     */
    async removeMember(caller, ref, memberName) {
        if (!caller.isHuman) {
            throw new Error('only the Human owner may remove a team member');
        }
        const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend;
        if (!backend) {
            throw new Error(`no backend is wired for mode '${ref.mode}'`);
        }
        if (!backend.removeMember) {
            throw new Error(`the '${ref.mode}' backend cannot remove members — a ${ref.mode} team's roster is fixed when it materializes`);
        }
        return backend.removeMember(this, ref.teamRef, memberName);
    }
    /**
     * Hot-swap one existing member's model route, keeping their session, history
     * and private memory untouched.
     *
     * A member's model is decided at creation and a plan's choice never ages
     * well: quota runs out, routes are renamed, the owner changes preference
     * mid-flight. The host's own member edit updates the route in place — the
     * live agent keeps its session and history, and only the next request lands
     * on the new route — so this is the whole operation; recreating members to
     * move them is never acceptable.
     *
     * Human-only: the model route decides whose quota each turn bills, which is
     * owner money, so it carries the same authority as roster surgery.
     */
    async updateMemberModel(caller, ref, memberName, selection) {
        if (!caller.isHuman) {
            throw new Error('only the Human owner may change a member model');
        }
        const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend;
        if (!backend) {
            throw new Error(`no backend is wired for mode '${ref.mode}'`);
        }
        if (!backend.updateMemberModel) {
            throw new Error(`the '${ref.mode}' backend cannot update member models on this host build`);
        }
        return backend.updateMemberModel(this, ref.teamRef, memberName, selection);
    }
    /**
     * Run the timeout sweep. Hosts call this from a timer; tests call it with a
     * fake clock. Returns the transitions that fired.
     */
    sweepExpired() {
        return this.router.sweepExpired();
    }
    approvalsRoot() {
        return approvalsRootOf(this.workspace());
    }
    async requireRequest(requestId) {
        const request = await this.router.get(requestId);
        if (!request)
            throw new Error(`no approval request ${requestId}`);
        return request;
    }
}
