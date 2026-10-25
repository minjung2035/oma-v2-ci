import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { fetchRemoteUrl, loadSsrfConfig } from "./ssrf-protection.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { getWebSearchConfigPath } from "./utils.js";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 30_000;
let cachedConfig = null;
function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    if (!existsSync(CONFIG_PATH)) {
        cachedConfig = {};
        return cachedConfig;
    }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    try {
        cachedConfig = JSON.parse(raw);
        return cachedConfig;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
}
function normalizeBaseUrl(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return null;
        if (url.username || url.password)
            return null;
        url.pathname = url.pathname.replace(/\/+$/, "");
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    }
    catch {
        return null;
    }
}
function getBaseUrl() {
    const configured = process.env.SEARXNG_BASE_URL;
    return configured !== undefined
        ? normalizeBaseUrl(configured)
        : normalizeBaseUrl(loadConfig().searxngBaseUrl);
}
function isValidHeaderValue(value) {
    try {
        new Headers({ "x-pi-web-access-validation": value });
        return true;
    }
    catch {
        return false;
    }
}
function normalizeHeaders(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const headers = {};
    for (const [key, headerValue] of Object.entries(value)) {
        if (typeof headerValue !== "string")
            continue;
        const name = key.trim();
        // RFC 7230 token chars only — reject empty or malformed header names.
        if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
            continue;
        if (!isValidHeaderValue(headerValue))
            continue;
        headers[name] = headerValue;
    }
    return headers;
}
function getConfiguredHeaders() {
    return normalizeHeaders(loadConfig().searxngHeaders);
}
function mergeDefaultHeaders(configured) {
    const headers = { Accept: "application/json" };
    for (const [name, value] of Object.entries(configured)) {
        for (const existing of Object.keys(headers)) {
            if (existing.toLowerCase() === name.toLowerCase())
                delete headers[existing];
        }
        headers[name] = value;
    }
    return headers;
}
function requireBaseUrl() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
        throw new Error("SearXNG base URL is invalid or missing. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "searxngBaseUrl": "https://search.example.com" }\n` +
            "  2. Set SEARXNG_BASE_URL to an HTTP(S) URL");
    }
    return baseUrl;
}
function normalizeDomainFilters(domainFilter) {
    const filters = { allowed: [], blocked: [] };
    for (const raw of domainFilter ?? []) {
        const domain = normalizeDomain(raw);
        if (!domain)
            continue;
        const target = raw.trim().startsWith("-") ? filters.blocked : filters.allowed;
        if (!target.includes(domain))
            target.push(domain);
    }
    return filters;
}
function buildSearXNGQuery(query, filters) {
    const parts = [query];
    if (filters.allowed.length === 1) {
        parts.push(`site:${filters.allowed[0]}`);
    }
    else if (filters.allowed.length > 1) {
        parts.push(filters.allowed.map(domain => `site:${domain}`).join(" OR "));
    }
    for (const domain of filters.blocked)
        parts.push(`-site:${domain}`);
    return parts.join(" ");
}
function hostMatchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}
function matchesDomainFilters(url, filters) {
    if (filters.allowed.length === 0 && filters.blocked.length === 0)
        return true;
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    if (filters.allowed.length > 0 && !filters.allowed.some(domain => hostMatchesDomain(hostname, domain)))
        return false;
    return !filters.blocked.some(domain => hostMatchesDomain(hostname, domain));
}
function mapTimeRange(recencyFilter) {
    return recencyFilter === "day" || recencyFilter === "week" || recencyFilter === "month" || recencyFilter === "year"
        ? recencyFilter
        : null;
}
export function isSearXNGAvailable() {
    const baseUrl = getBaseUrl();
    if (baseUrl === null)
        return false;
    loadSsrfConfig();
    return true;
}
export async function searchWithSearXNG(query, options = {}) {
    const baseUrl = requireBaseUrl();
    const numResults = normalizeSearchResultCount(options.numResults);
    const filters = normalizeDomainFilters(options.domainFilter);
    const searchQuery = buildSearXNGQuery(query, filters);
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set("q", searchQuery);
    url.searchParams.set("format", "json");
    const timeRange = mapTimeRange(options.recencyFilter);
    if (timeRange)
        url.searchParams.set("time_range", timeRange);
    const activityId = activityMonitor.logStart({ type: "api", query: searchQuery });
    try {
        const headers = mergeDefaultHeaders(getConfiguredHeaders());
        const response = await fetchRemoteUrl(url, {
            method: "GET",
            headers,
            signal: options.signal
                ? AbortSignal.any([AbortSignal.timeout(SEARCH_TIMEOUT_MS), options.signal])
                : AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        }, {
            ...loadSsrfConfig(),
            onRedirect: ({ from, to, init }) => from.origin === to.origin ? init : { ...init, headers: { Accept: "application/json" } },
        });
        if (!response.ok) {
            activityMonitor.logError(activityId, `HTTP ${response.status}`);
            const errorText = await response.text();
            throw new Error(`SearXNG search error ${response.status}: ${errorText.slice(0, 300)}`);
        }
        let data;
        try {
            data = await response.json();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`SearXNG returned invalid JSON: ${message}`);
        }
        activityMonitor.logComplete(activityId, response.status);
        const results = [];
        for (const item of data.results ?? []) {
            if (!item.url || !matchesDomainFilters(item.url, filters))
                continue;
            results.push({ title: item.title || item.url, url: item.url, snippet: item.content || "" });
            if (results.length >= numResults)
                break;
        }
        const answerParts = (data.answers ?? []).filter((answer) => typeof answer === "string" && answer.trim().length > 0).map(answer => answer.trim());
        answerParts.push(...results.map(result => result.snippet
            ? `${result.snippet}\nSource: ${result.title} (${result.url})`
            : `Source: ${result.title} (${result.url})`));
        return { answer: answerParts.join("\n\n"), results };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("abort"))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, message);
        throw err;
    }
}
