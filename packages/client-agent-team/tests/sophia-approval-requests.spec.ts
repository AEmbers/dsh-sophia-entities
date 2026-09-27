import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPROVAL_REFUSAL_KEYS,
  APPROVALS_PLAN_URL,
  ApprovalPlanError,
  approvalErrorMessage,
  approvalRefusalCode,
  fetchApprovalRequestState,
  postApprovalPlanAction,
  type SophiaApprovalPlanAction,
} from '../src/client/dag/sophia-approval-requests.ts'
import { en, zh, type AgentTeamsTranslate } from '../src/client/dag/locales.ts'
import { APPROVALS_STATE_URL } from '../src/client/dag/sophia-approval-badge.ts'

/** The English dictionary behind the translator seam. */
const translateEn: AgentTeamsTranslate = (key) => en[key] ?? key

interface Call { readonly url: string; readonly init: RequestInit | undefined }

/** Replace the global fetch and record every call. */
function stubFetch(response: Response = new Response('', { status: 200 })): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(response)
  })
  return calls
}

/** A fresh JSON responder, because a Response body can only be read once. */
function stubJson(body: unknown, status = 200): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  })
  return calls
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  expect(call).toBeDefined()
  const body = call?.init?.body
  expect(typeof body).toBe('string')
  return JSON.parse(body as string) as Record<string, unknown>
}

/** Every action the card can fire, one per union member. */
const ACTIONS: readonly SophiaApprovalPlanAction[] = [
  { action: 'set_mode', requestId: 'req-1', mode: 'dag' },
  { action: 'approve', requestId: 'req-1', decision: 'approve', mode: 'dag' },
  { action: 'reject', requestId: 'req-1' },
  { action: 'review', requestId: 'req-1', decision: 'downgrade_to_dag', reason: 'why' },
]

describe('postApprovalPlanAction', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // Regression: the host route reads `sessionId` from the body and answers 400
  // `sessionId is required` without it, which is exactly what made [批准][退回]
  // and the mode switch look dead. Every action must carry it.
  it('carries the viewing session id on every action', async () => {
    for (const action of ACTIONS) {
      const calls = stubFetch()
      await postApprovalPlanAction('sess-1', action)
      expect(calls.length).toBe(1)
      expect(calls[0]?.url).toBe(APPROVALS_PLAN_URL)
      expect(calls[0]?.init?.method).toBe('POST')
      expect(calls[0]?.init?.cache).toBe('no-store')
      expect(bodyOf(calls[0])).toEqual({ ...action, sessionId: 'sess-1' })
    }
  })

  it('trims the session id and refuses an empty one before any request', async () => {
    const calls = stubFetch()
    await postApprovalPlanAction('  sess-2  ', { action: 'reject', requestId: 'req-2' })
    expect(bodyOf(calls[0])['sessionId']).toBe('sess-2')

    const none = stubFetch()
    await expect(postApprovalPlanAction('   ', { action: 'reject', requestId: 'req-2' }))
      .rejects.toThrow(/session id/)
    expect(none.length).toBe(0)
  })

  // Regression: a refused action surfaced the host's own sentence, and with no
  // JSON body the bare status — so the panel echoed "… is not awaiting owner
  // decision (pending_captain)" and "HTTP 500" at the owner. The host now
  // answers a known refusal with 409 `{error, code, state}`; the code maps to
  // client wording and the host's sentence never leaves the error object.
  it('maps a known refusal code to client wording and keeps the host text for logs', async () => {
    stubJson({
      error: 'request req-3 is not awaiting owner decision (pending_captain)',
      code: 'not_awaiting_owner',
      state: 'pending_captain',
    }, 409)
    const thrown = await postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' })
      .catch((cause: unknown) => cause)
    expect(thrown).toBeInstanceOf(ApprovalPlanError)
    const refusal = thrown as ApprovalPlanError
    expect(refusal.code).toBe('not_awaiting_owner')
    expect(refusal.state).toBe('pending_captain')
    expect(refusal.status).toBe(409)
    expect(refusal.messageKey).toBe('approval.error.notAwaitingOwner')
    expect(refusal.message).toBe(zh['approval.error.notAwaitingOwner'])
    // The host's sentence survives for diagnostics and is never the copy.
    expect(refusal.hostMessage).toContain('is not awaiting owner decision')
    expect(refusal.message).not.toContain('pending_captain')
    expect(refusal.message).not.toContain('is not awaiting')
  })

  it('falls back to the generic wording for an unknown code, and for none at all', async () => {
    stubJson({ error: 'something the host said', code: 'brand_new_reason' }, 409)
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' }))
      .rejects.toThrow(zh['approval.error.generic'])

    vi.unstubAllGlobals()
    stubFetch(new Response('nope', { status: 500 }))
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' }))
      .rejects.toThrow(zh['approval.error.generic'])

    vi.unstubAllGlobals()
    stubJson({ error: 'sessionId is required' }, 400)
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' }))
      .rejects.toThrow(zh['approval.error.generic'])
  })

  it('names every refusal code the host can send, in both dictionaries', async () => {
    for (const [code, key] of Object.entries(APPROVAL_REFUSAL_KEYS)) {
      expect(approvalRefusalCode(code)).toBe(code)
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
      vi.unstubAllGlobals()
      stubJson({ error: 'refused', code, state: 'pending_owner' }, 409)
      const thrown = await postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' })
        .catch((cause: unknown) => cause) as ApprovalPlanError
      expect(thrown.messageKey).toBe(key)
    }
    expect(approvalRefusalCode('nope')).toBeUndefined()
    expect(approvalRefusalCode(undefined)).toBeUndefined()
  })

  it('resolves quietly on an ok response', async () => {
    const calls = stubFetch(new Response('', { status: 200 }))
    await expect(postApprovalPlanAction('sess-1', { action: 'approve', requestId: 'req-4', decision: 'approve' }))
      .resolves.toBeUndefined()
    expect(calls.length).toBe(1)
  })

  // Regression: the card kept offering [批准][退回] after a decision because the
  // ok body was discarded, so the next click came back "is not awaiting owner
  // decision". The host's verdict is what tells the card to stand down.
  it('returns the state the host settled the request into', async () => {
    stubJson({ request_id: 'req-5', state: 'rejected' })
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-5' }))
      .resolves.toEqual({ requestId: 'req-5', state: 'rejected' })

    vi.unstubAllGlobals()
    stubJson({ request_id: 'req-6', state: 'materialized', mode: 'dag', materialized: true, team_ref: 'team-9' })
    await expect(postApprovalPlanAction('sess-1', { action: 'approve', requestId: 'req-6', decision: 'approve' }))
      .resolves.toEqual({ requestId: 'req-6', state: 'materialized', mode: 'dag', materialized: true, teamRef: 'team-9' })

    vi.unstubAllGlobals()
    stubJson({ request_id: 'req-7', state: 'pending_owner', mode: 'dag' })
    await expect(postApprovalPlanAction('sess-1', { action: 'set_mode', requestId: 'req-7', mode: 'dag' }))
      .resolves.toEqual({ requestId: 'req-7', state: 'pending_owner', mode: 'dag' })
  })
})

describe('fetchApprovalRequestState', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports the queued state and mode of a request that is still pending', async () => {
    const calls = stubJson({ requests: [{ id: 'req-1', state: 'pending_owner', mode: 'dag' }] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toEqual({ kind: 'state', state: 'pending_owner', mode: 'dag' })
    expect(calls[0]?.url).toBe(APPROVALS_STATE_URL)
    expect(calls[0]?.init?.cache).toBe('no-store')
  })

  it('reports a request the queue no longer carries as absent', async () => {
    stubJson({ requests: [{ id: 'req-other', state: 'pending_owner' }] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toBe('absent')
  })

  it('concludes nothing from a failed or unreadable snapshot', async () => {
    stubJson({ error: 'failed to load pending approvals' }, 500)
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    stubJson({ not_requests: [] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('host restarting')))
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    const none = stubJson({ requests: [] })
    await expect(fetchApprovalRequestState('  ')).resolves.toBeUndefined()
    expect(none.length).toBe(0)
  })
})

describe('approvalErrorMessage', () => {
  it('renders a refusal through the active dictionary', () => {
    const refusal = new ApprovalPlanError(409, 'empty_plan', 'pending_owner', 'the plan had no members')
    expect(approvalErrorMessage(refusal)).toBe(zh['approval.error.emptyPlan'])
    expect(approvalErrorMessage(refusal, translateEn)).toBe(en['approval.error.emptyPlan'])
  })

  // The four things the owner must never be shown: a bare status, the host's
  // "is not awaiting owner decision" sentence, an internal state name, or a
  // request id.
  it('scrubs host internals out of anything else it is handed', () => {
    expect(approvalErrorMessage(new Error('request req-9 is not awaiting owner decision (pending_captain)')))
      .toBe(zh['approval.error.generic'])
    expect(approvalErrorMessage(new Error('HTTP 500'))).toBe(zh['approval.error.generic'])
    expect(approvalErrorMessage(new Error('pending_owner is not a terminal state')))
      .toBe(zh['approval.error.generic'])
    expect(approvalErrorMessage('')).toBe(zh['approval.error.generic'])
  })

  // A client-side precondition names no host internals, so it is still worth
  // showing: it is a bug report about this panel, not a state the owner hit.
  it('keeps a client-side precondition message', () => {
    expect(approvalErrorMessage(new Error('approval actions require the viewing session id')))
      .toBe('approval actions require the viewing session id')
  })
})
