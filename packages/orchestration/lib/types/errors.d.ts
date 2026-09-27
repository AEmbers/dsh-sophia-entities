/**
 * Structured approval errors (frozen HTTP contract).
 *
 * A refusal from the approval plane has to be actionable on the Web card, so
 * every refusal carries a stable `code` instead of only a prose message.
 * `packages/dag-team/src/sophia-approval.ts` maps a coded error to HTTP 409
 * with the frozen body shape `{ error, code, state? }`; `error` is always the
 * Chinese text in `APPROVAL_ERROR_MESSAGES`, so the card can never render a raw
 * English stack message. Only an UNKNOWN error stays a 500 (also Chinese).
 *
 * `code` and the body shape are a frozen interface: the client renders its own
 * Chinese text per code, so adding or renaming one is a client-visible change.
 *
 * A domain error's own `message` is the developer-facing diagnostic — the
 * pre-existing guards keep theirs verbatim (some are asserted by tests), and
 * the HTTP body never uses it: it uses `APPROVAL_ERROR_MESSAGES[code]`.
 */
import type { ApprovalState } from './types.ts';
/** Every refusal the approval plane can report to the Web card. */
export type ApprovalErrorCode = 'not_awaiting_owner' | 'not_awaiting_captain' | 'captain_only' | 'human_only' | 'empty_plan' | 'materialize_failed';
/** The Chinese text the HTTP layer returns for each code. */
export declare const APPROVAL_ERROR_MESSAGES: Record<ApprovalErrorCode, string>;
/**
 * A refused decision: the request is not in the state the decision needs, or
 * the caller is not entitled to make it.
 */
export declare class ApprovalTransitionError extends Error {
    readonly code: ApprovalErrorCode;
    /** The request state the refusal was based on, when the guard knew one. */
    readonly state: ApprovalState | undefined;
    constructor(code: ApprovalErrorCode, message: string, state?: ApprovalState);
}
/**
 * The plan cannot produce a runnable team.
 *
 * Mirrors `validateStagedGraph(..., requireRunnable)` (dag-team tools.ts): a
 * team needs at least one member and at least one task. The staged path always
 * had that guard; the approval-driven materialization path did not, so an empty
 * plan produced an empty team that could never do anything.
 */
export declare class EmptyPlanError extends Error {
    readonly code: "empty_plan";
    constructor(message: string);
}
/** The frozen HTTP body of a refused approval action. */
export interface ApprovalHttpErrorBody {
    error: string;
    code?: string;
    state?: string;
}
/** The HTTP status + frozen body for one thrown value. */
export interface ApprovalHttpError {
    status: number;
    body: ApprovalHttpErrorBody;
}
/**
 * The code of any error that carries one this layer knows how to render.
 *
 * Structural on purpose: the router's `MaterializeError` (which wraps whatever
 * the materialization backend threw) passes the cause's code through, so a
 * backend-level `empty_plan` reaches the card unchanged. An unrelated error
 * that happens to carry a `code` (a Node fs `ENOENT`) is NOT known and stays an
 * unknown failure.
 */
export declare function approvalErrorCodeOf(error: unknown): ApprovalErrorCode | undefined;
/**
 * Map any thrown value to the frozen HTTP response.
 *
 * A coded domain error is a 409 the card can explain; everything else is an
 * unknown failure and stays a 500 with a generic Chinese message — the raw
 * error text only reaches the host log, never the response body.
 */
export declare function toApprovalHttpError(error: unknown): ApprovalHttpError;
//# sourceMappingURL=errors.d.ts.map