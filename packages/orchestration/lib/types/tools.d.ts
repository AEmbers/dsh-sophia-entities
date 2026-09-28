import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { SophiaTeamFacade, CallerIdentity } from './facade.ts';
/** How the host turns a tool execution into a caller identity. */
export interface ApprovalToolDependencies {
    facade: SophiaTeamFacade;
    /** Derive who is calling from the tool execution context. */
    resolveCaller(exec: ToolRunContext): Promise<CallerIdentity>;
    /**
     * Hands the deciding caller's session to the DAG backend before an approval
     * runs, exactly as the HTTP plan route does. The facade carries no team state
     * of its own, and the DAG backend cannot materialize without a captain plus a
     * state root — so a tool-path approval (the model calling
     * `sophia_team_approve`) needs this hook just as much as the card's POST does.
     * Omitted by a host with no DAG backend wired.
     */
    bindDagCaptain?: (caller: CallerIdentity) => void;
}
export interface ApprovalToolSet {
    propose: unknown;
    review: unknown;
    approve: unknown;
    addMember: unknown;
    removeMember: unknown;
    updateMemberModel: unknown;
}
/**
 * Register the three approval tools on a cordis context.
 * @returns the three definitions, for tool-surface composition (member tool
 *          filters include only `propose`, design §4.3.3).
 */
export declare function registerApprovalTools(ctx: {
    tools: {
        register(tool: unknown): void;
    };
}, dependencies: ApprovalToolDependencies): ApprovalToolSet;
//# sourceMappingURL=tools.d.ts.map