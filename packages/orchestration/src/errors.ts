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
import type { ApprovalState } from './types.ts'

/** Every refusal the approval plane can report to the Web card. */
export type ApprovalErrorCode =
  | 'not_awaiting_owner'
  | 'not_awaiting_captain'
  | 'captain_only'
  | 'human_only'
  | 'empty_plan'
  | 'materialize_failed'

/** The Chinese text the HTTP layer returns for each code. */
export const APPROVAL_ERROR_MESSAGES: Record<ApprovalErrorCode, string> = {
  not_awaiting_owner: '该请求当前不在等待主人批准，无法执行此操作',
  not_awaiting_captain: '该请求当前不在等待队长审批，无法执行此操作',
  captain_only: '只有该团队的队长可以审批此提议',
  human_only: '只有主人可以执行此操作',
  empty_plan: '计划不可运行：至少需要一名成员和一个任务，请补充计划后再批准',
  materialize_failed: '团队创建失败，请求保持原状态，可重试或退回',
}

/**
 * A refused decision: the request is not in the state the decision needs, or
 * the caller is not entitled to make it.
 */
export class ApprovalTransitionError extends Error {
  readonly code: ApprovalErrorCode
  /** The request state the refusal was based on, when the guard knew one. */
  readonly state: ApprovalState | undefined

  constructor(code: ApprovalErrorCode, message: string, state?: ApprovalState) {
    super(message)
    this.name = 'ApprovalTransitionError'
    this.code = code
    this.state = state
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
  readonly code = 'empty_plan' as const

  constructor(message: string) {
    super(message)
    this.name = 'EmptyPlanError'
  }
}

/** The frozen HTTP body of a refused approval action. */
export interface ApprovalHttpErrorBody {
  error: string
  code?: string
  state?: string
}

/** The HTTP status + frozen body for one thrown value. */
export interface ApprovalHttpError {
  status: number
  body: ApprovalHttpErrorBody
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
export function approvalErrorCodeOf(error: unknown): ApprovalErrorCode | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code
  if (typeof code !== 'string') return undefined
  return Object.prototype.hasOwnProperty.call(APPROVAL_ERROR_MESSAGES, code)
    ? code as ApprovalErrorCode
    : undefined
}

/** Request state carried by an error, from itself or from the request it wraps. */
function stateOf(error: unknown): string | undefined {
  const holder = error as { state?: unknown; request?: { state?: unknown } } | null | undefined
  const state = holder?.state ?? holder?.request?.state
  return typeof state === 'string' && state !== '' ? state : undefined
}

/**
 * Map any thrown value to the frozen HTTP response.
 *
 * A coded domain error is a 409 the card can explain; everything else is an
 * unknown failure and stays a 500 with a generic Chinese message — the raw
 * error text only reaches the host log, never the response body.
 */
export function toApprovalHttpError(error: unknown): ApprovalHttpError {
  const code = approvalErrorCodeOf(error)
  if (code === undefined) {
    return { status: 500, body: { error: '审批操作失败：宿主内部错误，请查看宿主日志' } }
  }
  const state = stateOf(error)
  return {
    status: 409,
    body: {
      error: APPROVAL_ERROR_MESSAGES[code],
      code,
      ...(state === undefined ? {} : { state }),
    },
  }
}
