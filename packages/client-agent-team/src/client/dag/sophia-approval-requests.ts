/**
 * Host routes for the Sophia approval card. The client is a leaf — durable
 * truth lives on the Node side, so every interaction posts the full action
 * record and lets the host settle the state; local UI never guesses.
 * @module dsh-sophia-entities/client/sophia-approval-requests
 */

import type { TeamMode } from 'dsh-sophia-entities/orchestration/types'
import { zh, type AgentTeamsLocaleKey, type AgentTeamsTranslate } from './locales.ts'
import { APPROVALS_STATE_URL } from './sophia-approval-badge.ts'

/** POST body target for approval-plan actions (design §4.4.2 / routes.ts). */
export const APPROVALS_PLAN_URL = '/plugins/dsh-sophia-entities/approvals/plan'

/** A captain-side verdict for a pending_captain proposal. */
export type CaptainVerdict =
  | 'approve_dag'
  | 'approve_persistent'
  | 'downgrade_to_dag'
  | 'reject'

/**
 * Mirror of the host `ApprovalPlanAction` shape. The host's `approve` case
 * requires `decision ∈ {approve,reject}`, so the owner approval carries an
 * explicit decision; a plain reject is its own action.
 */
export type SophiaApprovalPlanAction =
  | { readonly action: 'set_mode'; readonly requestId: string; readonly mode: TeamMode }
  | { readonly action: 'approve'; readonly requestId: string; readonly decision: 'approve' | 'reject'; readonly mode?: TeamMode }
  | { readonly action: 'reject'; readonly requestId: string }
  | { readonly action: 'review'; readonly requestId: string; readonly decision: CaptainVerdict; readonly reason?: string }

/**
 * What the host answered for one plan action (`routes.ts` runApprovalPlanAction
 * returns `{request_id, state, mode, materialized, team_ref}`). `state` is the
 * settlement: the card reads it to stop offering buttons for a request that is
 * no longer awaiting a decision, instead of leaving the card pending forever
 * and answering the next click with "is not awaiting owner decision".
 */
export interface SophiaApprovalPlanResult {
  readonly requestId?: string
  readonly state?: string
  readonly mode?: TeamMode
  readonly materialized?: boolean
  readonly teamRef?: string
}

/**
 * Why the host refused a plan action. A known refusal answers 409 with
 * `{error, code, state}`; the client renders its own wording for the `code` so
 * the host's sentence — which names internal state names and request ids —
 * never reaches the UI.
 */
export type ApprovalRefusalCode =
  | 'not_awaiting_owner'
  | 'not_awaiting_captain'
  | 'captain_only'
  | 'human_only'
  | 'empty_plan'
  | 'materialize_failed'

/** Locale key that renders each known refusal. */
export const APPROVAL_REFUSAL_KEYS: Readonly<Record<ApprovalRefusalCode, AgentTeamsLocaleKey>> = {
  not_awaiting_owner: 'approval.error.notAwaitingOwner',
  not_awaiting_captain: 'approval.error.notAwaitingCaptain',
  captain_only: 'approval.error.captainOnly',
  human_only: 'approval.error.humanOnly',
  empty_plan: 'approval.error.emptyPlan',
  materialize_failed: 'approval.error.materializeFailed',
}

/** Wording for a refusal the host gave no code for, and for anything raw. */
export const APPROVAL_ERROR_GENERIC_KEY: AgentTeamsLocaleKey = 'approval.error.generic'

const APPROVAL_REFUSAL_CODES: ReadonlySet<string> = new Set(Object.keys(APPROVAL_REFUSAL_KEYS))

/** Narrow the host's `code` field to the refusals this build knows. */
export function approvalRefusalCode(value: unknown): ApprovalRefusalCode | undefined {
  return typeof value === 'string' && APPROVAL_REFUSAL_CODES.has(value)
    ? value as ApprovalRefusalCode
    : undefined
}

/**
 * One refused plan action, carrying wording the UI is allowed to show.
 *
 * `message` is Simplified Chinese — the dictionary's source of truth — so a
 * caller with no translator still renders a sentence rather than the host's
 * own text; `messageKey` is what a localized surface renders instead. The
 * host's raw sentence survives as `hostMessage` for logs only.
 */
export class ApprovalPlanError extends Error {
  /** The refusal code, when the host named one this build knows. */
  readonly code: ApprovalRefusalCode | undefined
  /** The state the host reported for the request, when it reported one. */
  readonly state: string | undefined
  /** HTTP status of the refused response. */
  readonly status: number
  /** Locale key a translated surface renders. */
  readonly messageKey: AgentTeamsLocaleKey
  /** The host's own `error` string; diagnostics only, never the UI. */
  readonly hostMessage: string | undefined

  constructor(
    status: number,
    code: ApprovalRefusalCode | undefined,
    state: string | undefined,
    hostMessage: string | undefined,
  ) {
    const messageKey = code === undefined ? APPROVAL_ERROR_GENERIC_KEY : APPROVAL_REFUSAL_KEYS[code]
    super(zh[messageKey])
    this.name = 'ApprovalPlanError'
    this.code = code
    this.state = state
    this.status = status
    this.messageKey = messageKey
    this.hostMessage = hostMessage
  }
}

/** Sentences that name host internals instead of telling the user anything. */
const UNSAFE_APPROVAL_TEXT: readonly RegExp[] = [
  /is not awaiting/i,
  /pending_(?:owner|captain)/i,
  /\brequest\s+[0-9a-f]{4,}/i,
  /\bHTTP\s*\d{3}\b/i,
]

/**
 * Keep a string the UI may show. Anything that would leak a state name, a
 * request id or a bare HTTP status becomes the generic wording instead.
 */
export function sanitizeApprovalMessage(message: string): string {
  const text = message.trim()
  if (text === '') return zh[APPROVAL_ERROR_GENERIC_KEY]
  return UNSAFE_APPROVAL_TEXT.some((pattern) => pattern.test(text))
    ? zh[APPROVAL_ERROR_GENERIC_KEY]
    : text
}

/** Fold the host's snake_case result body into the card's result shape. */
function parsePlanResult(body: unknown): SophiaApprovalPlanResult | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const raw = body as Record<string, unknown>
  const result: {
    requestId?: string
    state?: string
    mode?: TeamMode
    materialized?: boolean
    teamRef?: string
  } = {}
  if (typeof raw['request_id'] === 'string') result.requestId = raw['request_id']
  if (typeof raw['state'] === 'string') result.state = raw['state']
  if (raw['mode'] === 'persistent' || raw['mode'] === 'dag') result.mode = raw['mode']
  if (raw['materialized'] === true) result.materialized = true
  if (typeof raw['team_ref'] === 'string') result.teamRef = raw['team_ref']
  return result
}

/**
 * Fire one approval-plan action at the host. Mirrors the AgentTeams plan
 * mutation fetch (`mutatePlan`): posts JSON and rejects with an
 * `ApprovalPlanError` on any non-ok response. The host's own sentence stays on
 * that error as `hostMessage`; what the UI renders is the mapped wording.
 *
 * `sessionId` is the session the card is rendered in, and it is REQUIRED: the
 * host route authenticates the browser as the human operator but still refuses
 * the action with 400 `sessionId is required` (or 409 `human session is not
 * attached`) unless the owning session id rides in the body. Omitting it made
 * every owner interaction — approve, reject, and the mode switch — fail with no
 * visible effect.
 *
 * The resolved value is the host's own verdict. An ok response whose body is
 * empty or unreadable resolves to `undefined` (the action still succeeded).
 */
export async function postApprovalPlanAction(
  sessionId: string,
  payload: SophiaApprovalPlanAction,
): Promise<SophiaApprovalPlanResult | undefined> {
  const owner = sessionId.trim()
  if (owner === '') throw new Error('approval actions require the viewing session id')
  const response = await fetch(APPROVALS_PLAN_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, sessionId: owner }),
  })
  if (!response.ok) {
    let hostMessage: string | undefined
    let code: ApprovalRefusalCode | undefined
    let state: string | undefined
    try {
      const body = await response.json() as { error?: unknown; code?: unknown; state?: unknown }
      if (typeof body.error === 'string' && body.error.trim() !== '') hostMessage = body.error
      code = approvalRefusalCode(body.code)
      if (typeof body.state === 'string') state = body.state
    } catch {}
    throw new ApprovalPlanError(response.status, code, state, hostMessage)
  }
  try {
    return parsePlanResult(await response.json())
  } catch {
    return undefined
  }
}

/**
 * What the live pending queue says about one request.
 *
 *  - `{kind:'state'}` — the request is still queued, with this state (and mode).
 *  - `'absent'` — the snapshot answered and the request is NOT in it, so it was
 *    decided (approved, rejected or expired) after the card was rendered.
 *  - `undefined` — the snapshot could not be read (host restarting); the card
 *    must not conclude anything from a failed poll.
 */
export type ApprovalLiveState =
  | { readonly kind: 'state'; readonly state: string; readonly mode?: string }
  | 'absent'
  | undefined

/**
 * Read the live queue and report what it says about `requestId`. The card is
 * rendered from immutable conversation records, so a request decided earlier —
 * by this card, by the captain, or from another paired device — stays
 * "pending" in the transcript forever. This is how the card learns otherwise.
 */
export async function fetchApprovalRequestState(requestId: string): Promise<ApprovalLiveState> {
  if (requestId.trim() === '') return undefined
  try {
    const response = await fetch(APPROVALS_STATE_URL, { cache: 'no-store' })
    if (!response.ok) return undefined
    const body = await response.json() as { readonly requests?: unknown } | null
    if (typeof body !== 'object' || body === null || !Array.isArray(body.requests)) return undefined
    for (const row of body.requests) {
      if (typeof row !== 'object' || row === null) continue
      const entry = row as { readonly id?: unknown; readonly state?: unknown; readonly mode?: unknown }
      if (entry.id !== requestId) continue
      if (typeof entry.state !== 'string') return undefined
      return typeof entry.mode === 'string'
        ? { kind: 'state', state: entry.state, mode: entry.mode }
        : { kind: 'state', state: entry.state }
    }
    return 'absent'
  } catch {
    return undefined
  }
}

/**
 * Normalize an unknown thrown value into wording the UI may show: a refusal
 * renders through `t` when the caller has a translator, and everything else is
 * scrubbed of host internals before it reaches a surface.
 */
export function approvalErrorMessage(error: unknown, t?: AgentTeamsTranslate): string {
  if (error instanceof ApprovalPlanError) {
    return t === undefined ? error.message : t(error.messageKey)
  }
  return sanitizeApprovalMessage(error instanceof Error ? error.message : String(error))
}
