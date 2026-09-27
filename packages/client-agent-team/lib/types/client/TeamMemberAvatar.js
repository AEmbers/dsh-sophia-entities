import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { useAvatarImage } from "./avatar-image.js";
import { memberArtUrl } from "./dag/artwork.js";
import { memberHue } from "./team-formatters.js";
import { presenceDotState, presenceLabel } from "./TeamPresenceDot.js";
import { TeamStateDot } from "./TeamStateDot.js";
import css from './sidebar.module.css';
/**
 * Sidebar Member avatar reusing the conversation identity language: the
 * member OC portrait when matched (falling back to deterministic hue and
 * handle initial on image error or missing artwork), with the presence
 * indicator overlaid at the bottom-right so one glyph carries identity and state.
 */
export function TeamMemberAvatar({ status, t }) {
    const label = presenceLabel(status, t);
    const state = presenceDotState(status.presence);
    const artUrl = memberArtUrl(status.member.handle.replace(/^@/, ''), status.member.description);
    const avatar = useAvatarImage(artUrl ?? undefined);
    const hasArt = avatar.src !== undefined;
    return (_jsx(Tooltip, { label: label, delayMs: 300, children: _jsxs("span", { className: css.agentAvatar, "data-has-art": hasArt ? 'true' : undefined, style: hasArt ? undefined : { '--team-avatar-hue': memberHue(status.member.memberId) }, role: "img", "aria-label": label, children: [hasArt ? (_jsx("img", { className: css.agentArt, src: avatar.src, alt: "", "aria-hidden": "true", onError: avatar.failed })) : (status.member.handle.replace('@', '').slice(0, 1).toUpperCase()), _jsx("span", { className: css.agentAvatarBadge, "aria-hidden": "true", children: _jsx(TeamStateDot, { state: state }) })] }) }));
}
