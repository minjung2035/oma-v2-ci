import type { OAuthTokens } from "@modelcontextprotocol/client";
/**
 * Get stored OAuth tokens for a server (if any).
 * Returns undefined if no tokens exist or tokens are expired.
 *
 * Persistent credentials are read from the OS secure credential store. Legacy
 * plaintext entries are imported through mcp-auth.ts before this returns.
 */
export declare function getStoredTokens(serverName: string): OAuthTokens | undefined;
