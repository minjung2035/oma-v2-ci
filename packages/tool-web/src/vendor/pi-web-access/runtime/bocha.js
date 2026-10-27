import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { getWebSearchConfigPath } from "./utils.js";
const BOCHA_SEARCH_URL = "https://api.bochaai.com/v1/web-search";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 60_000;
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
        provider: "Bocha",
        configuredValue: loadConfig().bochaApiKey,
        environmentValue: process.env.BOCHA_API_KEY,
        signal,
    });
}
async function requireApiKey(signal) {
    const apiKey = await getApiKey(signal);
    if (!apiKey) {
        throw new Error("Bocha API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "bochaApiKey": "your-key" }\n` +
            "  2. Set BOCHA_API_KEY environment variable\n" +
            "Create a key at https://open.bochaai.com/");
    }
    return apiKey;
}
function normalizeCount(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return 8;
    return Math.max(1, Math.min(Math.floor(value), 20));
}
function mapFreshness(value) {
    switch (value) {
        case "day": return "oneDay";
        case "week": return "oneWeek";
        case "month": return "oneMonth";
        case "year": return "oneYear";
        default: return "noLimit";
    }
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
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function invalidResponse(message) {
    return new Error(`Bocha API returned invalid response: ${message}`);
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return null;
}
function parseSearchResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw invalidResponse("expected an object envelope");
    const envelope = value;
    if (envelope.code !== undefined && Number(envelope.code) !== 200) {
        throw invalidResponse(`code ${String(envelope.code)}: ${firstString(envelope.msg) ?? "unknown error"}`);
    }
    const data = envelope.data;
    const pages = (typeof data === "object" && data !== null && !Array.isArray(data))
        ? data.webPages
        : undefined;
    const items = (typeof pages === "object" && pages !== null && !Array.isArray(pages))
        ? pages.value
        : undefined;
    if (!Array.isArray(items))
        throw invalidResponse("missing data.webPages.value array");
    const results = [];
    for (const item of items) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
        const entry = item;
        const url = firstString(entry.url, entry.link, entry.href);
        if (!url)
            continue;
        const title = firstString(entry.title, entry.name) ?? url;
        const snippet = firstString(entry.summary, entry.snippet, entry.description, entry.content) ?? "";
        results.push({ title, url, snippet });
    }
    return { results };
}
export function isBochaAvailable() {
    return hasCredentialSource({ provider: "Bocha", configuredValue: loadConfig().bochaApiKey, environmentValue: process.env.BOCHA_API_KEY });
}
export async function searchWithBocha(query, options = {}) {
    const apiKey = await requireApiKey(options.signal);
    const numResults = normalizeCount(options.numResults);
    const filters = parseDomainFilter(options.domainFilter);
    const activityId = activityMonitor.logStart({ type: "api", query });
    let response;
    try {
        response = await fetch(BOCHA_SEARCH_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ query, count: numResults, freshness: mapFreshness(options.recencyFilter), summary: true }),
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
        throw new Error(`Bocha API error ${response.status}: ${errorText.slice(0, 300)}`);
    }
    let rawData;
    try {
        rawData = await response.json();
    }
    catch (err) {
        activityMonitor.logComplete(activityId, response.status);
        throw new Error(`Bocha API returned invalid JSON: ${errorMessage(err)}`);
    }
    let parsed;
    try {
        parsed = parseSearchResponse(rawData);
    }
    catch (err) {
        const message = errorMessage(err);
        const redactedMessage = redactCredential(message, apiKey);
        activityMonitor.logError(activityId, redactedMessage);
        if (redactedMessage === message)
            throw err;
        const redactedError = new Error(redactedMessage);
        if (err instanceof Error)
            redactedError.name = err.name;
        throw redactedError;
    }
    activityMonitor.logComplete(activityId, response.status);
    const results = parsed.results.filter((result) => passesDomainFilters(result.url, filters)).slice(0, numResults);
    return { answer: formatSearchResultsAsAnswer(results), results };
}
