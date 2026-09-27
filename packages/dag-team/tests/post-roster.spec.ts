/**
 * The post roster the captain prompt advertises.
 *
 * Member artwork is resolved by matching a member's `name` and `role` against
 * the twenty posts in the client's `OC_ROLE_ART` table, so a roster word that
 * no portrait answers to renders as a bare initial on the owner's screen. The
 * captain prompt and the client table are therefore two halves of one contract,
 * and this spec is the pin between them: every post advertised here must
 * actually resolve through the client's own matcher.
 *
 * The roster is Chinese-only on purpose — these are the twenty job titles the
 * asset pack defines (see its readme), and the owners read them by title.
 * The client matcher is imported from its source (not re-implemented) so this
 * cannot drift into testing a copy of the rule.
 */
import { describe, expect, it } from 'vitest'
import { TEAM_NAMING_RULE, TEAM_POST_ROSTER } from '../src/capabilities.ts'
import { memberArtUrl, OC_ART_BASE } from '../../client-agent-team/src/client/dag/artwork.ts'

describe('TEAM_POST_ROSTER', () => {
  it('lists the twenty posts', () => {
    expect(TEAM_POST_ROSTER).toHaveLength(20)
    expect(new Set(TEAM_POST_ROSTER).size).toBe(20)
  })

  it('is Chinese-only, so the owner can read every post aloud', () => {
    const notChinese: string[] = []
    for (const post of TEAM_POST_ROSTER) {
      if (/[A-Za-z]/.test(post)) notChinese.push(post)
    }
    expect(notChinese).toEqual([])
  })

  it('resolves every post to a portrait through the client matcher', () => {
    const unresolved: string[] = []
    for (const post of TEAM_POST_ROSTER) {
      const art = memberArtUrl(post, '')
      if (art === null || !art.startsWith(OC_ART_BASE)) unresolved.push(post)
    }
    expect(unresolved).toEqual([])
  })

  it('gives each post its own portrait, so no two posts share a face', () => {
    const arts = TEAM_POST_ROSTER.map(post => memberArtUrl(post, ''))
    expect(new Set(arts).size).toBe(20)
  })

  it('also resolves when the post is paired with its modern job title', () => {
    // The rule tells the captain to put the post in `name` and may put the
    // modern job title in `role`; both halves are matched together, so the
    // pairing must not break the match.
    expect(memberArtUrl('星文审校', '技术审核 & 代码评审')).toBe(`${OC_ART_BASE}code-reviewer.webp`)
    expect(memberArtUrl('历算主事', '后端开发工程师')).toBe(`${OC_ART_BASE}backend-engineer.webp`)
    expect(memberArtUrl('星机校验', '技术测试工程师')).toBe(`${OC_ART_BASE}test-engineer.webp`)
  })

  it('is embedded in the captain naming rule, which says why it matters', () => {
    for (const post of TEAM_POST_ROSTER) {
      expect(TEAM_NAMING_RULE).toContain(post)
    }
    expect(TEAM_NAMING_RULE).toContain('头像')
  })
})
