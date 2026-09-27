/**
 * The persistent team's activity snapshot.
 *
 * A ledger team records no per-row activity, so the first-stage canary returned
 * `members: []` plus the two volumes and the panel drew a bare stat card. Now
 * that the backend can supply member rows (see the agent-team
 * `persistent-member-rows` spec), the snapshot has to turn them into drawable
 * rows while keeping the volume-only card as the honest fallback — and must not
 * invent the activity numbers the ledger never recorded.
 */
import { describe, expect, it } from 'vitest'
import { persistentTeamSnapshot } from '../src/snapshot.ts'
import type { TeamSummary } from 'dsh-sophia-entities/orchestration'

const SUMMARY: TeamSummary = {
  mode: 'persistent',
  teamId: 'ws-1/channel:a',
  name: 'Panel polish',
  memberCount: 2,
  taskCount: 2,
  createdAt: 0,
}

describe('persistentTeamSnapshot member rows', () => {
  it('draws member rows when rows were supplied', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, [
      { id: 'member:星文审校', name: '星文审校', role: '代码评审', state: 'enabled', model: 'deepseek-v4.1-flash' },
    ])

    expect(snapshot.mode).toBe('persistent')
    expect(snapshot.members).toHaveLength(1)
    expect(snapshot.members[0]?.name).toBe('星文审校')
    expect(snapshot.members[0]?.role).toBe('代码评审')
    // The ledger records no per-row activity; drawing a zero as measured
    // progress would be a lie, so the row states neutrality instead.
    expect(snapshot.members[0]?.activity).toBe('unknown')
    expect(snapshot.members[0]?.currentTask).toBe('')
    expect(snapshot.members[0]?.total).toBe(0)
    // Volumes still come from the summary.
    expect(snapshot.memberCount).toBe(2)
    expect(snapshot.taskCount).toBe(2)
  })

  it('keeps the volume-only card when no rows were supplied', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY)

    expect(snapshot.members).toEqual([])
    expect(snapshot.memberCount).toBe(2)
    expect(snapshot.taskCount).toBe(2)
  })

  it('maps ledger lifecycle words onto the panel status vocabulary', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, [
      { id: 'a', name: '星文审校', role: '代码评审', state: 'enabled' },
      { id: 'b', name: '星机校验', role: '测试工程师', state: 'suspended' },
      { id: 'c', name: '历算主事', role: '后端', state: 'inactive' },
      { id: 'd', name: '星仪主事', role: '前端', state: 'archived' },
    ])

    expect(snapshot.members.map(member => member.status)).toEqual(['idle', 'idle', 'removed', 'removed'])
  })
})
