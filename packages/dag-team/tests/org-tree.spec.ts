/**
 * The 钦天监 organisation tree.
 *
 * The twenty posts are not a flat list: they form four bureaux under one
 * director, and each bureau has a chief who is himself a post. Two things can
 * silently go wrong here and both are invisible until the owner's screen looks
 * wrong, so both are pinned:
 *
 * 1. The tree must cover the twenty-post roster EXACTLY — a post present in the
 *    roster but absent from the tree would never be staffed, and a post in the
 *    tree but not the roster would have no portrait.
 * 2. Every post must still resolve to its OC portrait through the client's own
 *    matcher, because a bureau listing is how the captain learns the names.
 *
 * A bureau chief is listed among his own bureau's members (he leads it AND
 * works in it), so `superiorOfPost` must not report him as his own superior.
 */
import { describe, expect, it } from 'vitest'
import {
  ORG_DIRECTOR_POST, ORG_EXPECTED_SIZE, ORG_POSTS, ORG_TREE, ORG_TREE_TEXT,
  bureauOfPost, orgTreeMatchesRoster, superiorOfPost,
} from '../src/org-tree.ts'
import { TEAM_POST_ROSTER } from '../src/capabilities.ts'
import { memberArtUrl, OC_ART_BASE } from '../../client-agent-team/src/client/dag/artwork.ts'

describe('ORG_TREE', () => {
  it('covers the twenty-post roster exactly', () => {
    expect(orgTreeMatchesRoster()).toBe(true)
    expect(ORG_POSTS).toHaveLength(ORG_EXPECTED_SIZE)
    expect(ORG_EXPECTED_SIZE).toBe(20)
    // No post appears twice.
    expect(new Set(ORG_POSTS).size).toBe(ORG_POSTS.length)
  })

  it('matches the marketing roster name for name, in order', () => {
    expect([...ORG_POSTS]).toEqual([...TEAM_POST_ROSTER])
  })

  it('gives every post its own OC portrait', () => {
    const missing = ORG_POSTS.filter(post => {
      const art = memberArtUrl(post, '')
      return art === null || !art.startsWith(OC_ART_BASE)
    })
    expect(missing).toEqual([])
  })

  it('puts the director alone at the root', () => {
    const director = bureauOfPost(ORG_DIRECTOR_POST)
    expect(director?.members).toEqual([ORG_DIRECTOR_POST])
    expect(superiorOfPost(ORG_DIRECTOR_POST)).toBeUndefined()
  })

  it('reports every bureau chief to the director, never to himself', () => {
    // 灵台主事 sits in 总控司 while leading 观象司, and the other two chiefs sit
    // inside their own bureau. Both arrangements must report upward, never to
    // the post itself.
    for (const bureau of ORG_TREE) {
      if (bureau.chief === undefined) continue
      expect(superiorOfPost(bureau.chief)).toBe(ORG_DIRECTOR_POST)
      expect(superiorOfPost(bureau.chief)).not.toBe(bureau.chief)
    }
    // The two chiefs who are also members of the bureau they lead.
    expect(bureauOfPost('灵台郎')?.members).toContain('灵台郎')
    expect(bureauOfPost('星验主事')?.members).toContain('星验主事')
    // …and the one who leads a bureau from outside it.
    expect(bureauOfPost('灵台主事')?.id).toBe('general')
    expect(bureauOfPost('观象访事')?.chief).toBe('灵台主事')
  })

  it('reports a bureau member to his own chief', () => {
    expect(superiorOfPost('历算主事')).toBe('灵台郎')
    expect(superiorOfPost('星机校验')).toBe('星验主事')
    expect(superiorOfPost('象绘主事')).toBe('灵台主事')
  })

  it('reports a general-office post straight to the director', () => {
    // 总控司 has no chief of its own: its four posts sit beside the director.
    expect(bureauOfPost('时宪主事')?.chief).toBeUndefined()
    expect(superiorOfPost('时宪主事')).toBe(ORG_DIRECTOR_POST)
    expect(superiorOfPost('典籍掌事')).toBe(ORG_DIRECTOR_POST)
  })

  it('renders every bureau and post for the captain prompt', () => {
    for (const bureau of ORG_TREE) {
      expect(ORG_TREE_TEXT).toContain(bureau.label)
      for (const post of bureau.members) expect(ORG_TREE_TEXT).toContain(post)
    }
  })

  it('names the reporting chain in the prompt text a captain reads', () => {
    // The behaviour the owner asked for, stated where the captain will see it.
    expect(ORG_TREE_TEXT).toContain('负责人：灵台郎')
    expect(ORG_TREE_TEXT).toContain('负责人：星验主事')
  })
})
