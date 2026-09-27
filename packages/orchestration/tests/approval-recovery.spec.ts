/**
 * Approval recovery: expiry sweeping + structured refusals.
 *
 * The defect these pin: a member proposal could sit in `pending_captain`
 * forever. Nothing in production ever called `sweepExpired` (only this test
 * suite did), so the §4.5 timeout table never ran and the two stuck requests
 * stayed on the queue long past their deadline; the owner's card then answered
 * the click with a bare HTTP 500 carrying an English message.
 *
 * Three properties, one per describe block:
 *   1. the approval queue reconciles expiry BEFORE it renders, so a poll can
 *      never show an expired row;
 *   2. the sweep is repeatable — an escalated `pending_captain` (which gets a
 *      fresh `expiresAt`) is retired by a LATER sweep, and re-sweeping a
 *      terminal request changes nothing;
 *   3. a plan that cannot run is refused by the DAG backend before anything is
 *      written: no team, no burned decision, and the owner can still reject.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSophiaDagBackend } from '../../dag-team/src/sophia-dag-backend.ts'
import { APPROVAL_ERROR_MESSAGES, ApprovalTransitionError, EmptyPlanError } from '../src/errors.ts'
import { SophiaTeamFacade, type CallerIdentity } from '../src/facade.ts'
import { DEFAULT_TIMEOUTS, isTerminalState, MaterializeError } from '../src/router.ts'
import { snapshotApprovals, toApprovalHttpError } from '../src/routes.ts'
import type { ApprovalPlan, TeamBackend, TeamSummary } from '../src/types.ts'

// -- fixtures ---------------------------------------------------------------

let workspace: string
let now = 1_700_000_000_000

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sophia-approval-recovery-'))
  now = 1_700_000_000_000
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const clock = (): number => now

const human: CallerIdentity = { isHuman: true }
const captain = (): CallerIdentity => ({ isHuman: false, sessionId: 'captain-1', handle: 'captain', teamId: 'team-1' })
const member = (): CallerIdentity => ({ isHuman: false, sessionId: 'member-1', handle: 'member-1', teamId: 'team-1' })

const plan: ApprovalPlan = {
  members: [{ name: 'alice', role: 'researcher' }],
  tasks: [{ id: 't1', subject: 'research', assignee: 'alice', dependencies: [] }],
}
/** The shape the two stuck production requests actually carry. */
const EMPTY_PLAN: ApprovalPlan = { members: [], tasks: [] }

function makeFacade(options: { dagBackend?: TeamBackend } = {}): SophiaTeamFacade {
  return new SophiaTeamFacade({
    workspace,
    host: {
      workingDirectory: workspace,
      captainOf: async () => 'captain-1',
      depthOf: async () => 0,
      maxTeamDepth: 2,
    },
    dagBackend: options.dagBackend,
    now: clock,
  })
}

const CAPTAIN = { session: { header: { cwd: workspace } } } as unknown as Agent

/**
 * The REAL DAG approval backend, wired to a `materializePlan` stub that would
 * happily create a team directory. The empty-plan guard has to fire before the
 * stub runs, which is what "creates no team" means here.
 */
function realDagBackend(stateRoot: string): { backend: TeamBackend; materialized: string[] } {
  const materialized: string[] = []
  const backend = createSophiaDagBackend({
    materializePlan: async (_captain, input) => {
      materialized.push(input.teamId)
      mkdirSync(join(input.stateRoot, input.teamId), { recursive: true })
      writeFileSync(join(input.stateRoot, input.teamId, 'team.json'), '{}')
      return { teamId: input.teamId, members: input.plan.members.length, tasks: input.plan.tasks.length }
    },
    hostContext: () => ({ captain: CAPTAIN, stateRoot }),
  })
  return { backend, materialized }
}

/** A backend that only counts `create` calls (for the non-materializing paths). */
function countingBackend(): TeamBackend & { created: number } {
  const summaries: TeamSummary[] = []
  const backend: TeamBackend & { created: number } = {
    mode: 'dag',
    created: 0,
    async create(_ctx, request) {
      backend.created += 1
      summaries.push({
        mode: 'dag',
        teamId: 'dag-1',
        name: 'dag-1',
        captainSessionId: 'captain-1',
        memberCount: request.plan.members.length,
        taskCount: request.plan.tasks.length,
        createdAt: now,
      })
      return { mode: 'dag', teamRef: 'dag-1' }
    },
    async describe() { return undefined },
    async list() { return summaries },
  }
  return backend
}

/**
 * Run a refusal and assert its frozen HTTP shape: the status, the code, the
 * state the card is told, and — always — a Chinese message (the card must never
 * be handed a bare English string).
 */
async function expectRefusal(
  run: () => Promise<unknown>,
  expected: { status: number; code?: string; state?: string },
): Promise<{ code?: string; state?: string; error: string }> {
  let thrown: unknown
  let threw = false
  try {
    await run()
  } catch (error) {
    thrown = error
    threw = true
  }
  expect(threw).toBe(true)
  const mapped = toApprovalHttpError(thrown)
  expect(mapped.status).toBe(expected.status)
  expect(mapped.body.code).toBe(expected.code)
  expect(mapped.body.state).toBe(expected.state)
  expect(mapped.body.error).toMatch(/[\u4e00-\u9fff]/)
  return mapped.body
}

// -- 1. the queue read path reconciles expiry -------------------------------

describe('approval queue read-time reconciliation', () => {
  it('sweeps expired pending_captain requests before it renders the queue', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    expect(request.state).toBe('pending_captain')

    now += DEFAULT_TIMEOUTS.pendingCaptainMs + 1
    // The row is past its deadline but still stored as pending_captain: nothing
    // has swept yet. That is exactly the production state of the stuck rows.
    expect((await facade.get(request.id))?.state).toBe('pending_captain')

    const snapshot = await snapshotApprovals(facade)

    expect(snapshot.requests.map((row) => [row.id, row.state])).toEqual([[request.id, 'pending_owner']])
    const stored = await facade.get(request.id)
    expect(stored?.state).toBe('pending_owner')
    // §4.5: an escalation restarts the owner window, so the owner still has time.
    expect(stored?.expiresAt).toBe(now + DEFAULT_TIMEOUTS.pendingOwnerMs)
    expect(isTerminalState(stored!.state)).toBe(false)
  })

  it('leaves a request that is still inside its window alone', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })

    const snapshot = await snapshotApprovals(facade)

    expect(snapshot.requests.map((row) => [row.id, row.state])).toEqual([[request.id, 'pending_captain']])
  })
})

// -- 2. the sweep is repeatable ---------------------------------------------

describe('approval expiry sweep', () => {
  it('escalates on the first sweep and expires on the next, then stays put', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })

    now += DEFAULT_TIMEOUTS.pendingCaptainMs + 1
    const [escalated] = await facade.sweepExpired()
    expect(escalated.kind).toBe('escalated')
    expect(escalated.request.state).toBe('pending_owner')
    expect(escalated.request.expiresAt).toBe(now + DEFAULT_TIMEOUTS.pendingOwnerMs)

    // The escalated row carries a FRESH deadline, so the next sweep must leave
    // it alone — a sweep is idempotent per state, not per request.
    expect(await facade.sweepExpired()).toEqual([])

    now += DEFAULT_TIMEOUTS.pendingOwnerMs + 1
    const [expired] = await facade.sweepExpired()
    expect(expired.kind).toBe('expired')
    expect(expired.request.state).toBe('expired')
    expect(isTerminalState(expired.request.state)).toBe(true)
    // A terminal request has no deadline left to burn.
    expect(expired.request.expiresAt).toBeUndefined()

    // Idempotent: nothing further happens, and the queue is genuinely empty.
    expect(await facade.sweepExpired()).toEqual([])
    expect(await facade.pendingApprovals()).toEqual([])
  })

  it('is repeatable across many sweeps and never revisits a terminal request', async () => {
    const facade = makeFacade()
    await facade.propose(member(), { goal: 'g', mode: 'dag', plan })

    now += DEFAULT_TIMEOUTS.pendingCaptainMs + 1
    await facade.sweepExpired()
    now += DEFAULT_TIMEOUTS.pendingOwnerMs + 1
    await facade.sweepExpired()

    // A dozen more sweeps in a row (the read path polls far more often than
    // this) must produce no transition and no write at all.
    for (let i = 0; i < 12; i += 1) {
      expect(await facade.sweepExpired()).toEqual([])
    }
    expect(await facade.pendingApprovals()).toEqual([])
  })
})

// -- 3. an unrunnable plan is refused, and refuses cleanly ------------------

describe('empty-plan materialization', () => {
  it('refuses the empty plan, keeps the request pending, and still allows a reject', async () => {
    const stateRoot = join(workspace, '.agent-teams')
    const { backend, materialized } = realDagBackend(stateRoot)
    const facade = makeFacade({ dagBackend: backend })
    const { request } = await facade.propose(human, { goal: 'stuck row', mode: 'dag', plan: EMPTY_PLAN })
    expect(request.state).toBe('pending_owner')
    const deadline = request.expiresAt

    const body = await expectRefusal(
      () => facade.approve(human, request.id, { decision: 'approve', mode: 'dag' }),
      { status: 409, code: 'empty_plan', state: 'pending_owner' },
    )
    expect(body.error).toBe(APPROVAL_ERROR_MESSAGES.empty_plan)

    // Nothing was materialized and nothing was written.
    expect(materialized).toEqual([])
    expect(existsSync(stateRoot)).toBe(false)
    // The decision is NOT burned: same state, same deadline, no verdict recorded.
    const stored = await facade.get(request.id)
    expect(stored?.state).toBe('pending_owner')
    expect(stored?.expiresAt).toBe(deadline)
    expect(stored?.ownerVerdict).toBeUndefined()

    // ...so the owner can still take the request off the queue.
    const rejected = await facade.approve(human, request.id, { decision: 'reject' })
    expect(rejected.request.state).toBe('rejected')
    expect(await facade.pendingApprovals()).toEqual([])
  })

  it('materializes a runnable plan through the same backend', async () => {
    const stateRoot = join(workspace, '.agent-teams')
    const { backend, materialized } = realDagBackend(stateRoot)
    const facade = makeFacade({ dagBackend: backend })
    const { request } = await facade.propose(human, { goal: 'real work', mode: 'dag', plan })

    const done = await facade.approve(human, request.id, { decision: 'approve', mode: 'dag' })

    expect(done.request.state).toBe('materialized')
    expect(materialized).toEqual([done.materialized?.teamRef])
    expect(existsSync(join(stateRoot, done.materialized!.teamRef, 'team.json'))).toBe(true)
  })

  it('carries the backend code through MaterializeError instead of the generic one', async () => {
    // A backend that refuses with a coded domain error of its own.
    const backend = countingBackend()
    backend.create = async () => { throw new EmptyPlanError('计划不可运行') }
    const facade = makeFacade({ dagBackend: backend })
    const { request } = await facade.propose(human, { goal: 'g', mode: 'dag', plan })

    await expectRefusal(
      () => facade.approve(human, request.id, { decision: 'approve', mode: 'dag' }),
      { status: 409, code: 'empty_plan', state: 'pending_owner' },
    )
    expect((await facade.get(request.id))?.state).toBe('pending_owner')
  })
})

// -- 4. every refusal reaches the card as a coded 409 -----------------------

describe('structured refusal codes', () => {
  it('not_awaiting_owner: a request that is no longer waiting for the owner', async () => {
    const facade = makeFacade({ dagBackend: countingBackend() })
    const { request } = await facade.propose(human, { goal: 'g', plan })
    await facade.approve(human, request.id, { decision: 'reject' })

    await expectRefusal(
      () => facade.approve(human, request.id, { decision: 'reject' }),
      { status: 409, code: 'not_awaiting_owner', state: 'rejected' },
    )
  })

  it('not_awaiting_captain: a request that has left captain review', async () => {
    const facade = makeFacade({ dagBackend: countingBackend() })
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'persistent', plan })
    // approve_persistent moves the request on to the owner card...
    await facade.review(captain(), request.id, { decision: 'approve_persistent', reason: 'ok' })

    // ...so a second captain verdict is refused, with the state the card can show.
    await expectRefusal(
      () => facade.review(captain(), request.id, { decision: 'reject', reason: 'too late' }),
      { status: 409, code: 'not_awaiting_captain', state: 'pending_owner' },
    )
  })

  it('captain_only: a member who is not the team captain', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    const other = { isHuman: false, sessionId: 'member-2', handle: 'member-2', teamId: 'team-1' }

    const body = await expectRefusal(
      () => facade.review(other, request.id, { decision: 'approve_dag', reason: 'x' }),
      { status: 409, code: 'captain_only', state: 'pending_captain' },
    )
    expect(body.error).toBe(APPROVAL_ERROR_MESSAGES.captain_only)

    // The Human owner cannot review either — same code, same door.
    await expectRefusal(
      () => facade.review(human, request.id, { decision: 'approve_dag', reason: 'x' }),
      { status: 409, code: 'captain_only' },
    )
  })

  it('human_only: a member trying to decide the owner\'s request', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(human, { goal: 'g', plan })

    await expectRefusal(
      () => facade.approve(member(), request.id, { decision: 'approve', mode: 'dag' }),
      { status: 409, code: 'human_only', state: 'pending_owner' },
    )
    // ...and a member cannot fix the mode of the owner's pending request either.
    await expectRefusal(
      () => facade.setMode(member(), request.id, 'dag'),
      { status: 409, code: 'human_only', state: 'pending_owner' },
    )
  })

  it('materialize_failed: an approval with no backend wired is still a coded 409', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(human, { goal: 'g', mode: 'dag', plan })

    await expectRefusal(
      () => facade.approve(human, request.id, { decision: 'approve', mode: 'dag' }),
      { status: 409, code: 'materialize_failed', state: 'pending_owner' },
    )
    expect((await facade.get(request.id))?.state).toBe('pending_owner')
  })

  it('an unknown failure stays a 500 with a Chinese message and no code', async () => {
    const facade = makeFacade()

    await expectRefusal(
      () => facade.approve(human, 'no-such-request', { decision: 'reject' }),
      { status: 500 },
    )
  })

  it('maps a domain refusal only when the code is one this layer renders', async () => {
    // A Node-shaped error code must not be mistaken for an approval code.
    const fsLike = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    expect(toApprovalHttpError(fsLike)).toEqual({
      status: 500,
      body: { error: '审批操作失败：宿主内部错误，请查看宿主日志' },
    })

    // A coded transition error keeps its code and its state.
    const refusal = new ApprovalTransitionError('not_awaiting_owner', 'request x is not awaiting owner decision (rejected)', 'rejected')
    expect(toApprovalHttpError(refusal)).toEqual({
      status: 409,
      body: { error: APPROVAL_ERROR_MESSAGES.not_awaiting_owner, code: 'not_awaiting_owner', state: 'rejected' },
    })
  })

  it('reports the state the record KEEPS, not the would-be state', async () => {
    const backend = countingBackend()
    backend.create = async () => { throw new EmptyPlanError('计划不可运行') }
    const facade = makeFacade({ dagBackend: backend })
    const { request } = await facade.propose(human, { goal: 'g', mode: 'dag', plan })

    let thrown: unknown
    try {
      await facade.approve(human, request.id, { decision: 'approve', mode: 'dag' })
    } catch (error) {
      thrown = error
    }
    // `MaterializeError.request` is the would-be `approved` candidate; the
    // response must tell the card the state the record really keeps.
    expect((thrown as MaterializeError).request.state).toBe('approved')
    expect((thrown as MaterializeError).state).toBe('pending_owner')
    expect(toApprovalHttpError(thrown).body.state).toBe('pending_owner')
  })
})
