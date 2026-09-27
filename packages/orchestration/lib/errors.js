/** The Chinese text the HTTP layer returns for each code. */
export const APPROVAL_ERROR_MESSAGES = {
    not_awaiting_owner: '该请求当前不在等待主人批准，无法执行此操作',
    not_awaiting_captain: '该请求当前不在等待队长审批，无法执行此操作',
    captain_only: '只有该团队的队长可以审批此提议',
    human_only: '只有主人可以执行此操作',
    empty_plan: '计划不可运行：至少需要一名成员和一个任务，请补充计划后再批准',
    materialize_failed: '团队创建失败，请求保持原状态，可重试或退回',
};
/**
 * A refused decision: the request is not in the state the decision needs, or
 * the caller is not entitled to make it.
 */
export class ApprovalTransitionError extends Error {
    code;
    /** The request state the refusal was based on, when the guard knew one. */
    state;
    constructor(code, message, state) {
        super(message);
        this.name = 'ApprovalTransitionError';
        this.code = code;
        this.state = state;
    }
}
/**
 * The plan cannot produce a runnable team.
 *
 * Mirrors `validateStagedGraph(..., requireRunnable)` (dag-team tools.ts): a
 * team needs at least one member and at least one task. The staged path always
 * had that guard; the approval-driven materialization path did not, so an empty
 * plan produced an empty team that could never do anything.
 */
export class EmptyPlanError extends Error {
    code = 'empty_plan';
    constructor(message) {
        super(message);
        this.name = 'EmptyPlanError';
    }
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
export function approvalErrorCodeOf(error) {
    const code = error?.code;
    if (typeof code !== 'string')
        return undefined;
    return Object.prototype.hasOwnProperty.call(APPROVAL_ERROR_MESSAGES, code)
        ? code
        : undefined;
}
/** Request state carried by an error, from itself or from the request it wraps. */
function stateOf(error) {
    const holder = error;
    const state = holder?.state ?? holder?.request?.state;
    return typeof state === 'string' && state !== '' ? state : undefined;
}
/**
 * Map any thrown value to the frozen HTTP response.
 *
 * A coded domain error is a 409 the card can explain; everything else is an
 * unknown failure and stays a 500 with a generic Chinese message — the raw
 * error text only reaches the host log, never the response body.
 */
export function toApprovalHttpError(error) {
    const code = approvalErrorCodeOf(error);
    if (code === undefined) {
        return { status: 500, body: { error: '审批操作失败：宿主内部错误，请查看宿主日志' } };
    }
    const state = stateOf(error);
    return {
        status: 409,
        body: {
            error: APPROVAL_ERROR_MESSAGES[code],
            code,
            ...(state === undefined ? {} : { state }),
        },
    };
}
