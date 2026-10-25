import { getAuthEntry } from "./mcp-auth.js";
/**
 * Get stored OAuth tokens for a server (if any).
 * Returns undefined if no tokens exist or tokens are expired.
 *
 * Persistent credentials are read from the OS secure credential store. Legacy
 * plaintext entries are imported through mcp-auth.ts before this returns.
 */
export function getStoredTokens(serverName) {
    const tokens = getAuthEntry(serverName)?.tokens;
    if (!tokens)
        return undefined;
    if (tokens.expiresAt !== undefined && tokens.expiresAt < Date.now() / 1000) {
        return undefined;
    }
    return {
        access_token: tokens.accessToken,
        token_type: "Bearer",
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresAt !== undefined
            ? Math.max(0, Math.floor(tokens.expiresAt - Date.now() / 1000))
            : undefined,
        scope: tokens.scope,
        ...(tokens.issuer !== undefined ? { issuer: tokens.issuer } : {}),
    };
}
