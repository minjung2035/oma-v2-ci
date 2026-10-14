import { getValidToken } from "./mcp-auth-flow.js";
import { inspectAuthForUrl, updateTokens, } from "./mcp-auth.js";
export async function getMcpOAuthTokensForUrl(serverName, serverUrl, options = {}) {
    return (await getValidToken(serverName, serverUrl, options)) ?? undefined;
}
export function inspectMcpOAuthTokensForUrl(serverName, serverUrl, options) {
    const status = inspectAuthForUrl(serverName, serverUrl, options);
    if (status.status !== "present")
        return status;
    return status.entry.tokens
        ? { status: "present", tokens: status.entry.tokens }
        : { status: "absent" };
}
export async function updateMcpOAuthTokensForUrl(serverName, serverUrl, tokens, options) {
    updateTokens(serverName, tokens, serverUrl, options);
}
