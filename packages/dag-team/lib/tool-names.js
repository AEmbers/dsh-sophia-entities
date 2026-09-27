/** Stable business API names; exposure changes never rename these operations. */
export const TEAM_TOOL_NAMES = [
    'agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan',
    'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task',
    'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task',
    'agent_teams_amend_task',
    'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete',
];
/**
 * The tools a member keeps.
 *
 * `agent_teams_create` is deliberately included: a standing member's job is to
 * take the work that reached him by `@` and open a SMALL team sized to that job
 * rather than doing it inline, which is what lets two requests run as two
 * independent teams instead of queuing behind each other. He still cannot
 * approve, edit a plan, add or remove members of someone else's team, resume a
 * halted team, or delete a team — those stay with the captain/human. The depth
 * of what he may open is bounded at runtime by `memberMaxDepth`
 * (`installMemberDelegationGuard`), not by this list.
 */
export const MEMBER_TOOL_NAMES = [
    'agent_teams_create',
    'agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status',
];
/**
 * Tools only a captain holds: approval is a human decision, and roster/plan
 * surgery mutates a team the member did not open.
 */
export const MEMBER_DENIED_TOOL_NAMES = [
    'agent_teams_approve', 'agent_teams_edit_plan',
    'agent_teams_add_member', 'agent_teams_remove_member',
    'agent_teams_create_task', 'agent_teams_reassign_task', 'agent_teams_amend_task',
    'agent_teams_resume', 'agent_teams_delete',
];
export const CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name));
