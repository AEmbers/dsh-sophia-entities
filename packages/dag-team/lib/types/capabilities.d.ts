import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare const TEAM_ACTIVATION_PROMPT = "AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.";
export declare const TEAM_MEMBER_PROMPT = "You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.";
/**
 * What a standing member is told to do with work that arrives by `@`.
 *
 * This is the behaviour the owner designed the organisation around: twenty
 * posts sit in one Channel and stay asleep; a post that is mentioned wakes,
 * and rather than doing the work inline he opens a SMALL team sized to that
 * job and hands it out. Two mentions therefore become two independent teams
 * that cannot block each other, which is the whole point — one post doing its
 * work serially would queue every later request behind the first.
 *
 * The depth of what he may open is bounded by `memberMaxDepth`, not by this
 * text: `installMemberDelegationGuard` refuses the spawn above it, so the
 * budget stays a runtime fact rather than a promise the model can ignore.
 */
export declare const TEAM_MEMBER_DISPATCH_RULE = "\u6536\u5230 @ \u5230\u4F60\u7684\u6D3B\u65F6\uFF1A\u4E0D\u8981\u81EA\u5DF1\u95F7\u5934\u505A\u5B8C\uFF0C\u800C\u662F\u4E3A\u8FD9\u4E2A\u6D3B\u4E34\u65F6\u5F00\u4E00\u4E2A\u5C0F\u56E2\u961F\uFF08\u7528 agent_teams_create\uFF0C\u6210\u5458\u6570\u6309\u4EFB\u52A1\u96BE\u5EA6\u5B9A\uFF0C\u7B80\u5355\u7684\u4E24\u4E09\u4E2A\u3001\u590D\u6742\u7684\u591A\u51E0\u4E2A\uFF09\uFF0C\u628A\u6D3B\u6D3E\u7ED9\u4ED6\u4EEC\uFF0C\u7136\u540E\u6C47\u603B\u7ED3\u679C\u56DE\u62A5\u7ED9\u6D3E\u6D3B\u7ED9\u4F60\u7684\u4EBA\u3002\u4E2D\u9014\u518D\u6536\u5230\u53E6\u4E00\u4E2A\u4E0D\u76F8\u5173\u7684\u6D3B\uFF0C\u5C31\u518D\u5F00\u4E00\u4E2A\u72EC\u7ACB\u56E2\u961F\uFF0C\u4E24\u4E2A\u56E2\u961F\u4E92\u4E0D\u5F71\u54CD\uFF0C\u4E0D\u8981\u6392\u961F\u3002\u56E2\u961F\u8DD1\u5B8C\u5C31\u7ED3\u675F\u6389\u3002";
/**
 * The naming rule a member applies when he staffs his own temporary team.
 *
 * Shares `TEAM_POST_ROSTER` with the captain's rule so a member-opened team
 * draws the same portraits: the client matches artwork by name, so a member
 * who invented his own names would staff a team of bare initials.
 * @param roster - the twenty posts (`TEAM_POST_ROSTER`); passed in because the
 * constant is declared below this doc comment.
 */
export declare function memberNamingRule(roster: readonly string[]): string;
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
/**
 * The organisation the二十个岗位 form, appended to the captain prompt.
 *
 * A flat list of twenty posts says who may be staffed but not who answers to
 * whom, and the captain is the one assembling a roster. The tree is loaded
 * lazily through a parameter rather than imported here, because `org-tree.ts`
 * already reads `TEAM_POST_ROSTER` from this module — importing it back would
 * close a cycle.
 * @param treeText - the rendered tree (`ORG_TREE_TEXT`).
 * @returns the prompt section stating the reporting structure.
 */
export declare function orgRuleText(treeText: string): string;
interface CapabilityConfig {
    stateDir: string;
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    /**
     * The rendered organisation tree, so the captain prompt can state the
     * reporting structure. Passed in rather than imported: `org-tree.ts` reads
     * `TEAM_POST_ROSTER` from this module, so importing it back would be a cycle.
     */
    orgTreeText: string;
    order?: number;
}
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};
//# sourceMappingURL=capabilities.d.ts.map