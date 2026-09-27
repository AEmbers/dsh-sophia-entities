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
import { ORG_POSTS } from '../src/org-tree.ts'
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

describe('persistentTeamSnapshot organisation grouping', () => {
  /** Every post the tree expects, as member rows. */
  function fullRoster() {
    return ORG_POSTS.map(post => ({
      id: `id:${post}`, name: post, role: '', state: 'enabled',
    }))
  }

  it('groups a fully-staffed roster into the designed bureaux', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, fullRoster())

    expect(snapshot.org).toBeDefined()
    expect(snapshot.org?.map(bureau => bureau.label)).toEqual([
      '监正', '总控司', '观象司', '历算司', '星验司',
    ])
    // Every bureau carries its members, and the chiefs keep their identity.
    const algorithm = snapshot.org?.find(bureau => bureau.id === 'algorithm')
    expect(algorithm?.chief).toBe('灵台郎')
    expect(algorithm?.members).toContain('灵台郎')
    expect(algorithm?.mandate).not.toBe('')
  })

  it('accounts for every member through the grouping', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, fullRoster())

    const grouped = (snapshot.org ?? []).flatMap(bureau => [...bureau.members])
    expect([...grouped].sort()).toEqual([...ORG_POSTS].sort())
    expect(snapshot.members).toHaveLength(ORG_POSTS.length)
  })

  it('draws no grouping for a partial roster', () => {
    // Two members is a real team (the owner approved one), but not the tree —
    // drawing bureaux here would imply colleagues who are not in the team.
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, [
      { id: 'a', name: '星文审校', role: '技术审核 & 代码评审', state: 'enabled' },
      { id: 'b', name: '星机校验', role: '技术测试工程师', state: 'enabled' },
    ])

    expect(snapshot.org).toBeUndefined()
    expect(snapshot.members).toHaveLength(2)
  })

  it('draws no grouping for a roster with an unknown post', () => {
    // Nineteen posts plus one stranger: the tree is not satisfied, so no
    // grouping — the stranger is still drawn as a row.
    const rows = [...fullRoster().slice(0, 19), { id: 'x', name: 'ledger-check', role: 'verifier', state: 'enabled' }]

    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY, rows)

    expect(snapshot.org).toBeUndefined()
    expect(snapshot.members).toHaveLength(20)
    expect(snapshot.members.some(member => member.name === 'ledger-check')).toBe(true)
  })

  it('draws no grouping when rows were never supplied', () => {
    const snapshot = persistentTeamSnapshot('Sophia', SUMMARY)

    expect(snapshot.org).toBeUndefined()
    expect(snapshot.members).toEqual([])
  })
})
