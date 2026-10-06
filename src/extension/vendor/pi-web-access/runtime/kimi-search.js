import { randomUUID } from "node:crypto";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { redactCredential } from "./credential-source.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
const KIMI_SEARCH_URL = "https://api.kimi.com/coding/v1/search";
const KIMI_PROVIDERS = ["kimi-coding", "kimi-code"];
const SEARCH_TIMEOUT_MS = 30_000;
function buildRequestHeaders(auth) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(auth.headers)) {
        if (value !== null)
            headers.set(name, value);
    }
    headers.set("Authorization", `Bearer ${auth.apiKey}`);
    headers.set("Content-Type", "application/json");
    headers.set("X-Msh-Tool-Call-Id", randomUUID());
    return headers;
}
function bearerToken(headers) {
    for (const [name, value] of Object.entries(headers)) {
        if (name.toLowerCase() !== "authorization" || typeof value !== "string")
            continue;
        const match = /^Bearer\s+(.+)$/i.exec(value.trim());
        if (match?.[1])
            return match[1];
    }
    return undefined;
}
async function resolveKimiAuth(ctx) {
    if (!ctx)
        return undefined;
    const models = ctx.modelRegistry.getAll();
    let firstError;
    for (const provider of KIMI_PROVIDERS) {
        for (const model of models) {
            if (model.provider !== provider)
                continue;
            let resolved;
            try {
                resolved = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            }
            catch (err) {
                firstError ??= err;
                continue;
            }
            if (!resolved.ok)
                continue;
            const headers = resolved.headers ?? {};
            const apiKey = resolved.apiKey || bearerToken(headers);
            if (apiKey)
                return { apiKey, headers };
        }
    }
    if (firstError)
        throw firstError;
    return undefined;
}
function normalizeDomainFilters(domainFilter) {
    const filters = { allowed: [], blocked: [] };
    if (!domainFilter?.length)
        return filters;
    for (const raw of domainFilter) {
        const domain = normalizeDomain(raw);
        if (!domain)
            continue;
        const target = raw.trim().startsWith("-") ? filters.blocked : filters.allowed;
        if (!target.includes(domain))
            target.push(domain);
    }
    return filters;
}
function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}
function matchesDomainFilters(url, filters) {
    if (filters.allowed.length === 0 && filters.blocked.length === 0)
        return true;
    let hostname = "";
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    if (filters.allowed.length > 0 && !filters.allowed.some((domain) => hostMatchesDomain(hostname, domain))) {
        return false;
    }
    return !filters.blocked.some((domain) => hostMatchesDomain(hostname, domain));
}
function normalizeResultUrl(value) {
    if (typeof value !== "string")
        return null;
    const input = value.trim();
    if (!input)
        return null;
    try {
        const url = new URL(input);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return null;
        return url.href;
    }
    catch {
        return null;
    }
}
function parseResults(value, options) {
    if (!value || typeof value !== "object" || !Array.isArray(value.search_results)) {
        throw new Error("Kimi Code search API returned an invalid response: search_results must be an array");
    }
    const filters = normalizeDomainFilters(options.domainFilter);
    const numResults = normalizeSearchResultCount(options.numResults);
    const results = [];
    for (const item of value.search_results) {
        if (!item || typeof item !== "object")
            continue;
        const record = item;
        const url = normalizeResultUrl(record.url);
        if (!url || !matchesDomainFilters(url, filters))
            continue;
        results.push({
            title: typeof record.title === "string" && record.title.trim() ? record.title : url,
            url,
            snippet: typeof record.snippet === "string" ? record.snippet : "",
        });
        if (results.length >= numResults)
            break;
    }
    return results;
}
export async function isKimiSearchAvailable(ctx) {
    try {
        return !!(await resolveKimiAuth(ctx));
    }
    catch {
        return false;
    }
}
export async function searchWithKimi(query, options = {}, ctx) {
    const auth = await resolveKimiAuth(ctx);
    if (!auth) {
        throw new Error("Kimi Code web search unavailable. Run /login kimi-coding to authenticate a Kimi Code Plan account.");
    }
    const activityId = activityMonitor.logStart({ type: "api", query });
    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const requestSignal = options.signal
        ? AbortSignal.any([timeoutSignal, options.signal])
        : timeoutSignal;
    try {
        const response = await fetch(KIMI_SEARCH_URL, {
            method: "POST",
            headers: buildRequestHeaders(auth),
            body: JSON.stringify({ text_query: query }),
            signal: requestSignal,
        });
        if (!response.ok) {
            activityMonitor.logError(activityId, `HTTP ${response.status}`);
            const errorText = redactCredential(await response.text(), auth.apiKey);
            throw new Error(`Kimi Code search API error ${response.status}: ${errorText.slice(0, 300)}`);
        }
        let parsed;
        try {
            parsed = await response.json();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Kimi Code search API returned invalid JSON: ${message}`);
        }
        const results = parseResults(parsed, options);
        if (results.length === 0) {
            throw new Error("Kimi Code search API returned no results");
        }
        activityMonitor.logComplete(activityId, response.status);
        return { answer: formatSearchResultsAsAnswer(results), results };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const redactedMessage = redactCredential(message, auth.apiKey);
        if (options.signal?.aborted) {
            activityMonitor.logComplete(activityId, 0);
        }
        else if (timeoutSignal.aborted || (err instanceof Error && err.name === "TimeoutError")) {
            activityMonitor.logError(activityId, "Kimi Code search API timed out");
            throw new Error("Kimi Code search API timed out");
        }
        else if (redactedMessage.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
        }
        else {
            activityMonitor.logError(activityId, redactedMessage);
        }
        if (redactedMessage === message)
            throw err;
        const redactedError = new Error(redactedMessage);
        if (err instanceof Error)
            redactedError.name = err.name;
        throw redactedError;
    }
}
