import type { AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types';
import type { TeamSidebarProps } from './slots.ts';
/**
 * Sidebar Member avatar reusing the conversation identity language: the
 * member OC portrait when matched (falling back to deterministic hue and
 * handle initial on image error or missing artwork), with the presence
 * indicator overlaid at the bottom-right so one glyph carries identity and state.
 */
export declare function TeamMemberAvatar({ status, t }: {
    readonly status: AgentTeamClientMemberStatus;
    readonly t: TeamSidebarProps['t'];
}): import("react").JSX.Element;
//# sourceMappingURL=TeamMemberAvatar.d.ts.map