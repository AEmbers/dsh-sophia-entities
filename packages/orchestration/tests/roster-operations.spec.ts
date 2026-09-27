/**
 * Roster operations: adding and removing members of an existing team.
 *
 * WHY THESE EXIST AT ALL. A plan rosters a team once, and the ledger enforces
 * handle uniqueness against every member that is not `inactive` AND still
 * participates in the workspace. Two consequences we hit in production:
 *
 *   1. A team that came up short (the host refused one name) could not be
 *      completed — and could not be rebuilt either, because the first attempt
 *      already held every handle it managed to create.
 *   2. Archiving a member (`state: 'archived'`) does NOT free its name, so a
 *      name claimed by a failed attempt stayed unusable forever.
 *
 * `addMember`/`removeMember` are the missing capability. These tests pin the
 * contract the facade and the tools promise, including the two authorities that
 * must NOT be weakened: only the Human may mutate the roster, and a backend
 * that cannot grow must say so instead of pretending.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerApprovalTools } from '../src/tools.ts'
import { SophiaTeamFacade, type CallerIdentity } from '../src/facade.ts'
import type { TeamBackend, TeamMemberRow, TeamSummary } from '../src/types.ts'

let workspace: string
const now = 1_700_000_000_000

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sophia-roster-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const human: CallerIdentity = { isHuman: true }
const member: CallerIdentity = { isHuman: false, sessionId: 'member-1', handle: 'member-1', teamId: 'team-1' }

interface CapturedTool {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** A backend that records roster mutations, so the tests assert real calls. */
function rosterBackend(): TeamBackend & { added: string[]; removed: string[] } {
  const added: string[] = []
  const removed: string[] = []
  return {
    mode: 'persistent',
    added,
    removed,
    async create() {
      return { mode: 'persistent' as const, teamRef: 'ws/ch-1', teamName: 'Four-Post Team' }
    },
    async describe(_ctx, teamRef): Promise<TeamSummary | undefined> {
      const summary: TeamSummary = {
        mode: 'persistent',
        teamId: teamRef,
        name: 'Four-Post Team',
        memberCount: added.length - removed.length,
        taskCount: 0,
        createdAt: now,
      }
      return summary
    },
    async list(): Promise<TeamSummary[]> {
      return []
    },
    async addMember(_ctx, _teamRef, planned): Promise<TeamMemberRow> {
      added.push(planned.name)
      return { id: `member:${planned.name}`, name: planned.name, role: planned.role ?? '', state: 'enabled' }
    },
    async removeMember(_ctx, _teamRef, memberName): Promise<TeamMemberRow> {
      removed.push(memberName)
      return { id: `member:${memberName}`, name: memberName, role: '', state: 'inactive' }
    },
  }
}

function makeTools(backend: TeamBackend) {
  const facade = new SophiaTeamFacade({
    workspace,
    host: { workingDirectory: workspace, captainOf: async () => 'captain-1', depthOf: async () => 0, maxTeamDepth: 2 },
    persistentBackend: backend,
    now: () => now,
    notify: async () => undefined,
  })
  const registered: CapturedTool[] = []
  let caller: CallerIdentity = human
  const bindings: CallerIdentity[] = []
  registerApprovalTools(
    { tools: { register: (tool: unknown) => { registered.push(tool as CapturedTool) } } },
    { facade, resolveCaller: async () => caller, bindDagCaptain: (bound) => { bindings.push(bound) } },
  )
  const run = async (name: string, args: unknown): Promise<Record<string, unknown>> => {
    const tool = registered.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`tool ${name} was not registered`)
    return await tool.execute(args, {}) as Record<string, unknown>
  }
  return { facade, run, registered, asCaller: (next: CallerIdentity) => { caller = next } }
}

describe('roster growth and release', () => {
  it('registers both roster tools', () => {
    const tools = makeTools(rosterBackend())
    const names = tools.registered.map((tool) => tool.name)
    expect(names).toContain('sophia_team_add_member')
    expect(names).toContain('sophia_team_remove_member')
  })

  it('adds a member to an existing team and returns the row', async () => {
    const backend = rosterBackend()
    const tools = makeTools(backend)
    const output = await tools.run('sophia_team_add_member', {
      mode: 'persistent',
      team_ref: 'ws/ch-1',
      name: '星机校验',
      role: '技术测试工程师',
    })
    expect(backend.added).toEqual(['星机校验'])
    expect(output['name']).toBe('星机校验')
    expect(output['state']).toBe('enabled')
    // The row carries exactly the four required keys plus an optional model.
    expect(Object.keys(output).filter((key) => output[key] === undefined)).toEqual([])
  })

  it('removes a member by handle, which is what frees the name', async () => {
    const backend = rosterBackend()
    const tools = makeTools(backend)
    const output = await tools.run('sophia_team_remove_member', {
      mode: 'persistent',
      team_ref: 'ws/ch-1',
      name: '星机校验',
    })
    expect(backend.removed).toEqual(['星机校验'])
    expect(output['name']).toBe('星机校验')
    // `inactive` is the whole point: the ledger only frees a handle when the
    // member is inactive, so a tool that reported anything else would be lying.
    expect(output['state']).toBe('inactive')
  })

  it('keeps both roster mutations in the Human owner hands only', async () => {
    const backend = rosterBackend()
    const tools = makeTools(backend)
    tools.asCaller(member)
    await expect(tools.run('sophia_team_add_member', { mode: 'persistent', team_ref: 'ws/ch-1', name: '星机校验' }))
      .rejects.toThrow(/only the Human owner may add a team member/)
    await expect(tools.run('sophia_team_remove_member', { mode: 'persistent', team_ref: 'ws/ch-1', name: '星机校验' }))
      .rejects.toThrow(/only the Human owner may remove a team member/)
    // Nothing reached the backend: the refusal happens before any mutation.
    expect(backend.added).toEqual([])
    expect(backend.removed).toEqual([])
  })

  it('says a backend cannot grow instead of silently doing nothing', async () => {
    const fixed: TeamBackend = {
      mode: 'persistent',
      async create() { return { mode: 'persistent' as const, teamRef: 'ws/ch-1' } },
      async describe() { return undefined },
      async list() { return [] },
    }
    const tools = makeTools(fixed)
    await expect(tools.run('sophia_team_add_member', { mode: 'persistent', team_ref: 'ws/ch-1', name: 'alice' }))
      .rejects.toThrow(/cannot add members/)
    await expect(tools.run('sophia_team_remove_member', { mode: 'persistent', team_ref: 'ws/ch-1', name: 'alice' }))
      .rejects.toThrow(/cannot remove members/)
  })

  it('reports a missing backend rather than a confusing provider error', async () => {
    const facade = new SophiaTeamFacade({
      workspace,
      host: { workingDirectory: workspace, captainOf: async () => undefined, depthOf: async () => 0, maxTeamDepth: 2 },
      now: () => now,
      notify: async () => undefined,
    })
    await expect(facade.addMember(human, { mode: 'persistent', teamRef: 'ws/ch-1' }, { name: 'alice' }))
      .rejects.toThrow(/no backend is wired for mode 'persistent'/)
    await expect(facade.removeMember(human, { mode: 'persistent', teamRef: 'ws/ch-1' }, 'alice'))
      .rejects.toThrow(/no backend is wired for mode 'persistent'/)
  })

  it('passes the planned role through verbatim so the portrait still resolves', async () => {
    const backend = rosterBackend()
    const tools = makeTools(backend)
    const facade = tools.facade
    const row = await facade.addMember(human, { mode: 'persistent', teamRef: 'ws/ch-1' }, {
      name: '星文审校',
      role: '技术审核 & 代码评审',
    })
    expect(row.role).toBe('技术审核 & 代码评审')
  })
})
