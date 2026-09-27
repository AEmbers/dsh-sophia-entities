/**
 * The persistent (ledger) backend's member rows.
 *
 * A ledger Channel membership fact is ids only (`{ channelRef, memberId }`), so
 * the display `handle`/`description` — the two strings the client matches OC
 * artwork against — can only come from the host roster. The first-stage canary
 * returned `members: []` and the panel therefore drew a two-number volume card;
 * these tests pin the join that fixes it, and the honest degradation when the
 * host does not expose the optional roster reader.
 */
import { describe, expect, it } from 'vitest'
import { createSophiaPersistentBackend } from '../src/sophia-persistent-backend.ts'
import type { AgentTeamView } from '../src/types/requests-results.ts'

const WORKSPACE = 'ws-1'
const CHANNEL = 'channel:a'

/** A roster row in the shape the host `members()` reader returns. */
function rosterRow(handle: string, description: string, state = 'enabled') {
  return {
    member: {
      memberId: `member:${handle}`,
      handle,
      description,
      state,
      model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
    },
  }
}

/** A view whose channel holds the given member handles. */
function viewWith(handles: readonly string[]): AgentTeamView {
  return {
    humanMemberId: 'member:human',
    workspaces: [],
    channels: [{ channelRef: CHANNEL, name: 'Panel polish' }],
    members: handles.map(handle => ({ channelRef: CHANNEL, memberId: `member:${handle}` })),
    tasks: [],
    threads: [],
    taskNumbers: [],
    items: [],
    claims: [],
    activities: [],
    cursor: 0,
    hasMore: false,
  } as unknown as AgentTeamView
}

/** A backend whose host answers `view()` and, optionally, `members()`. */
function backendWith(handles: readonly string[], roster?: readonly unknown[]) {
  return createSophiaPersistentBackend({
    host: {
      createChannel: async () => { throw new Error('not used') },
      addMember: async () => { throw new Error('not used') },
      sendMessage: async () => { throw new Error('not used') },
      view: () => viewWith(handles),
      ...(roster === undefined ? {} : { members: () => roster as never }),
    },
    workspaceId: WORKSPACE,
  })
}

describe('persistent backend membersOf', () => {
  it('joins channel membership with the host roster', async () => {
    const backend = backendWith(
      ['星文审校', '星机校验'],
      [rosterRow('星文审校', '代码评审'), rosterRow('星机校验', '测试工程师')],
    )

    const rows = await backend.membersOf?.({}, `${WORKSPACE}/${CHANNEL}`)

    expect(rows).toHaveLength(2)
    expect(rows?.[0]?.name).toBe('星文审校')
    expect(rows?.[0]?.role).toBe('代码评审')
    expect(rows?.[0]?.state).toBe('enabled')
    expect(rows?.[0]?.model).toBe('deepseek-v4.1-flash')
  })

  it('returns only the members of the requested channel', async () => {
    const backend = backendWith(
      ['星文审校'],
      [rosterRow('星文审校', '代码评审'), rosterRow('星机校验', '测试工程师')],
    )

    const rows = await backend.membersOf?.({}, `${WORKSPACE}/${CHANNEL}`)

    // 星机校验 is in the roster but not in this channel.
    expect(rows?.map(row => row.name)).toEqual(['星文审校'])
  })

  it('degrades to no rows on a host without the optional roster reader', async () => {
    const backend = backendWith(['星文审校'])

    await expect(backend.membersOf?.({}, `${WORKSPACE}/${CHANNEL}`)).resolves.toEqual([])
  })

  it('accepts a bare channel ref, falling back to the bound workspace', async () => {
    const backend = backendWith(['星文审校'], [rosterRow('星文审校', '代码评审')])

    const rows = await backend.membersOf?.({}, CHANNEL)

    expect(rows?.map(row => row.name)).toEqual(['星文审校'])
  })
})

describe('persistent backend member cap reporting', () => {
  /** A backend whose `addMember` throws the host's own roster-cap error. */
  function cappedBackend(cap: number, failAt: number) {
    let seen = 0
    return createSophiaPersistentBackend({
      host: {
        createChannel: async () => ({ channel: { channelRef: CHANNEL } }) as never,
        addMember: async () => {
          const index = seen
          seen += 1
          if (index >= failAt) throw new Error(`Team member limit ${cap} reached`)
          return { status: { member: { handle: `m${index}`, memberId: `id${index}` } } } as never
        },
        sendMessage: async () => ({}) as never,
        view: () => viewWith([]),
      },
      workspaceId: WORKSPACE,
    })
  }

  const REQUEST = {
    id: 'req-1',
    requester: 'human',
    goal: 'staff the observatory',
    plan: {
      members: Array.from({ length: 20 }, (_, i) => ({ name: `岗位${i}`, role: '测试工程师' })),
      tasks: [],
    },
    state: 'pending_owner',
    createdAt: 1,
    updatedAt: 1,
  } as never

  it('explains which two numbers disagree instead of surfacing the bare host error', async () => {
    // 8 seats, so the ninth member crosses the host cap.
    const backend = cappedBackend(8, 8)

    const failure = await backend.create({}, REQUEST).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain('20 名成员')
    expect(message).toContain('8')
    // Names the member that was rejected, so the owner can count.
    expect(message).toContain('第 9 名「岗位8」')
    // Says the Human is not part of the number — the owner's own question.
    expect(message).toContain('主人本人不计入')
    // And hands over the exact config snippet, pre-filled with the right cap.
    expect(message).toContain('maxMembers: 20')
  })

  it('leaves unrelated host failures alone', async () => {
    const backend = createSophiaPersistentBackend({
      host: {
        createChannel: async () => ({ channel: { channelRef: CHANNEL } }) as never,
        addMember: async () => { throw new Error('unknown Workspace \'default\'') },
        sendMessage: async () => ({}) as never,
        view: () => viewWith([]),
      },
      workspaceId: WORKSPACE,
    })

    await expect(backend.create({}, REQUEST)).rejects.toThrow('unknown Workspace')
  })
})
