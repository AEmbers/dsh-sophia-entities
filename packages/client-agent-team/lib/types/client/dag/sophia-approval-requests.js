/**
 * Host routes for the Sophia approval card. The client is a leaf — durable
 * truth lives on the Node side, so every interaction posts the full action
 * record and lets the host settle the state; local UI never guesses.
 * @module dsh-sophia-entities/client/sophia-approval-requests
 */
import { zh } from "./locales.js";
import { APPROVALS_STATE_URL } from "./sophia-approval-badge.js";
/** POST body target for approval-plan actions (design §4.4.2 / routes.ts). */
export const APPROVALS_PLAN_URL = '/plugins/dsh-sophia-entities/approvals/plan';
/** Locale key that renders each known refusal. */
export const APPROVAL_REFUSAL_KEYS = {
    not_awaiting_owner: 'approval.error.notAwaitingOwner',
    not_awaiting_captain: 'approval.error.notAwaitingCaptain',
    captain_only: 'approval.error.captainOnly',
    human_only: 'approval.error.humanOnly',
    empty_plan: 'approval.error.emptyPlan',
    materialize_failed: 'approval.error.materializeFailed',
};
/** Wording for a refusal the host gave no code for, and for anything raw. */
export const APPROVAL_ERROR_GENERIC_KEY = 'approval.error.generic';
const APPROVAL_REFUSAL_CODES = new Set(Object.keys(APPROVAL_REFUSAL_KEYS));
/** Narrow the host's `code` field to the refusals this build knows. */
export function approvalRefusalCode(value) {
    return typeof value === 'string' && APPROVAL_REFUSAL_CODES.has(value)
        ? value
        : undefined;
}
/**
 * One refused plan action, carrying wording the UI is allowed to show.
 *
 * `message` is Simplified Chinese — the dictionary's source of truth — so a
 * caller with no translator still renders a sentence rather than the host's
 * own text; `messageKey` is what a localized surface renders instead. The
 * host's raw sentence survives as `hostMessage` for logs only.
 */
export class ApprovalPlanError extends Error {
    /** The refusal code, when the host named one this build knows. */
    code;
    /** The state the host reported for the request, when it reported one. */
    state;
    /** HTTP status of the refused response. */
    status;
    /** Locale key a translated surface renders. */
    messageKey;
    /** The host's own `error` string; diagnostics only, never the UI. */
    hostMessage;
    constructor(status, code, state, hostMessage) {
        const messageKey = code === undefined ? APPROVAL_ERROR_GENERIC_KEY : APPROVAL_REFUSAL_KEYS[code];
        super(zh[messageKey]);
        this.name = 'ApprovalPlanError';
        this.code = code;
        this.state = state;
        this.status = status;
        this.messageKey = messageKey;
        this.hostMessage = hostMessage;
    }
}
/** Sentences that name host internals instead of telling the user anything. */
const UNSAFE_APPROVAL_TEXT = [
    /is not awaiting/i,
    /pending_(?:owner|captain)/i,
    /\brequest\s+[0-9a-f]{4,}/i,
    /\bHTTP\s*\d{3}\b/i,
];
/**
 * Keep a string the UI may show. Anything that would leak a state name, a
 * request id or a bare HTTP status becomes the generic wording instead.
 */
export function sanitizeApprovalMessage(message) {
    const text = message.trim();
    if (text === '')
        return zh[APPROVAL_ERROR_GENERIC_KEY];
    return UNSAFE_APPROVAL_TEXT.some((pattern) => pattern.test(text))
        ? zh[APPROVAL_ERROR_GENERIC_KEY]
        : text;
}
/** Fold the host's snake_case result body into the card's result shape. */
function parsePlanResult(body) {
    if (typeof body !== 'object' || body === null)
        return undefined;
    const raw = body;
    const result = {};
    if (typeof raw['request_id'] === 'string')
        result.requestId = raw['request_id'];
    if (typeof raw['state'] === 'string')
        result.state = raw['state'];
    if (raw['mode'] === 'persistent' || raw['mode'] === 'dag')
        result.mode = raw['mode'];
    if (raw['materialized'] === true)
        result.materialized = true;
    if (typeof raw['team_ref'] === 'string')
        result.teamRef = raw['team_ref'];
    return result;
}
/**
 * Fire one approval-plan action at the host. Mirrors the AgentTeams plan
 * mutation fetch (`mutatePlan`): posts JSON and rejects with an
 * `ApprovalPlanError` on any non-ok response. The host's own sentence stays on
 * that error as `hostMessage`; what the UI renders is the mapped wording.
 *
 * `sessionId` is the session the card is rendered in, and it is REQUIRED: the
 * host route authenticates the browser as the human operator but still refuses
 * the action with 400 `sessionId is required` (or 409 `human session is not
 * attached`) unless the owning session id rides in the body. Omitting it made
 * every owner interaction — approve, reject, and the mode switch — fail with no
 * visible effect.
 *
 * The resolved value is the host's own verdict. An ok response whose body is
 * empty or unreadable resolves to `undefined` (the action still succeeded).
 */
export async function postApprovalPlanAction(sessionId, payload) {
    const owner = sessionId.trim();
    if (owner === '')
        throw new Error('approval actions require the viewing session id');
    const response = await fetch(APPROVALS_PLAN_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, sessionId: owner }),
    });
    if (!response.ok) {
        let hostMessage;
        let code;
        let state;
        try {
            const body = await response.json();
            if (typeof body.error === 'string' && body.error.trim() !== '')
                hostMessage = body.error;
            code = approvalRefusalCode(body.code);
            if (typeof body.state === 'string')
                state = body.state;
        }
        catch { }
        throw new ApprovalPlanError(response.status, code, state, hostMessage);
    }
    try {
        return parsePlanResult(await response.json());
    }
    catch {
        return undefined;
    }
}
/**
 * Read the live queue and report what it says about `requestId`. The card is
 * rendered from immutable conversation records, so a request decided earlier —
 * by this card, by the captain, or from another paired device — stays
 * "pending" in the transcript forever. This is how the card learns otherwise.
 */
export async function fetchApprovalRequestState(requestId) {
    if (requestId.trim() === '')
        return undefined;
    try {
        const response = await fetch(APPROVALS_STATE_URL, { cache: 'no-store' });
        if (!response.ok)
            return undefined;
        const body = await response.json();
        if (typeof body !== 'object' || body === null || !Array.isArray(body.requests))
            return undefined;
        for (const row of body.requests) {
            if (typeof row !== 'object' || row === null)
                continue;
            const entry = row;
            if (entry.id !== requestId)
                continue;
            if (typeof entry.state !== 'string')
                return undefined;
            return typeof entry.mode === 'string'
                ? { kind: 'state', state: entry.state, mode: entry.mode }
                : { kind: 'state', state: entry.state };
        }
        return 'absent';
    }
    catch {
        return undefined;
    }
}
/**
 * Normalize an unknown thrown value into wording the UI may show: a refusal
 * renders through `t` when the caller has a translator, and everything else is
 * scrubbed of host internals before it reaches a surface.
 */
export function approvalErrorMessage(error, t) {
    if (error instanceof ApprovalPlanError) {
        return t === undefined ? error.message : t(error.messageKey);
    }
    return sanitizeApprovalMessage(error instanceof Error ? error.message : String(error));
}
