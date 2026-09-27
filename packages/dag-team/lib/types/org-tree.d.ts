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
/** One of the four bureaux, or the director's own office. */
export interface OrgBureau {
    /** Stable key, for a proposal's member grouping. */
    readonly id: string;
    /** Display name of the bureau, e.g. 总控司. */
    readonly label: string;
    /** What this bureau is for, in one line. */
    readonly mandate: string;
    /** The chief's post title; the bureau's members report to him. */
    readonly chief?: string;
    /** Post titles that belong to this bureau, chief included. */
    readonly members: readonly string[];
}
/**
 * The designed organisation. Order matters: it is the order the roster should
 * be presented in (director, then the senior office, then the three delivery
 * bureaux), so panels and proposals read the same way the owner drew it.
 */
export declare const ORG_TREE: readonly OrgBureau[];
/** Every post in tree order, flattened. */
export declare const ORG_POSTS: readonly string[];
/**
 * The director's post. It is a member like any other — the owner's team has a
 * real 监正 Agent that meets the Human, rather than the owner playing that
 * role himself — but it is drawn as the root because every bureau reports
 * through it.
 */
export declare const ORG_DIRECTOR_POST = "\u94A6\u5929\u76D1\u76D1\u6B63";
/** The twenty posts the tree must account for exactly. */
export declare const ORG_EXPECTED_SIZE: 20;
/** Bureau a post belongs to, or undefined for an unknown post. */
export declare function bureauOfPost(post: string): OrgBureau | undefined;
/** The post's direct superior: its bureau chief, or the director at the top. */
export declare function superiorOfPost(post: string): string | undefined;
/** True when the tree covers the post roster exactly: same names, no extras. */
export declare function orgTreeMatchesRoster(): boolean;
/**
 * The organisation, rendered for a captain prompt: which bureaux exist, who
 * leads each, and who reports where. Kept as one string so the usage policy
 * stays a single prompt section.
 */
export declare const ORG_TREE_TEXT: string;
//# sourceMappingURL=org-tree.d.ts.map