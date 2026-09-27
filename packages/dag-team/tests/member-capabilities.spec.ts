/**
 * The two AgentTeams capability contracts, which differ by design.
 *
 * A captain and a standing member get different tool sets and different
 * instructions, and the difference is the point of the owner's organisation:
 *
 * - A member's job is to take the work that reached him by `@` and open a SMALL
 *   team sized to that job instead of doing it inline. That is what lets two
 *   requests run as two independent teams rather than queuing behind each
 *   other. So a member MUST be able to create a team.
 * - Approving a plan is a human decision, and roster surgery mutates a team the
 *   member did not open. So those stay denied to him.
 *
 * Both halves are pinned here because a regression in either direction is
 * silent: a member who cannot create simply does the work inline (slow, and the
 * owner's whole design stops mattering), and a member who can approve would
 * materialize teams without the owner ever seeing a card.
 */
import { describe, expect, it } from 'vitest'
import {
  TEAM_MEMBER_DISPATCH_RULE, TEAM_MEMBER_PROMPT, memberNamingRule,
} from '../src/capabilities.ts'
import {
  MEMBER_DENIED_TOOL_NAMES, MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES,
} from '../src/tool-names.ts'
import { TEAM_POST_ROSTER } from '../src/capabilities.ts'

describe('member tool exposure', () => {
  it('lets a member open the team that does his assigned work', () => {
    expect(MEMBER_TOOL_NAMES).toContain('agent_teams_create')
  })

  it('keeps reporting and claiming in a member\'s hands', () => {
    for (const name of ['agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status']) {
      expect(MEMBER_TOOL_NAMES).toContain(name)
    }
  })

  it('reserves approval for a human, never a member', () => {
    expect(MEMBER_DENIED_TOOL_NAMES).toContain('agent_teams_approve')
  })

  it('reserves roster and plan surgery for the captain', () => {
    for (const name of ['agent_teams_edit_plan', 'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_amend_task', 'agent_teams_resume', 'agent_teams_delete']) {
      expect(MEMBER_DENIED_TOOL_NAMES).toContain(name)
    }
  })

  it('accounts for every team tool as either allowed or denied to a member', () => {
    // No tool may be silently neither: an unlisted tool is exposed to members
    // by default, which is exactly how a denylist rots.
    for (const name of TEAM_TOOL_NAMES) {
      const allowed = MEMBER_TOOL_NAMES.includes(name)
      const denied = MEMBER_DENIED_TOOL_NAMES.includes(name)
      expect(allowed || denied, `${name} is neither allowed nor denied`).toBe(true)
      expect(allowed && denied, `${name} is both allowed and denied`).toBe(false)
    }
  })
})

describe('TEAM_MEMBER_PROMPT', () => {
  it('no longer forbids a member from creating a team', () => {
    // The old wording said "Do not create, approve, edit or resume a team",
    // which contradicted the dispatch path the owner designed.
    expect(TEAM_MEMBER_PROMPT).not.toMatch(/Do not create/)
    expect(TEAM_MEMBER_PROMPT).toContain('Do not approve, edit or resume a team')
  })

  it('still tells the member to report to the captain', () => {
    expect(TEAM_MEMBER_PROMPT).toContain('report completion or failure to the captain')
  })
})

describe('TEAM_MEMBER_DISPATCH_RULE', () => {
  it('tells a member to open a small team instead of doing the work inline', () => {
    expect(TEAM_MEMBER_DISPATCH_RULE).toContain('agent_teams_create')
    expect(TEAM_MEMBER_DISPATCH_RULE).toContain('临时开一个小团队')
  })

  it('does not pin a fixed headcount — difficulty decides', () => {
    // The owner was explicit: how many members a team needs depends on how hard
    // the task is, so the rule must not read as a fixed number.
    expect(TEAM_MEMBER_DISPATCH_RULE).toContain('按任务难度定')
  })

  it('requires independent teams for concurrent requests, not a queue', () => {
    expect(TEAM_MEMBER_DISPATCH_RULE).toContain('互不影响')
    expect(TEAM_MEMBER_DISPATCH_RULE).toContain('不要排队')
  })
})

describe('memberNamingRule', () => {
  it('hands the member the same twenty posts the captain uses', () => {
    const rule = memberNamingRule(TEAM_POST_ROSTER)
    for (const post of TEAM_POST_ROSTER) expect(rule).toContain(post)
  })

  it('explains that the name is what selects the portrait', () => {
    expect(memberNamingRule(TEAM_POST_ROSTER)).toContain('头像')
  })
})
