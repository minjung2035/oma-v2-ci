import { activityMonitor } from "./activity.js";
import { redactCredential } from "./credential-source.js";
import { resolveParallelApiKey } from "./parallel.js";
import { getWebSearchConfigPath } from "./utils.js";
const PARALLEL_MCP_URL = "https://search.parallel.ai/mcp";
const CONFIG_PATH = getWebSearchConfigPath();
const REQUEST_TIMEOUT_MS = 60_000;
function requestSignal(signal) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function normalizeDomain(value) {
    let input = value.trim().toLowerCase();
    if (input.startsWith("-"))
        input = input.slice(1).trim();
    if (!input)
        return null;
    try {
        input = (input.includes("://") ? new URL(input) : new URL(`https://${input}`)).hostname;
    }
    catch {
        input = input.split("/")[0]?.split(":")[0] ?? "";
    }
    input = input.replace(/^\.+|\.+$/g, "");
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}
function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}
function filterResults(results, domainFilter) {
    if (!domainFilter?.length)
        return results;
    const included = domainFilter.filter(value => !value.trim().startsWith("-")).map(normalizeDomain).filter((value) => value !== null);
    const excluded = domainFilter.filter(value => value.trim().startsWith("-")).map(normalizeDomain).filter((value) => value !== null);
    return results.filter(result => {
        let hostname;
        try {
            hostname = new URL(result.url).hostname.toLowerCase();
        }
        catch {
            return false;
        }
        return (included.length === 0 || included.some(domain => domainMatches(hostname, domain))) &&
            !excluded.some(domain => domainMatches(hostname, domain));
    });
}
function buildSearchQuery(query, options) {
    const parts = [query];
    for (const raw of options.domainFilter ?? []) {
        const domain = normalizeDomain(raw);
        if (domain)
            parts.push(raw.trim().startsWith("-") ? `-site:${domain}` : `site:${domain}`);
    }
    if (options.recencyFilter) {
        const labels = { day: "past 24 hours", week: "past week", month: "past month", year: "past year" };
        parts.push(labels[options.recencyFilter]);
    }
    return parts.join(" ");
}
async function callParallelMcp(toolName, args, signal) {
    const apiKey = await resolveParallelApiKey(signal);
    const headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    };
    if (apiKey)
        headers.Authorization = `Bearer ${apiKey}`;
    let response;
    try {
        response = await fetch(PARALLEL_MCP_URL, {
            method: "POST",
            headers,
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: args } }),
            signal: requestSignal(signal),
        });
    }
    catch (err) {
        const message = apiKey ? redactCredential(errorMessage(err), apiKey) : errorMessage(err);
        if (message === errorMessage(err))
            throw err;
        throw new Error(message);
    }
    const body = await response.text();
    const safeBody = apiKey ? redactCredential(body, apiKey) : body;
    if (!response.ok) {
        if (response.status === 429) {
            throw new Error(`Parallel MCP rate limit reached (429). Add parallelApiKey to ${CONFIG_PATH} or set PARALLEL_API_KEY for higher limits: ${safeBody.slice(0, 200)}`);
        }
        throw new Error(`Parallel MCP error ${response.status}: ${safeBody.slice(0, 300)}`);
    }
    let parsed = null;
    for (const candidateText of [...body.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()), body]) {
        if (!candidateText)
            continue;
        try {
            const candidate = JSON.parse(candidateText);
            if (candidate.result || candidate.error) {
                parsed = candidate;
                break;
            }
        }
        catch {
        }
    }
    if (!parsed)
        throw new Error("Parallel MCP returned invalid JSON-RPC content");
    if (parsed.error) {
        const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
        const message = apiKey ? redactCredential(parsed.error.message || "Unknown error", apiKey) : parsed.error.message || "Unknown error";
        throw new Error(`Parallel MCP error${code}: ${message}`);
    }
    if (parsed.result?.isError) {
        const text = parsed.result.content?.find(item => item.type === "text" && typeof item.text === "string")?.text?.trim() || "Parallel MCP returned an error";
        throw new Error(apiKey ? redactCredential(text, apiKey) : text);
    }
    if (parsed.result?.structuredContent && typeof parsed.result.structuredContent === "object")
        return parsed.result.structuredContent;
    const text = parsed.result?.content?.find(item => item.type === "text" && typeof item.text === "string" && item.text.trim())?.text;
    if (!text)
        throw new Error("Parallel MCP returned empty content");
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function parseTextResults(text) {
    return text.split(/(?=^Title: )/m).flatMap(block => {
        const url = block.match(/^URL: (.+)/m)?.[1]?.trim();
        if (!url)
            return [];
        const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
        const textStart = block.indexOf("\nText: ");
        const excerpt = textStart >= 0 ? block.slice(textStart + 7).replace(/\n---\s*$/, "").trim() : "";
        return [{ url, title, excerpts: excerpt ? [excerpt] : [] }];
    });
}
function getResults(payload) {
    if (typeof payload === "string")
        return parseTextResults(payload);
    if (!payload || typeof payload !== "object")
        return [];
    const results = payload.results;
    if (!Array.isArray(results))
        return [];
    return results.filter((item) => !!item && typeof item === "object" && typeof item.url === "string");
}
function excerpts(result) {
    return Array.isArray(result.excerpts) ? result.excerpts.filter(item => typeof item === "string" && item.trim()) : [];
}
export function isParallelMcpAvailable() {
    return true;
}
export async function searchWithParallelMcp(query, options = {}) {
    const activityId = activityMonitor.logStart({ type: "api", query });
    try {
        const searchQuery = buildSearchQuery(query, options);
        const payload = await callParallelMcp("web_search", { objective: query, search_queries: [searchQuery] }, options.signal);
        const maxResults = Math.max(1, Math.min(Math.floor(options.numResults ?? 5), 20));
        const results = filterResults(getResults(payload), options.domainFilter).slice(0, maxResults);
        activityMonitor.logComplete(activityId, 200);
        const response = {
            answer: results.flatMap((result, index) => {
                const content = excerpts(result).join(" ").trim();
                return content ? [`${content}\nSource: ${result.title || `Source ${index + 1}`} (${result.url})`] : [];
            }).join("\n\n"),
            results: results.map((result, index) => ({
                title: result.title || `Source ${index + 1}`,
                url: result.url,
                snippet: excerpts(result)[0]?.replace(/\s+/g, " ").trim().slice(0, 200) ?? "",
            })),
        };
        if (options.includeContent) {
            const inlineContent = results.flatMap(result => {
                const content = excerpts(result).join("\n\n");
                return content ? [{ url: result.url, title: result.title || "", content, error: null }] : [];
            });
            if (inlineContent.length)
                response.inlineContent = inlineContent;
        }
        return response;
    }
    catch (err) {
        const message = errorMessage(err);
        if (message.toLowerCase().includes("abort"))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, message);
        throw err;
    }
}
export async function extractWithParallelMcp(url, signal, options = {}) {
    const activityId = activityMonitor.logStart({ type: "fetch", url });
    try {
        const objective = options.prompt?.trim();
        const payload = await callParallelMcp("web_fetch", {
            urls: [url],
            ...(objective ? { objective: objective.slice(0, 200) } : {}),
            full_content: true,
        }, signal);
        const result = getResults(payload).find(item => item.url === url) ?? getResults(payload)[0];
        if (!result) {
            activityMonitor.logComplete(activityId, 200);
            return null;
        }
        const fullContent = typeof result.full_content === "string" ? result.full_content.trim() : "";
        const content = fullContent || excerpts(result).join("\n\n");
        activityMonitor.logComplete(activityId, 200);
        return content ? { url: result.url, title: result.title || "", content, error: null } : null;
    }
    catch (err) {
        const message = errorMessage(err);
        if (message.toLowerCase().includes("abort"))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, message);
        throw err;
    }
}
