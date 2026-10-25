import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { BraveRateLimitCoordinator } from "./brave-rate-limit.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { fetchWithCredentialRedirects, getWebSearchConfigPath, resolveApiBaseUrl } from "./utils.js";
const BRAVE_API_BASE_URL = "https://api.search.brave.com/res/v1";
const CONFIG_PATH = getWebSearchConfigPath();
const SEARCH_TIMEOUT_MS = 30_000;
const braveRateLimit = new BraveRateLimitCoordinator();
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
async function getApiKey(signal) {
    return resolveCredential({
        provider: "Brave",
        configuredValue: loadConfig().braveApiKey,
        environmentValue: process.env.BRAVE_API_KEY,
        signal,
    });
}
function getApiUrl() {
    return `${resolveApiBaseUrl({
        configKey: "braveBaseUrl",
        configuredValue: loadConfig().braveBaseUrl,
        defaultValue: BRAVE_API_BASE_URL,
        environmentKey: "BRAVE_BASE_URL",
        environmentValue: process.env.BRAVE_BASE_URL,
    })}/web/search`;
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
function buildBraveQuery(query, domainFilter) {
    const filters = normalizeDomainFilters(domainFilter);
    const parts = [query];
    if (filters.allowed.length === 1) {
        parts.push(`site:${filters.allowed[0]}`);
    }
    else if (filters.allowed.length > 1) {
        parts.push(filters.allowed.map(domain => `site:${domain}`).join(" OR "));
    }
    for (const domain of filters.blocked) {
        parts.push(`NOT site:${domain}`);
    }
    return parts.join(" ");
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
    if (filters.allowed.length > 0 && !filters.allowed.some(domain => hostMatchesDomain(hostname, domain))) {
        return false;
    }
    return !filters.blocked.some(domain => hostMatchesDomain(hostname, domain));
}
export function isBraveAvailable() {
    return hasCredentialSource({
        provider: "Brave",
        configuredValue: loadConfig().braveApiKey,
        environmentValue: process.env.BRAVE_API_KEY,
    });
}
export async function searchWithBrave(query, options = {}) {
    const apiUrl = getApiUrl();
    const apiKey = await getApiKey(options.signal);
    if (!apiKey) {
        throw new Error("Brave Search API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "braveApiKey": "your-key" }\n` +
            "  2. Set BRAVE_API_KEY environment variable\n" +
            "Get a key at https://brave.com/search/api/");
    }
    const numResults = normalizeSearchResultCount(options.numResults);
    const domainFilters = normalizeDomainFilters(options.domainFilter);
    const searchQuery = buildBraveQuery(query, options.domainFilter);
    const activityId = activityMonitor.logStart({ type: "api", query: searchQuery });
    const params = new URLSearchParams({
        q: searchQuery,
        count: String(options.domainFilter?.length ? 20 : numResults),
    });
    if (options.recencyFilter) {
        const freshnessMap = {
            day: "pd",
            week: "pw",
            month: "pm",
            year: "py",
        };
        const freshness = freshnessMap[options.recencyFilter];
        if (freshness)
            params.set("freshness", freshness);
    }
    try {
        const searchDeadline = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
        const searchSignal = options.signal
            ? AbortSignal.any([searchDeadline, options.signal])
            : searchDeadline;
        const response = await braveRateLimit.run(async () => {
            for (let attempt = 0; attempt < 2; attempt++) {
                const current = await fetchWithCredentialRedirects(`${apiUrl}?${params.toString()}`, {
                    method: "GET",
                    headers: {
                        "X-Subscription-Token": apiKey,
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip",
                    },
                    signal: searchSignal,
                }, ["X-Subscription-Token"]);
                braveRateLimit.observe(current.headers);
                if (current.status !== 429 || attempt === 1)
                    return current;
                const retryDelay = braveRateLimit.retryDelay(current.headers);
                if (retryDelay === null)
                    return current;
                braveRateLimit.recordRetryDelay(retryDelay);
                await current.body?.cancel().catch(() => undefined);
                await braveRateLimit.waitForRecordedCooldown(searchSignal);
            }
            throw new Error("Brave Search retry loop exited unexpectedly");
        }, searchSignal);
        if (!response.ok) {
            activityMonitor.logError(activityId, `HTTP ${response.status}`);
            const errorText = redactCredential(await response.text(), apiKey);
            throw new Error(`Brave Search API error ${response.status}: ${errorText.slice(0, 300)}`);
        }
        const data = await response.json();
        activityMonitor.logComplete(activityId, response.status);
        const results = [];
        for (const item of data.web?.results ?? []) {
            if (!item.url || !matchesDomainFilters(item.url, domainFilters))
                continue;
            results.push({
                title: item.title || item.url,
                url: item.url,
                snippet: item.description || "",
            });
            if (results.length >= numResults)
                break;
        }
        const answer = results
            .map((result) => {
            if (result.snippet)
                return `${result.snippet}\nSource: ${result.title} (${result.url})`;
            return `Source: ${result.title} (${result.url})`;
        })
            .join("\n\n");
        return { answer, results };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const redactedMessage = redactCredential(message, apiKey);
        if (redactedMessage.toLowerCase().includes("abort")) {
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
