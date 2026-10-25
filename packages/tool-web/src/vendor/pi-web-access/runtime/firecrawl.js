import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { redactCredential, resolveCredential } from "./credential-source.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { loadSsrfConfig, validateRemoteUrl } from "./ssrf-protection.js";
import { getWebSearchConfigPath, isLoopbackHostname } from "./utils.js";
const CONFIG_PATH = getWebSearchConfigPath();
const DEFAULT_API_VERSION = "v2";
const EXTRACT_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const SUPPORTED_API_VERSIONS = ["v1", "v2"];
let cachedConfig = null;
function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    if (!existsSync(CONFIG_PATH)) {
        cachedConfig = {};
        return cachedConfig;
    }
    const raw = readFileSync(CONFIG_PATH, "utf8");
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
export function clearFirecrawlConfigCache() {
    cachedConfig = null;
}
function normalizeBaseUrl(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    let parsed;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        throw new Error(`Invalid Firecrawl base URL in ${CONFIG_PATH}: expected an HTTP or HTTPS URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Invalid Firecrawl base URL in ${CONFIG_PATH}: expected an HTTP or HTTPS URL`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Invalid Firecrawl base URL in ${CONFIG_PATH}: URL credentials are not allowed`);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
}
function getBaseUrl() {
    return normalizeBaseUrl(process.env.FIRECRAWL_BASE_URL) ?? normalizeBaseUrl(loadConfig().firecrawlBaseUrl);
}
function requireBaseUrl() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
        throw new Error("Firecrawl base URL not configured. Either:\n" +
            `  1. Set firecrawlBaseUrl in ${CONFIG_PATH}\n` +
            "  2. Set FIRECRAWL_BASE_URL environment variable");
    }
    return baseUrl;
}
function getApiVersion() {
    const environmentValue = typeof process.env.FIRECRAWL_API_VERSION === "string"
        ? process.env.FIRECRAWL_API_VERSION.trim()
        : "";
    const raw = environmentValue || loadConfig().firecrawlApiVersion;
    if (raw === undefined || raw === null)
        return DEFAULT_API_VERSION;
    if (typeof raw !== "string") {
        throw new Error(`firecrawlApiVersion in ${CONFIG_PATH} must be a string ("v1" or "v2")`);
    }
    const normalized = raw.trim().toLowerCase();
    if (!normalized)
        return DEFAULT_API_VERSION;
    if (!SUPPORTED_API_VERSIONS.includes(normalized)) {
        throw new Error(`Unsupported Firecrawl API version "${raw}". Supported versions: ${SUPPORTED_API_VERSIONS.join(", ")}`);
    }
    return normalized;
}
function allowFreshScrape() {
    const environmentValue = process.env.FIRECRAWL_FRESH_SCRAPE;
    if (environmentValue !== undefined)
        return environmentValue === "1" || environmentValue.toLowerCase() === "true";
    const configured = loadConfig().firecrawlFreshScrape;
    if (configured === undefined || configured === null)
        return false;
    if (typeof configured !== "boolean")
        throw new Error(`firecrawlFreshScrape in ${CONFIG_PATH} must be a boolean`);
    return configured;
}
async function getApiKey(signal) {
    const configKey = loadConfig().firecrawlApiKey;
    return resolveCredential({
        provider: "Firecrawl",
        configuredValue: configKey,
        environmentValue: process.env.FIRECRAWL_API_KEY,
        signal,
    });
}
function requestSignal(timeoutMs, signal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([timeout, signal]) : timeout;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function isAbortError(err) {
    return errorMessage(err).toLowerCase().includes("abort");
}
function ssrfOptions(options) {
    const config = loadSsrfConfig();
    return {
        allowRanges: options?.ssrf?.allowRanges ?? config.allowRanges,
        trustEnvProxy: options?.ssrf?.trustEnvProxy ?? config.trustEnvProxy,
        ...(options?.lookup ? { lookup: options.lookup } : {}),
    };
}
function firecrawlApiSsrfOptions(options, allowLoopback) {
    return { ...ssrfOptions(options), allowLoopback };
}
function withoutSensitiveHeaders(headers) {
    const next = { ...headers };
    delete next.Authorization;
    delete next.authorization;
    delete next.Cookie;
    delete next.cookie;
    delete next["X-API-Key"];
    delete next["x-api-key"];
    return next;
}
async function fetchFirecrawlApi(url, init, options) {
    const allowLoopback = isLoopbackHostname(new URL(url).hostname);
    let current = await validateRemoteUrl(url, firecrawlApiSsrfOptions(options, allowLoopback));
    let headers = init.headers;
    for (let redirects = 0; redirects <= DEFAULT_MAX_REDIRECTS; redirects++) {
        const response = await fetch(current, { ...init, headers, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status))
            return response;
        const location = response.headers.get("location");
        if (!location)
            return response;
        if (redirects === DEFAULT_MAX_REDIRECTS)
            throw new Error(`Too many redirects fetching ${current.toString()}`);
        const next = await validateRemoteUrl(new URL(location, current), firecrawlApiSsrfOptions(options, allowLoopback));
        if (next.origin !== current.origin)
            headers = withoutSensitiveHeaders(headers);
        current = next;
    }
    throw new Error(`Too many redirects fetching ${current.toString()}`);
}
function scrapeBody(url) {
    return {
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        ...(allowFreshScrape() ? {} : { lockdown: true }),
    };
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
function mapRecencyFilter(value) {
    switch (value) {
        case "day": return "qdr:d";
        case "week": return "qdr:w";
        case "month": return "qdr:m";
        case "year": return "qdr:y";
        default: return undefined;
    }
}
function searchBody(query, options, numResults, filters) {
    return {
        query,
        limit: numResults,
        sources: ["web"],
        ...(filters.include.length > 0 ? { includeDomains: filters.include } : {}),
        ...(filters.include.length === 0 && filters.exclude.length > 0 ? { excludeDomains: filters.exclude } : {}),
        ...(mapRecencyFilter(options.recencyFilter) ? { tbs: mapRecencyFilter(options.recencyFilter) } : {}),
        ...(options.includeContent ? {
            scrapeOptions: {
                formats: ["markdown"],
                onlyMainContent: true,
                ...(allowFreshScrape() ? {} : { lockdown: true }),
            },
        } : {}),
    };
}
function firstString(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return null;
}
function mapSearchResults(data, numResults, filters) {
    const web = Array.isArray(data)
        ? data
        : data && typeof data === "object" ? data.web : undefined;
    if (!Array.isArray(web))
        throw new Error("Firecrawl search returned an unexpected web result shape");
    const results = [];
    const inlineContent = [];
    const seen = new Set();
    for (const rawItem of web) {
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem))
            continue;
        const item = rawItem;
        const url = firstString(item.url, item.metadata?.sourceURL, item.metadata?.url);
        if (!url || seen.has(url) || !passesDomainFilters(url, filters))
            continue;
        seen.add(url);
        const title = firstString(item.title, item.metadata?.title) ?? url;
        const snippet = firstString(item.description, item.snippet, item.metadata?.description) ?? "";
        results.push({ title, url, snippet });
        const markdown = firstString(item.markdown);
        if (markdown)
            inlineContent.push({ url, title, content: markdown, error: null });
        if (results.length >= numResults)
            break;
    }
    return { results, inlineContent };
}
async function firecrawlFetch(endpoint, body, signal, options, label = endpoint, activity = undefined) {
    const baseUrl = requireBaseUrl();
    const version = getApiVersion();
    const apiKey = await getApiKey(signal);
    const headers = { "Content-Type": "application/json" };
    if (apiKey)
        headers.Authorization = `Bearer ${apiKey}`;
    const requestUrl = `${baseUrl}/${version}/${endpoint}`;
    const activityId = activityMonitor.logStart(activity ?? { type: "fetch", url: requestUrl });
    try {
        const response = await fetchFirecrawlApi(requestUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: requestSignal(options?.timeoutMs ?? EXTRACT_TIMEOUT_MS, signal),
        }, options);
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Firecrawl ${label} error ${response.status}: ${redactCredential(text.slice(0, 300), apiKey)}`);
        }
        let data;
        try {
            data = await response.json();
        }
        catch (err) {
            throw new Error(`Firecrawl ${label} returned invalid JSON: ${errorMessage(err)}`);
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error(`Firecrawl ${label} returned an unexpected response shape`);
        }
        const envelope = data;
        if (envelope.success === false) {
            const reason = typeof envelope.error === "string" && envelope.error.trim() ? envelope.error : "unknown error";
            throw new Error(`Firecrawl ${label} unsuccessful: ${redactCredential(reason, apiKey)}`);
        }
        if (envelope.success !== true) {
            throw new Error(`Firecrawl ${label} returned an unexpected response shape`);
        }
        activityMonitor.logComplete(activityId, response.status);
        return envelope;
    }
    catch (err) {
        if (isAbortError(err))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, errorMessage(err));
        throw err;
    }
}
export function isFirecrawlAvailable() {
    return getBaseUrl() !== null;
}
export async function searchWithFirecrawl(query, options = {}) {
    requireBaseUrl();
    const numResults = normalizeSearchResultCount(options.numResults);
    const filters = parseDomainFilter(options.domainFilter);
    const envelope = await firecrawlFetch("search", searchBody(query, options, numResults, filters), options.signal, { ...options, timeoutMs: options.timeoutMs ?? SEARCH_TIMEOUT_MS }, "search", { type: "api", query });
    const mapped = mapSearchResults(envelope.data, numResults, filters);
    const response = { answer: formatSearchResultsAsAnswer(mapped.results), results: mapped.results };
    if (options.includeContent && mapped.inlineContent.length > 0)
        response.inlineContent = mapped.inlineContent;
    return response;
}
export async function extractWithFirecrawl(url, signal, options) {
    requireBaseUrl();
    await validateRemoteUrl(url, ssrfOptions(options));
    const envelope = await firecrawlFetch("scrape", scrapeBody(url), signal, options);
    const data = envelope.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Firecrawl scrape returned an unexpected data shape");
    }
    const scrape = data;
    if (typeof scrape.markdown !== "string") {
        throw new Error("Firecrawl scrape returned markdown in an unexpected shape");
    }
    const content = scrape.markdown.trim();
    if (!content)
        return null;
    const metadataTitle = scrape.metadata?.title;
    const title = typeof metadataTitle === "string" && metadataTitle.trim()
        ? metadataTitle.trim()
        : typeof scrape.title === "string" ? scrape.title.trim() : "";
    return { url, title, content, error: null };
}
