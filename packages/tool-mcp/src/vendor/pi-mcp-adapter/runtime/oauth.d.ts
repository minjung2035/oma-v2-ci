import { type AuthStorageOptions, type StoredTokens } from "./mcp-auth.js";
import type { ServerEntry } from "./types.js";
export type McpOAuthTokens = StoredTokens;
export type McpOAuthStorageOptions = AuthStorageOptions;
export interface McpOAuthTokenOptions {
    authStorageOptions?: McpOAuthStorageOptions;
    signal?: AbortSignal;
    skipIssuerMetadataValidation?: boolean;
    /** Explicit refresh configuration; never loaded from ambient config or stored with tokens. */
    definition?: Pick<ServerEntry, "headers" | "oauth">;
}
export type McpOAuthTokenStatus = {
    status: "present";
    tokens: McpOAuthTokens;
} | {
    status: "absent";
} | {
    status: "unavailable";
    message: string;
};
export declare function getMcpOAuthTokensForUrl(serverName: string, serverUrl: string, options?: McpOAuthTokenOptions): Promise<McpOAuthTokens | undefined>;
export declare function inspectMcpOAuthTokensForUrl(serverName: string, serverUrl: string, options?: McpOAuthStorageOptions): McpOAuthTokenStatus;
export declare function updateMcpOAuthTokensForUrl(serverName: string, serverUrl: string, tokens: McpOAuthTokens, options?: McpOAuthStorageOptions): Promise<void>;
