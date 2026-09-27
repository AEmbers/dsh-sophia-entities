/** Browser plugin for the AgentTeams activity floater and conversation card. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type AgentTeamsLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** AgentTeams conversation card and activity monitor copy. */
        sophiaEntities: AgentTeamsLocaleKey;
    }
}
/**
 * Required services: conversation nodes, slots, sessions navigation, and locale.
 *
 * `sidebarRight` / `sidebarRightTabs` are deliberately NOT listed here. They are
 * optional right-pane hosts: a host (or a test composition) without them must
 * still get the approval badge and the two conversation cards. Declaring them
 * made the whole module suspend — `mount would suspend: missing service(s)
 * sidebarRight, sidebarRightTabs — provide() them first` — and took the badge
 * and both cards down with it. The right-pane contributions are registered
 * through the scoped `ctx.inject` below instead, so their absence removes only
 * the panel and its tab.
 */
export declare const inject: string[];
/**
 * Register the activity monitor in the shell's additive overlay and the
 * in-conversation team card. The card's activity button re-opens a folded
 * monitor via a window event — the recovery path for an old session.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map