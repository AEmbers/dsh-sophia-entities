/**
 * AgentTeams activity panel: the top-right floater monitoring every team.
 *
 * Modeled on the Claude Code desktop SessionActivityPanel: a shell-overlay
 * panel that docks at the conversation's top-right edge by default, can be
 * dragged into a floating window, resized, and folded into an activity badge.
 * On wide viewports the docked panel makes the conversation column yield
 * space; narrow viewports keep a simple inset overlay. It
 * polls the host `/plugins/dsh-sophia-entities/state` route for
 * server-side snapshots (durable files + live subagent activity), with a
 * collapsed badge that auto-expands once when activity appears. Archived
 * teams stay available for the owning conversation after live work ends.
 *
 * The floater mounts in ui-layout's additive `shell.overlay`; it is not a
 * conversation node — the in-conversation panel was removed in favor of this
 * always-available monitor.
 * @module dsh-agent-teams/client/activity
 */
import type { ModelDirectory, ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import { type ActivityTeam } from './activity-monitor.ts';
import type { AgentTeamsCardData } from './agent-teams-card-definition.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/**
 * Pending team proposals awaiting the Human owner, rendered INSIDE the activity
 * panel.
 *
 * The in-conversation approval card only exists while its `sophia_team_propose`
 * tool call is inside the loaded chat window (the host's assembler folds that
 * window and nothing older), so a proposal filed earlier in a long session was
 * unreachable: the badge counted it, but neither the card nor the panel showed
 * it and the badge's click had nowhere to go. The panel is always mounted, so
 * it reads the same host queue the badge polls and offers the owner controls
 * here — one durable place to approve, independent of chat scrollback.
 *
 * Only a `pending_owner` row is the owner's to decide. A `pending_captain` row
 * is waiting on the captain, so it renders a non-interactive label: showing
 * [批准][退回] there answered every click with the host's refusal, because the
 * owner route is not the route that settles it.
 */
export declare function PendingApprovals({ sessionId, onRows, placement, t }: {
    readonly sessionId: string;
    readonly onRows?: (count: number) => void;
    /** `panel` sits inside the floater; `surface` leads the right-pane monitor. */
    readonly placement?: 'panel' | 'surface';
    readonly t: AgentTeamsTranslate;
}): import("react").JSX.Element | null;
export declare function TeamSection({ team, modelDirectory, onContinuePlanning, onDiscarded, onNavigate, t, historic, workspace }: {
    readonly team: ActivityTeam;
    readonly modelDirectory?: ModelDirectory;
    readonly onContinuePlanning?: () => void;
    readonly onDiscarded?: () => void;
    /** Navigate to a member transcript (floater hides immediately). */
    readonly onNavigate: (parentId: SessionId, childId: SessionId) => void;
    readonly t: AgentTeamsTranslate;
    readonly historic?: boolean;
    readonly workspace?: boolean;
}): import("react").JSX.Element;
/** Legacy conversation cards may outlive their host archive. Project their
 * durable roster through the same rebuilt panel instead of a second UI. */
export declare function historicCardTeam(data: AgentTeamsCardData, owner: string): ActivityTeam;
/** The top-right activity floater. Teams follow the current session: live
 * snapshots and historic card summaries are only shown while their captain
 * session is the one currently open. */
export type ActivityPanelProps = {
    readonly conversationVisible?: boolean;
    readonly sessionsList: ObservableSnapshot<SessionListState>;
    readonly modelDirectories: ModelDirectoryResolver;
    readonly openMember: (parentId: SessionId, childId: SessionId) => void;
} & PropsLocale<'sophiaEntities'>;
export declare function ActivityPanel({ sessionsList, modelDirectories, openMember, t, conversationVisible }: ActivityPanelProps): import("react").JSX.Element | null;
//# sourceMappingURL=ActivityPanel.d.ts.map