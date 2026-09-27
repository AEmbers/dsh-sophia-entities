/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import { onAgentReady } from "./harness-compat.js";
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readTeamSync, readRetiredMemberIdsSync } from "./state.js";
import { MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from "./tool-names.js";
export const TEAM_ACTIVATION_PROMPT = 'AgentTeams (Agent Teams) provides multi-agent team collaboration. Apply these rules when the user requests it (including /agent-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining AgentTeams alone is not a request to start work.';
export const TEAM_MEMBER_PROMPT = 'You are an AgentTeams member. Follow your assigned member persona and task contract. Use agent_teams_claim_task, agent_teams_update_task, agent_teams_send_message and agent_teams_status for your own work. Include the current attempt_id in updates; report completion or failure to the captain. Do not create, approve, edit or resume a team. If your durable membership is unavailable, report that to the parent instead of creating a replacement.';
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
    const captainPrompt = `${TEAM_ACTIVATION_PROMPT}\n\n${TEAM_NAMING_RULE}\n\n${config.captainPrompt()}`;
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
                revoke = agent.ctx.tools.restrict({
                    deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)),
                });
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
            return agent !== undefined && states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt;
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
