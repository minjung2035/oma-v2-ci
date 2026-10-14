import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { getWebSearchConfigPath } from "./utils.js";
const SERPBASE_API_URL = "https://api.serpbase.dev/google/search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
const RECENCY_TBS = {
    day: "qdr:d",
    week: "qdr:w",
    month: "qdr:m",
    year: "qdr:y",
};
let cachedConfig = null;
function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    if (!existsSync(CONFIG_PATH)) {
        cachedConfig = {};
        return cachedConfig;
    }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid config in ${CONFIG_PATH}: expected a JSON object`);
    }
    cachedConfig = parsed;
    return cachedConfig;
}
async function getApiKey(signal) {
    return resolveCredential({
        provider: "SerpBase",
        configuredValue: loadConfig().serpbaseApiKey,
        environmentValue: process.env.SERPBASE_API_KEY,
        signal,
    });
}
async function requireApiKey(signal) {
    const apiKey = await getApiKey(signal);
    if (!apiKey) {
        throw new Error("SerpBase API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "serpbaseApiKey": "your-key" }\n` +
            "  2. Set SERPBASE_API_KEY environment variable\n" +
            "Get a key at https://serpbase.dev");
    }
    return apiKey;
}
function normalizeCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 10;
    return Math.max(1, Math.min(Math.floor(value), 20));
}
function parseDomainFilter(domainFilter) {
    const filters = { include: [], exclude: [] };
    if (!domainFilter?.length)
        return filters;
    for (const raw of domainFilter) {
        const domain = normalizeDomain(raw);
        if (!domain)
            continue;
        const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
        if (!target.includes(domain))
            target.push(domain);
    }
    return filters;
}
function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}
function passesDomainFilters(url, filters) {
    if (filters.include.length === 0 && filters.exclude.length === 0)
        return true;
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    if (filters.exclude.some((domain) => domainMatches(hostname, domain)))
        return false;
    if (filters.include.length === 0)
        return true;
    return filters.include.some((domain) => domainMatches(hostname, domain));
}
function buildQuery(query, filters) {
    const parts = [query];
    if (filters.include.length === 1)
        parts.push(`site:${filters.include[0]}`);
    if (filters.include.length > 1)
        parts.push(`(${filters.include.map(domain => `site:${domain}`).join(" OR ")})`);
    for (const domain of filters.exclude)
        parts.push(`-site:${domain}`);
    return parts.join(" ");
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function invalidResponse(message) {
    return new Error(`SerpBase API returned invalid response: ${message}`);
}
function parseResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw invalidResponse("expected an object envelope");
    const envelope = value;
    if (typeof envelope.error === "string" && envelope.error.trim()) {
        const suffix = typeof envelope.status === "number" || typeof envelope.status === "string" ? ` (status ${envelope.status})` : "";
        throw invalidResponse(`${envelope.error}${suffix}`);
    }
    const organic = envelope.organic_results ?? envelope.organic ?? envelope.results;
    if (!Array.isArray(organic))
        throw invalidResponse("expected organic_results array");
    return { ...envelope, organic_results: organic };
}
export function isSerpBaseAvailable() {
    return hasCredentialSource({ provider: "SerpBase", configuredValue: loadConfig().serpbaseApiKey, environmentValue: process.env.SERPBASE_API_KEY });
}
export async function searchWithSerpBase(query, options = {}) {
    const apiKey = await requireApiKey(options.signal);
    const numResults = normalizeCount(options.numResults);
    const filters = parseDomainFilter(options.domainFilter);
    const url = new URL(SERPBASE_API_URL);
    url.searchParams.set("q", buildQuery(query, filters));
    // SerpBase's Google Search endpoint authenticates with an `api_key` query parameter.
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("num", String(numResults));
    if (options.recencyFilter && RECENCY_TBS[options.recencyFilter])
        url.searchParams.set("tbs", RECENCY_TBS[options.recencyFilter]);
    const activityId = activityMonitor.logStart({ type: "api", query });
    let response;
    try {
        response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: options.signal ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal]) : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        });
    }
    catch (err) {
        const message = errorMessage(err);
        const redactedMessage = redactCredential(message, apiKey);
        if (redactedMessage.toLowerCase().includes("abort"))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, redactedMessage);
        if (redactedMessage === message)
            throw err;
        const redactedError = new Error(redactedMessage);
        if (err instanceof Error)
            redactedError.name = err.name;
        throw redactedError;
    }
    if (!response.ok) {
        activityMonitor.logComplete(activityId, response.status);
        const errorText = redactCredential(await response.text(), apiKey);
        throw new Error(`SerpBase API error ${response.status}: ${errorText.slice(0, 300)}`);
    }
    let rawData;
    try {
        rawData = await response.json();
    }
    catch (err) {
        activityMonitor.logComplete(activityId, response.status);
        throw new Error(`SerpBase API returned invalid JSON: ${errorMessage(err)}`);
    }
    const data = parseResponse(rawData);
    activityMonitor.logComplete(activityId, response.status);
    const results = [];
    for (const item of data.organic_results ?? []) {
        const url = typeof item.link === "string" ? item.link : typeof item.url === "string" ? item.url : "";
        if (!url || !passesDomainFilters(url, filters))
            continue;
        results.push({
            title: typeof item.title === "string" && item.title.trim() ? item.title : `Source ${results.length + 1}`,
            url,
            snippet: typeof item.snippet === "string" ? item.snippet : typeof item.description === "string" ? item.description : "",
        });
        if (results.length >= numResults)
            break;
    }
    return { answer: formatSearchResultsAsAnswer(results), results };
}
