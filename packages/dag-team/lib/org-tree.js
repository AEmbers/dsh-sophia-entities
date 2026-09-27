/**
 * 钦天监 organisation tree — the standing roster the owner designed.
 *
 * The twenty posts are not a flat list: they form four 司 (bureaux) under one
 * 监正 (the director), and each bureau has one 负责人 (chief) who is himself a
 * post. This module is the single source of that structure, shared by
 *   - the captain prompt (so a captain staffs the right shape),
 *   - the org-tree proposal path (so one approval can stand the whole thing
 *     up), and
 *   - the activity panel (so the roster draws as a tree, not a queue).
 *
 * NUMBERS EACH OTHER — the Human owner is NOT a member. The host counts only
 * AI members against its `maxMembers`, so this tree holds exactly twenty AI
 * posts and the owner sits outside it.
 *
 * The names here are the authority for BOTH the display label and the OC
 * portrait: the client's `memberArtUrl` matches a member's name/role against
 * these exact words (`packages/client-agent-team/src/client/dag/artwork.ts`),
 * so a rename in this file without the matching artwork entry would strip the
 * portrait. `tests/post-roster.spec.ts` pins that pairing.
 */
import { TEAM_POST_ROSTER } from "./capabilities.js";
/**
 * The designed organisation. Order matters: it is the order the roster should
 * be presented in (director, then the senior office, then the three delivery
 * bureaux), so panels and proposals read the same way the owner drew it.
 */
export const ORG_TREE = Object.freeze([
    Object.freeze({
        id: 'director',
        label: '监正',
        mandate: '与主人对接的唯一入口；拆解任务、按需派发、汇总结果',
        members: Object.freeze(['钦天监监正']),
    }),
    Object.freeze({
        id: 'general',
        label: '总控司',
        mandate: '高管常驻组：定方向、排时序、管资源、控风险',
        members: Object.freeze(['灵台主事', '时宪主事', '典籍掌事', '星禁掌察']),
    }),
    Object.freeze({
        id: 'observation',
        label: '观象司',
        mandate: '产品设计组：从需求洞察到产品定义与体验设计',
        chief: '灵台主事',
        members: Object.freeze(['观象访事', '星图主事', '象绘主事', '星绘主事', '传报主事']),
    }),
    Object.freeze({
        id: 'algorithm',
        label: '历算司',
        mandate: '研发技术组：从底层架构到上层界面',
        chief: '灵台郎',
        // The chief is the bureau's first member: he leads it AND works in it, so
        // he must be staffed like anyone else. Listing him only as `chief` left
        // him out of the roster entirely.
        members: Object.freeze(['灵台郎', '历算主事', '星仪主事', '数象主事', '推步主事']),
    }),
    Object.freeze({
        id: 'verification',
        label: '星验司',
        mandate: '测试运维文档组：守住质量、稳定性与知识沉淀',
        chief: '星验主事',
        members: Object.freeze(['星验主事', '星机校验', '天象值守', '星文审校', '录典主事']),
    }),
]);
/** Every post in tree order, flattened. */
export const ORG_POSTS = Object.freeze(ORG_TREE.flatMap(bureau => [...bureau.members]));
/**
 * The director's post. It is a member like any other — the owner's team has a
 * real 监正 Agent that meets the Human, rather than the owner playing that
 * role himself — but it is drawn as the root because every bureau reports
 * through it.
 */
export const ORG_DIRECTOR_POST = '钦天监监正';
/** The twenty posts the tree must account for exactly. */
export const ORG_EXPECTED_SIZE = TEAM_POST_ROSTER.length;
/** Bureau a post belongs to, or undefined for an unknown post. */
export function bureauOfPost(post) {
    return ORG_TREE.find(bureau => bureau.members.includes(post));
}
/** The post's direct superior: its bureau chief, or the director at the top. */
export function superiorOfPost(post) {
    if (post === ORG_DIRECTOR_POST)
        return undefined;
    const bureau = bureauOfPost(post);
    // A chief answers to the director — including a chief who is listed among
    // his own bureau's members, who must not be reported as his own superior.
    if (bureau?.chief !== undefined && post !== bureau.chief)
        return bureau.chief;
    return ORG_DIRECTOR_POST;
}
/** True when the tree covers the post roster exactly: same names, no extras. */
export function orgTreeMatchesRoster() {
    const inTree = new Set(ORG_POSTS);
    if (inTree.size !== ORG_POSTS.length)
        return false;
    if (inTree.size !== ORG_EXPECTED_SIZE)
        return false;
    return TEAM_POST_ROSTER.every(post => inTree.has(post));
}
/**
 * The organisation, rendered for a captain prompt: which bureaux exist, who
 * leads each, and who reports where. Kept as one string so the usage policy
 * stays a single prompt section.
 */
export const ORG_TREE_TEXT = [
    `${ORG_DIRECTOR_POST}（总控，与主人对接）`,
    ...ORG_TREE.slice(1).map(bureau => {
        const chief = bureau.chief === undefined ? '' : `（负责人：${bureau.chief}）`;
        return `  ${bureau.label}${chief}：${bureau.members.join('、')}`;
    }),
].join('\n');
