/**
 * Approval orchestration domain model (design §4.1.1).
 *
 * The orchestration layer is a thin, dependency-free approval plane that sits
 * ABOVE the two team backends (the persistent ledger-backed teams and the DAG
 * subagent teams). It owns the approval queue as an independent truth: requests
 * are stored under `<workspace>/.sophia-entities/approvals/<id>.json`, parallel
 * to — and un-transactionally separate from — either backend's state directory
 * (design §4.1.2). Materialization is the ONLY crossing point into a backend.
 */
/** Which backend a request shall materialize into. */
export type TeamMode = 'persistent' | 'dag';
/**
 * Lifecycle of an approval request (§4.1.1).
 *
 * - `draft`            proposed by a member, editable before exposure
 * - `pending_captain`  member proposal awaiting its team's captain review
 * - `pending_owner`    owner (Human) decision; mode may still be changed
 * - `approved`         owner approved with a concrete mode
 * - `downgraded`       captain downgraded a persistent proposal to DAG
 * - `rejected`         captain or owner rejected the proposal
 * - `materialized`     the backend accepted the team and it now exists
 * - `expired`          pending_captain/pending_owner/draft timed out
 */
export type ApprovalState = 'draft' | 'pending_captain' | 'pending_owner' | 'approved' | 'downgraded' | 'rejected' | 'materialized' | 'expired';
/** Who raised the request. */
export type RequesterKind = 'human' | 'member';
export interface Requester {
    kind: RequesterKind;
    /** Durable member session id; present only for `member` requesters. */
    memberId?: string;
    /** Member display name; present for `member` requesters. */
    handle?: string;
    /** The member's current team id; used to resolve the reviewing captain. */
    teamId?: string;
}
/** One profile tuple of a planned team (DAG and persistent backends both accept these). */
export interface PlannedMember {
    name: string;
    role?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}
/** One planned task. DAG backends persist `dependencies` as a real graph. */
export interface PlannedTask {
    id: string;
    subject: string;
    description?: string;
    assignee?: string;
    dependencies: string[];
}
export interface ApprovalPlan {
    members: PlannedMember[];
    tasks: PlannedTask[];
}
/** Captain verdict on a member proposal (§4.1.1). */
export interface CaptainVerdict {
    decision: 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject';
    /** Required on every decision; written into the audit record (RK6). */
    reason: string;
    decidedAt: number;
    /** Captain session id that issued the verdict. */
    decidedBy: string;
}
/** Owner (Human) verdict (§4.1.1). */
export interface OwnerVerdict {
    decision: 'approve' | 'reject';
    /** Concrete mode picked by the owner; required on approve, absent on reject. */
    mode?: TeamMode;
    decidedAt: number;
}
/** The durable approval request record. */
export interface ApprovalRequest {
    id: string;
    requester: Requester;
    goal: string;
    plan: ApprovalPlan;
    /** Filled once the requester or owner fixes a mode. */
    mode?: TeamMode;
    state: ApprovalState;
    captainVerdict?: CaptainVerdict;
    ownerVerdict?: OwnerVerdict;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
}
/** Stable hash of a proposal, used to dedupe identical goals (§4.8 point 4). */
export declare function proposalKey(goal: string, plan: ApprovalPlan): string;
/** Result of materializing an approval into a backend (§4.2). */
export interface MaterializeResult {
    mode: TeamMode;
    /** Backend team id/ref, backend-specific. */
    teamRef: string;
    /** Backend display name, when distinguishable. */
    teamName?: string;
    /** Free-form backend detail (captain session id, thread ref, …). */
    detail?: string;
}
/** Lightweight team summary exposed by `facade.list`. */
export interface TeamSummary {
    mode: TeamMode;
    teamId: string;
    name: string;
    captainSessionId?: string;
    memberCount: number;
    taskCount: number;
    createdAt: number;
}
/**
 * One member row of a backend team, for row-drawing surfaces.
 *
 * `name` and `role` are the two strings the client's OC artwork table matches
 * against (`memberArtUrl(name, role)`), so both must survive from the plan
 * verbatim: a renamed or localized label loses the portrait.
 */
export interface TeamMemberRow {
    /** Durable member id when the backend has one; else a stable display key. */
    id: string;
    /** Display name — what the member is called in the plan and on the row. */
    name: string;
    /** Role text the plan assigned; this is what selects the OC portrait. */
    role: string;
    /** Backend lifecycle word, already human-readable for the row. */
    state: string;
    /** Model selection label when known. */
    model?: string;
}
/** Filter passed to `facade.list`. */
export interface TeamFilter {
    mode?: TeamMode;
    requester?: RequesterKind;
}
/** Snapshot of one backend team's activity (P4 expands the shape). */
export interface ActivitySnapshot {
    mode: TeamMode;
    teamRef: string;
    /** Backend-provided event stream, kept opaque to the orchestration layer. */
    payload: unknown;
}
/**
 * Backend capability contract (§4.2). The orchestration layer decides WHICH
 * backend materializes a request; the backend decides HOW. Real backends are
 * wired by the plugin host (teams backend → DAG subagent teams; persistent
 * backend → ledger-backed Human/agent teams).
 */
export interface TeamBackend {
    readonly mode: TeamMode;
    /**
     * Create the team from an approved plan. The `requester` is the originating
     * member/human, retained so the backend can attribute durable records.
     */
    create(ctx: unknown, request: ApprovalRequest): Promise<MaterializeResult>;
    /** Resolve a backend team ref to a summary (unknown ref → undefined). */
    describe(ctx: unknown, teamRef: string): Promise<TeamSummary | undefined>;
    /** List every team this backend currently owns for the workspace. */
    list(ctx: unknown): Promise<TeamSummary[]>;
    /**
     * Per-row members of one team, for surfaces that draw rows rather than the
     * volume card. Optional: a backend whose source exposes no row detail (or one
     * that has not implemented it yet) simply omits the method, and callers fall
     * back to `describe`'s counts.
     *
     * The returned `role` is what the client matches OC artwork against, so a
     * backend should return the role text it planned verbatim (not a translated
     * label) — see `memberArtUrl` in the client package.
     */
    membersOf?(ctx: unknown, teamRef: string): Promise<readonly TeamMemberRow[]>;
    /**
     * Add one member to an EXISTING team.
     *
     * A plan materializes its roster once and never grows; without this method a
     * team that came up short can only be rebuilt from scratch, and a rebuild
     * collides with the handles the first attempt already claimed. Optional:
     * a backend with no growth path omits it and the caller reports that.
     */
    addMember?(ctx: unknown, teamRef: string, member: PlannedMember): Promise<TeamMemberRow>;
    /**
     * Retire one member from an EXISTING team, releasing their handle.
     *
     * The ledger enforces handle uniqueness against every member that is not
     * `inactive` AND still participates in the workspace, so archiving a member
     * (`state: 'archived'`) does NOT free the name — only a real removal does.
     * That is the whole reason this method exists: without it, a name claimed by
     * a failed attempt is unusable forever and no one can re-staff it.
     *
     * `memberName` is the display handle the plan used, since that is what the
     * owner sees and what the client matches artwork against.
     */
    removeMember?(ctx: unknown, teamRef: string, memberName: string): Promise<TeamMemberRow>;
}
/** Host-side guesses that tools need; injected so the layer stays testable. */
export interface OrchestrationHost {
    /** Session id when the caller is one of the persistent team's members. */
    memberIdOf?(ctx: unknown): string | undefined;
    /** Durable member handle (for display). */
    handleOf?(ctx: unknown): string | undefined;
    /** Current team id the member belongs to (for captain resolution). */
    teamIdOf?(ctx: unknown): string | undefined;
    /** Resolve the captain session id of the team `teamId` (undefined = none). */
    captainOf?(teamId: string): Promise<string | undefined>;
    /** Number of already-estimated descendant levels the member sits at. */
    depthOf?(ctx: unknown): Promise<number>;
    /** Maximum allowed team depth (design default 2: owner → child → grandchild). */
    maxTeamDepth: number;
}
//# sourceMappingURL=types.d.ts.map