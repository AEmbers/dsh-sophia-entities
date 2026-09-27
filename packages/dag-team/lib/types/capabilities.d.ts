import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare const TEAM_ACTIVATION_PROMPT = "AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.";
export declare const TEAM_MEMBER_PROMPT = "You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.";
/**
 * The twenty posts a member name or role is drawn from, paired with the OC
 * portrait each one wears.
 *
 * The client resolves a member's artwork by matching its `name` and `role`
 * against these words (`memberArtUrl` in `packages/client-agent-team`), so a
 * roster that invents names outside this list renders as a bare initial
 * instead of a portrait. Naming is therefore not cosmetic: use a post here —
 * spelled as one of its listed words — for `member.name` or `member.role`.
 *
 * Kept in sync with `OC_ROLE_ART` in
 * `packages/client-agent-team/src/client/dag/artwork.ts`, which is the
 * authority; `tests/capabilities.spec.ts` pins the pairing.
 */
export declare const TEAM_POST_ROSTER: readonly ["钦天监监正", "灵台主事", "时宪主事", "典籍掌事", "星禁掌察", "观象访事", "星图主事", "象绘主事", "星绘主事", "传报主事", "灵台郎", "历算主事", "星仪主事", "数象主事", "推步主事", "星验主事", "星机校验", "天象值守", "星文审校", "录典主事"];
/** The naming rule appended to the captain prompt (see `TEAM_POST_ROSTER`). */
export declare const TEAM_NAMING_RULE: string;
interface CapabilityConfig {
    stateDir: string;
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    order?: number;
}
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};
//# sourceMappingURL=capabilities.d.ts.map