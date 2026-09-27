/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import { onAgentReady } from "./harness-compat.js";
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTeamSync, readRetiredMemberIdsSync } from "./state.js";
import { MEMBER_DENIED_TOOL_NAMES } from "./tool-names.js";
export const TEAM_ACTIVATION_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.';
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.';
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
export const TEAM_MEMBER_DISPATCH_RULE = `收到 @ 到你的活时：不要自己闷头做完，而是为这个活临时开一个小团队（用 agent_teams_create，成员数按任务难度定，简单的两三个、复杂的多几个），把活派给他们，然后汇总结果回报给派活给你的人。中途再收到另一个不相关的活，就再开一个独立团队，两个团队互不影响，不要排队。团队跑完就结束掉。`;
/**
 * The naming rule a member applies when he staffs his own temporary team.
 *
 * Shares `TEAM_POST_ROSTER` with the captain's rule so a member-opened team
 * draws the same portraits: the client matches artwork by name, so a member
 * who invented his own names would staff a team of bare initials.
 * @param roster - the twenty posts (`TEAM_POST_ROSTER`); passed in because the
 * constant is declared below this doc comment.
 */
export function memberNamingRule(roster) {
    return `给你的临时团队成员命名时，同样只用这二十个岗位名（写在 member.name），头像才会正确匹配：${roster.join('、')}。`;
}
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
export const TEAM_POST_ROSTER = [
    '钦天监监正',
    '灵台主事',
    '时宪主事',
    '典籍掌事',
    '星禁掌察',
    '观象访事',
    '星图主事',
    '象绘主事',
    '星绘主事',
    '传报主事',
    '灵台郎',
    '历算主事',
    '星仪主事',
    '数象主事',
    '推步主事',
    '星验主事',
    '星机校验',
    '天象值守',
    '星文审校',
    '录典主事',
];
/** The naming rule appended to the captain prompt (see `TEAM_POST_ROSTER`). */
export const TEAM_NAMING_RULE = `用下面二十个岗位名给每个成员命名，成员头像就是按这个名字匹配的；名单之外的名字只会显示成一个光秃秃的姓名字头。请把岗位名写进 \`member.name\`（\`member.role\` 可写该岗位对应的现代岗位，如「后端开发工程师」）：${TEAM_POST_ROSTER.join('、')}。`;
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
export function orgRuleText(treeText) {
    return `常驻编制按下面的组织结构安置；成员被 @ 到才动，收到活就自己开一个临时 DAG 团队去干，多个 DAG 互不打扰：\n${treeText}`;
}
function stateRoot(agent, config) {
    return join(agent.session.header.cwd ?? process.cwd(), config.stateDir);
}
/** Synchronous startup/HMR hydration must finish before the first assembly. */
function currentTeam(agent, config) {
    const root = stateRoot(agent, config);
    let entries;
    try {
        entries = readdirSync(root, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    let found;
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'archive')
            continue;
        const team = readTeamSync(root, entry.name);
        if (team === undefined || (team.captainSessionId !== agent.id
            && !team.members.some(member => member.id === agent.id)))
            continue;
        if (found !== undefined)
            throw new Error('ambiguous AgentTeams membership');
        found = team;
    }
    return found;
}
/** Call once, after all business definitions have registered. Never per member. */
export function installTeamCapabilities(ctx, config) {
    const states = new WeakMap();
    const active = new Set();
    let mounted = true;
    // Snapshot policy once: profiles, team state, and tool results must never
    // rewrite this prefix or control whether core instructions are available.
    const captainPrompt = `${TEAM_ACTIVATION_PROMPT}\n\n${TEAM_NAMING_RULE}\n\n${orgRuleText(config.orgTreeText)}${config.captainPrompt() === '' ? '' : `\n\n${config.captainPrompt()}`}`;
    function attach(agent) {
        const prior = states.get(agent);
        if (prior !== undefined)
            return prior;
        if (!mounted)
            throw new Error('AgentTeams capability provider is disposed');
        // Determine a member's role before its first request and retain it for the
        // lifetime of this scope. Team creation/archive must never rewrite the
        // captain's system/tools prefix, even after a long ordinary conversation.
        let member = config.isPendingMember(agent);
        try {
            member ||= readRetiredMemberIdsSync(stateRoot(agent, config)).has(agent.id);
            const team = currentTeam(agent, config);
            member ||= team !== undefined && team.captainSessionId !== agent.id;
        }
        catch (error) {
            // Unrelated damaged state must not disable ordinary conversation.
            // Business tools still validate durable team state before acting.
            ctx.logger.warn(`agent-teams: capability hydration failed: ${String(error)}`);
        }
        const state = { member, dispose: () => undefined };
        let revoke;
        let disposed = false;
        let releaseLifetime;
        state.dispose = () => {
            if (disposed)
                return;
            disposed = true;
            revoke?.();
            releaseLifetime?.();
            states.delete(agent);
            active.delete(state);
        };
        states.set(agent, state);
        active.add(state);
        try {
            if (member)
                revoke = agent.ctx.tools.restrict({ deny: MEMBER_DENIED_TOOL_NAMES });
        }
        catch (error) {
            // A live scope must accept the member restriction; anything else is a
            // real wiring fault and must stay loud.
            state.dispose();
            throw error;
        }
        try {
            releaseLifetime = agent.ctx.effect(() => state.dispose, 'agent-teams: capability lifetime');
        }
        catch (error) {
            // Ownership is notional here. `attach` also runs over `ctx.agents.list()`,
            // which can report an agent whose scope carrier is already torn down
            // (cordis clears the fiber's uid on dispose, so `effect` throws
            // INACTIVE_EFFECT). Letting that escape fails this whole plugin's apply
            // and disables team tools for every agent, so a lifetime we cannot own
            // is skipped: the exposure stays attached and the outer
            // `agent-teams: capability scopes` effect in `installTeamCapabilities`
            // still disposes it.
            ctx.logger.warn(`agent-teams: capability lifetime not owned by the agent scope: ${String(error)}`);
        }
        return state;
    }
    ctx.systemPrompt.section({
        name: 'agent-teams:usage', order: config.order ?? 117,
        text: ({ agent }) => {
            // A member gets his own contract, not a captain prompt with the create
            // tool politely withheld: members are allowed to open the small team
            // that does their assigned work, so the rules he needs are about
            // dispatching and reporting, not about abstaining.
            return agent !== undefined && states.get(agent)?.member
                ? `${TEAM_MEMBER_PROMPT}\n\n${TEAM_MEMBER_DISPATCH_RULE}\n\n${memberNamingRule(TEAM_POST_ROSTER)}`
                : captainPrompt;
        },
    });
    onAgentReady(ctx, agent => { attach(agent); });
    ctx.effect(() => () => {
        mounted = false;
        for (const state of [...active])
            state.dispose();
    }, 'agent-teams: capability scopes');
    // Hydrate the agents already live when this plugin mounts. One unusable
    // scope must not abandon the rest: `attach` is the only writer of
    // `states`, and the prompt section above reads it for every request.
    for (const agent of ctx.agents.list()) {
        try {
            attach(agent);
        }
        catch (error) {
            ctx.logger.warn(`agent-teams: capability hydration skipped for one agent: ${String(error)}`);
        }
    }
}
