import { sanitizeTerminalText, truncateAtWord } from "./utils.js";
export const FAILURE_BACKOFF_MS = 60 * 1000;
// Stored failures can hold 8 KiB of stderr; agents see the reason on every blocked call.
const AGENT_FAILURE_REASON_CHARS = 300;
export function getFailureAgeSeconds(state, serverName) {
    const failedAt = state.failureTracker.get(serverName);
    if (!failedAt)
        return null;
    const ageMs = Date.now() - failedAt;
    if (ageMs > FAILURE_BACKOFF_MS)
        return null;
    return Math.round(ageMs / 1000);
}
export function getFailureMessage(state, serverName) {
    if (getFailureAgeSeconds(state, serverName) === null)
        return null;
    return state.failureMessages?.get(serverName) ?? null;
}
/** "failed 12s ago: <reason>" for agent-facing text, or null outside the backoff window. */
export function describeFailure(state, serverName) {
    const failedAgo = getFailureAgeSeconds(state, serverName);
    if (failedAgo === null)
        return null;
    const reason = sanitizeTerminalText(state.failureMessages?.get(serverName) ?? "");
    return reason ? `failed ${failedAgo}s ago: ${truncateAtWord(reason, AGENT_FAILURE_REASON_CHARS)}` : `failed ${failedAgo}s ago`;
}
export function isServerInActiveFailureBackoff(state, serverName) {
    const connection = state.manager.getConnection(serverName);
    return connection?.status !== "connected"
        && connection?.status !== "needs-auth"
        && getFailureAgeSeconds(state, serverName) !== null;
}
