const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function isLoopbackHostname(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
function deriveServerName(url) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const firstLabel = isLoopbackHostname(url.hostname) ? "local-mcp" : hostname.split(".")[0];
    const normalized = (firstLabel || "mcp")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
    return normalized || "mcp";
}
export function normalizeMcpInstallRequest(request) {
    if (typeof request.url !== "string" || request.url.trim() === "") {
        throw new Error("MCP install requires a non-empty URL");
    }
    let parsed;
    try {
        parsed = new URL(request.url.trim());
    }
    catch (error) {
        throw new Error("MCP install URL must be an absolute URL", { cause: error });
    }
    if (parsed.username || parsed.password)
        throw new Error("MCP install URL must not contain credentials");
    if (parsed.hash)
        throw new Error("MCP install URL must not contain a fragment");
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname))) {
        throw new Error("MCP install URL must use HTTPS, except for loopback HTTP servers");
    }
    const serverName = request.serverName?.trim() || deriveServerName(parsed);
    if (!SERVER_NAME_PATTERN.test(serverName)) {
        throw new Error("MCP server name must be 1-64 letters, numbers, underscores, or hyphens and start with a letter or number");
    }
    return { url: parsed.toString(), serverName };
}
export function canonicalMcpServerUrl(value) {
    try {
        return new URL(value).toString();
    }
    catch {
        return undefined;
    }
}
