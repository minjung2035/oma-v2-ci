import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { getWebSearchConfigPath } from "./utils.js";
const SERPER_SEARCH_URL = "https://google.serper.dev/search";
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
        provider: "Serper",
        configuredValue: loadConfig().serperApiKey,
        environmentValue: process.env.SERPER_API_KEY,
        signal,
    });
}
async function requireApiKey(signal) {
    const apiKey = await getApiKey(signal);
    if (!apiKey) {
        throw new Error("Serper API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "serperApiKey": "your-key" }\n` +
            "  2. Set SERPER_API_KEY environment variable\n" +
            "Get a key at https://serper.dev");
    }
    return apiKey;
}
function parseDomainFilter(domainFilter) {
    const filters = { include: [], exclude: [] };
    for (const raw of domainFilter ?? []) {
        const domain = normalizeDomain(raw);
        if (!domain)
            continue;
        const target = raw.trim().startsWith("-") ? filters.exclude : filters.include;
        if (!target.includes(domain))
            target.push(domain);
    }
    return filters;
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
    const matches = (domain) => hostname === domain || hostname.endsWith(`.${domain}`);
    if (filters.exclude.some(matches))
        return false;
    return filters.include.length === 0 || filters.include.some(matches);
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
    return new Error(`Serper API returned invalid response: ${message}`);
}
function parseResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw invalidResponse("expected an object envelope");
    const envelope = value;
    if (!Array.isArray(envelope.organic))
        throw invalidResponse("expected organic array");
    return envelope.organic;
}
export function isSerperAvailable() {
    return hasCredentialSource({ provider: "Serper", configuredValue: loadConfig().serperApiKey, environmentValue: process.env.SERPER_API_KEY });
}
export async function searchWithSerper(query, options = {}) {
    const apiKey = await requireApiKey(options.signal);
    const numResults = normalizeSearchResultCount(options.numResults);
    const filters = parseDomainFilter(options.domainFilter);
    const requestCount = options.domainFilter?.length ? Math.min(20, numResults + 5) : numResults;
    const activityId = activityMonitor.logStart({ type: "api", query });
    let response;
    try {
        response = await fetch(SERPER_SEARCH_URL, {
            method: "POST",
            headers: { "X-API-KEY": apiKey, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ q: buildQuery(query, filters), num: requestCount, ...(options.recencyFilter ? { tbs: RECENCY_TBS[options.recencyFilter] } : {}) }),
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
        throw new Error(`Serper API error ${response.status}: ${errorText.slice(0, 300)}`);
    }
    let rawData;
    try {
        rawData = await response.json();
    }
    catch (err) {
        activityMonitor.logComplete(activityId, response.status);
        throw new Error(`Serper API returned invalid JSON: ${errorMessage(err)}`);
    }
    let entries;
    try {
        entries = parseResponse(rawData);
    }
    catch (err) {
        activityMonitor.logComplete(activityId, response.status);
        throw err;
    }
    activityMonitor.logComplete(activityId, response.status);
    const results = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object")
            continue;
        if (typeof entry.link !== "string" || !entry.link)
            continue;
        if (!passesDomainFilters(entry.link, filters))
            continue;
        results.push({
            title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : `Source ${results.length + 1}`,
            url: entry.link,
            snippet: typeof entry.snippet === "string" ? entry.snippet : "",
        });
        if (results.length >= numResults)
            break;
    }
    return { answer: formatSearchResultsAsAnswer(results), results };
}
