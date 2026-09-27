// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { PendingApprovals } from '../src/client/dag/ActivityPanel.tsx'
import { en, zh, type AgentTeamsLocaleKey, type AgentTeamsTranslate } from '../src/client/dag/locales.ts'
import { APPROVALS_STATE_URL } from '../src/client/dag/sophia-approval-badge.ts'
import { APPROVALS_PLAN_URL } from '../src/client/dag/sophia-approval-requests.ts'

/**
 * The activity panel's pending-approval rows (the always-mounted surface).
 *
 * Two regressions are pinned here. First paint: the panel used to render
 * [批准][退回] on EVERY row the badge counts, including `pending_captain` ones,
 * so a click posted the owner action against a request the owner route does not
 * own and the host's refusal landed in the row as raw red text. Refusal: the
 * host answers a refused action with a structured 409, and that must not become
 * the panel's copy — and it must not cost the row either, because a proposal
 * refused for `empty_plan` is still pending and the owner still has to be able
 * to decide again (notably [退回]).
 *
 * The rows publish their own `data-state` (the lead's裁定), so each assertion
 * selects its row from the render itself instead of correlating ids with the
 * stubbed snapshot.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A dictionary-backed translator, interpolating `{name}` placeholders. */
function translator(dictionary: Record<string, string>): AgentTeamsTranslate {
  return (key: AgentTeamsLocaleKey, params?: Record<string, unknown>) => {
    const template = dictionary[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
  }
}

const t = translator(zh)

/**
 * What a refusal must never put in front of the owner: the host's internal
 * sentence, the raw state names and request ids it names, and a bare status.
 * Judged on rendered TEXT — the state names are machine-readable attributes by
 * design, and `data-state` is exactly the fact the renderer branches on.
 */
const FORBIDDEN_IN_TEXT = ['is not awaiting', 'pending_captain', 'pending_owner', 'HTTP 5', 'request ']

function expectNoForbiddenText(text: string): void {
  for (const needle of FORBIDDEN_IN_TEXT) expect(text).not.toContain(needle)
}

/** The subset of Response the client reads: `ok`, `status`, `json()`. */
function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

interface HostStub {
  /** Every plan-action body the panel posted, in order. */
  readonly planBodies: Record<string, unknown>[]
}

/** Route both host URLs the panel touches; `plan` answers the POST. */
function stubHost(options: {
  readonly requests?: readonly Record<string, unknown>[]
  readonly plan?: () => Response
}): HostStub {
  const planBodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url === APPROVALS_STATE_URL) return Promise.resolve(reply(200, { requests: options.requests ?? [] }))
    if (url === APPROVALS_PLAN_URL) {
      planBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      return Promise.resolve(options.plan?.() ?? reply(200, { state: 'materialized' }))
    }
    return Promise.resolve(reply(404, { error: 'no such route' }))
  })
  return { planBodies }
}

const OWNER_REQUEST = 'req-owner'
const CAPTAIN_REQUEST = 'req-captain'

function snapshotRow(id: string, state: string, goal: string): Record<string, unknown> {
  return { id, goal, requester: 'human', mode: 'dag', state, createdAt: 1 }
}

/** One row of the rendered panel, addressed by its request id. */
function rowOf(container: HTMLElement, requestId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-request-id="${requestId}"]`)
  expect(element).not.toBeNull()
  return element as HTMLElement
}

/** Row addressed by the state the renderer published, not by an external id. */
function rowsWithState(container: HTMLElement, state: string): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[data-state="${state}"]`)]
}

async function renderPanel(): Promise<HTMLElement> {
  const { container } = render(<PendingApprovals sessionId="sess-1" t={t} />)
  await waitFor(() => { expect(container.querySelectorAll('[data-request-id]').length).toBeGreaterThan(0) })
  return container
}

describe('PendingApprovals first paint', () => {
  // Regression: the badge counts both states, so the panel offered the owner's
  // [批准][退回] on a captain-owned row. The first click answered
  // "… is not awaiting owner decision (pending_captain)" — a refusal, not a
  // decision, and the row never moved.
  it('offers the owner controls only on the row that is awaiting the owner', async () => {
    stubHost({
      requests: [
        snapshotRow(CAPTAIN_REQUEST, 'pending_captain', 'member-filed proposal'),
        snapshotRow(OWNER_REQUEST, 'pending_owner', 'owner-filed proposal'),
      ],
    })
    const container = await renderPanel()

    // The renderer publishes the state it branched on, so each row is selected
    // by its own fact rather than by correlating with the stubbed snapshot.
    const captainRows = rowsWithState(container, 'pending_captain')
    expect(captainRows).toHaveLength(1)
    const captainRow = captainRows[0] as HTMLElement
    expect(captainRow.getAttribute('data-request-id')).toBe(CAPTAIN_REQUEST)
    expect(captainRow.querySelectorAll('button')).toHaveLength(0)
    expect(captainRow.textContent).toContain(zh['approval.row.waitingCaptain'])
    expectNoForbiddenText(captainRow.textContent ?? '')

    const ownerRows = rowsWithState(container, 'pending_owner')
    expect(ownerRows).toHaveLength(1)
    const ownerRow = ownerRows[0] as HTMLElement
    expect(ownerRow.getAttribute('data-request-id')).toBe(OWNER_REQUEST)
    const approve = within(ownerRow).getByRole('button', { name: zh['approval.approve'] })
    const reject = within(ownerRow).getByRole('button', { name: zh['approval.reject'] })
    expect(approve.hasAttribute('disabled')).toBe(false)
    expect(reject.hasAttribute('disabled')).toBe(false)
  })

  it('renders the waiting label from the active dictionary', async () => {
    stubHost({ requests: [snapshotRow(CAPTAIN_REQUEST, 'pending_captain', 'member-filed proposal')] })
    const { container } = render(<PendingApprovals sessionId="sess-1" t={translator(en)} />)
    await waitFor(() => { expect(rowsWithState(container, 'pending_captain')).toHaveLength(1) })
    const captainRow = rowsWithState(container, 'pending_captain')[0] as HTMLElement
    expect(captainRow.textContent).toContain(en['approval.row.waitingCaptain'])
    expect(captainRow.querySelectorAll('button')).toHaveLength(0)
    expectNoForbiddenText(captainRow.textContent ?? '')
  })
})

describe('PendingApprovals refusals', () => {
  /** Click [批准] on the owner row and hand back the row it happened in. */
  async function approveOwnerRow(container: HTMLElement): Promise<HTMLElement> {
    const ownerRow = rowsWithState(container, 'pending_owner')[0] as HTMLElement
    fireEvent.click(within(ownerRow).getByRole('button', { name: zh['approval.approve'] }))
    return ownerRow
  }

  // Regression: the action was refused and the row was gone anyway — or the raw
  // host sentence took its place. A refusal leaves the proposal exactly where it
  // was, with its controls usable, so the owner can still hand it back.
  it('keeps the refused row in place, its buttons usable, and names the reason', async () => {
    const stub = stubHost({
      requests: [snapshotRow(OWNER_REQUEST, 'pending_owner', 'proposal with an empty plan')],
      plan: () => reply(409, {
        error: `request ${OWNER_REQUEST} is not awaiting owner decision (pending_captain)`,
        code: 'empty_plan',
        state: 'pending_owner',
      }),
    })
    const container = await renderPanel()
    await approveOwnerRow(container)

    const alert = await waitFor(() => within(rowOf(container, OWNER_REQUEST)).getByRole('alert'))
    expect(alert.textContent).toBe(zh['approval.error.emptyPlan'])

    // The row survived the refusal: one row, still awaiting the owner, controls
    // back to enabled because the in-flight action has settled.
    expect(stub.planBodies).toHaveLength(1)
    expect(container.querySelectorAll('[data-request-id]')).toHaveLength(1)
    const row = rowOf(container, OWNER_REQUEST)
    expect(row.getAttribute('data-state')).toBe('pending_owner')
    expect(container.querySelector('[data-pending-approvals]')?.getAttribute('data-pending-approvals')).toBe('1')
    expect(within(row).getByRole('button', { name: zh['approval.approve'] }).hasAttribute('disabled')).toBe(false)
    expect(within(row).getByRole('button', { name: zh['approval.reject'] }).hasAttribute('disabled')).toBe(false)
    expectNoForbiddenText(container.textContent ?? '')
  })

  it('keeps [退回] available on a refused row', async () => {
    const stub = stubHost({
      requests: [snapshotRow(OWNER_REQUEST, 'pending_owner', 'proposal with an empty plan')],
      plan: () => reply(409, { error: 'empty plan', code: 'empty_plan', state: 'pending_owner' }),
    })
    const container = await renderPanel()
    await approveOwnerRow(container)
    const row = await waitFor(() => {
      expect(within(rowOf(container, OWNER_REQUEST)).getByRole('alert')).toBeTruthy()
      return rowOf(container, OWNER_REQUEST)
    })
    // The refused [批准] must not strand the proposal: the owner's other verdict
    // is still reachable, and firing it posts the reject action.
    fireEvent.click(within(row).getByRole('button', { name: zh['approval.reject'] }))
    await waitFor(() => { expect(stub.planBodies).toHaveLength(2) })
    expect(stub.planBodies[1]).toEqual({ action: 'reject', requestId: OWNER_REQUEST, sessionId: 'sess-1' })
  })

  it('renders the mapped wording for a known refusal code', async () => {
    stubHost({
      requests: [snapshotRow(OWNER_REQUEST, 'pending_owner', 'already-decided proposal')],
      plan: () => reply(409, {
        error: `request ${OWNER_REQUEST} is not awaiting owner decision (pending_captain)`,
        code: 'not_awaiting_owner',
        state: 'pending_captain',
      }),
    })
    const container = await renderPanel()
    await approveOwnerRow(container)

    const alert = await waitFor(() => within(rowOf(container, OWNER_REQUEST)).getByRole('alert'))
    expect(alert.textContent).toBe(zh['approval.error.notAwaitingOwner'])
    expectNoForbiddenText(container.textContent ?? '')
  })

  it('falls back to the generic wording when the refusal carries no code', async () => {
    stubHost({
      requests: [snapshotRow(OWNER_REQUEST, 'pending_owner', 'proposal the host refused')],
      plan: () => reply(500, { error: `request ${OWNER_REQUEST} blew up` }),
    })
    const container = await renderPanel()
    await approveOwnerRow(container)

    const alert = await waitFor(() => within(rowOf(container, OWNER_REQUEST)).getByRole('alert'))
    expect(alert.textContent).toBe(zh['approval.error.generic'])
    expectNoForbiddenText(container.textContent ?? '')
  })

  it('removes the row once the host settles the action', async () => {
    stubHost({
      requests: [snapshotRow(OWNER_REQUEST, 'pending_owner', 'proposal the host approved')],
      plan: () => reply(200, { request_id: OWNER_REQUEST, state: 'materialized' }),
    })
    const container = await renderPanel()
    await approveOwnerRow(container)
    await waitFor(() => { expect(container.querySelectorAll('[data-request-id]')).toHaveLength(0) })
  })
})
