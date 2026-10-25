import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { fetchWithCredentialRedirects, getWebSearchConfigPath, resolveApiBaseUrl } from "./utils.js";
const TAVILY_API_BASE_URL = "https://api.tavily.com";
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
        provider: "Tavily",
        configuredValue: loadConfig().tavilyApiKey,
        environmentValue: process.env.TAVILY_API_KEY,
        signal,
    });
}
const TAVILY_KEY_POOL_RETRIES = new Set([401, 402, 403, 429, 432]);
function tavilyKeyPool() {
    const slots = [];
    for (let slot = 1; slot <= 20; slot++) {
        const key = process.env[`TAVILY_API_KEY_${slot}`]?.trim();
        if (key)
            slots.push([slot, key]);
    }
    const requestedSlot = Number.parseInt(process.env.TAVILY_API_KEY_INDEX ?? "", 10) || 1;
    const start = Math.max(0, slots.findIndex(([slot]) => slot >= requestedSlot));
    return [...new Set([...slots.slice(start), ...slots.slice(0, start)].map(([, key]) => key))];
}
function getApiUrl() {
    return `${resolveApiBaseUrl({
        configKey: "tavilyBaseUrl",
        configuredValue: loadConfig().tavilyBaseUrl,
        defaultValue: TAVILY_API_BASE_URL,
        environmentKey: "TAVILY_BASE_URL",
        environmentValue: process.env.TAVILY_BASE_URL,
    })}/search`;
}
async function requireApiKey(signal) {
    const apiKey = await getApiKey(signal);
    if (!apiKey) {
        throw new Error("Tavily API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "tavilyApiKey": "your-key" }\n` +
            "  2. Set TAVILY_API_KEY environment variable\n" +
            "Get a key at https://app.tavily.com/");
    }
    return apiKey;
}
function mapDomainFilter(domainFilter) {
    if (!domainFilter?.length)
        return {};
    const include_domains = [];
    const exclude_domains = [];
    for (const raw of domainFilter) {
        const domain = normalizeDomain(raw);
        if (!domain)
            continue;
        const target = raw.trim().startsWith("-") ? exclude_domains : include_domains;
        if (!target.includes(domain))
            target.push(domain);
    }
    return {
        ...(include_domains.length > 0 ? { include_domains } : {}),
        ...(exclude_domains.length > 0 ? { exclude_domains } : {}),
    };
}
function requestSignal(signal) {
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function mapResults(results, numResults) {
    if (!Array.isArray(results))
        return [];
    const mapped = [];
    for (const item of results) {
        if (!item?.url)
            continue;
        mapped.push({
            title: item.title || `Source ${mapped.length + 1}`,
            url: item.url,
            snippet: typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim() : "",
        });
        if (mapped.length >= numResults)
            break;
    }
    return mapped;
}
function mapInlineContent(results) {
    if (!Array.isArray(results))
        return [];
    return results.flatMap((item) => {
        if (!item?.url || typeof item.raw_content !== "string" || item.raw_content.trim().length === 0)
            return [];
        return [{
                url: item.url,
                title: item.title || "",
                content: item.raw_content,
                error: null,
            }];
    });
}
export function isTavilyAvailable() {
    return hasCredentialSource({
        provider: "Tavily",
        configuredValue: loadConfig().tavilyApiKey,
        environmentValue: process.env.TAVILY_API_KEY,
    }) || tavilyKeyPool().length > 0;
}
export async function searchWithTavily(query, options = {}) {
    const apiUrl = getApiUrl();
    const numResults = normalizeSearchResultCount(options.numResults);
    const body = {
        query,
        search_depth: "basic",
        max_results: numResults,
        include_answer: "basic",
        include_raw_content: options.includeContent ? "markdown" : false,
        ...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
        ...mapDomainFilter(options.domainFilter),
    };
    const signal = requestSignal(options.signal);
    const activityId = activityMonitor.logStart({ type: "api", query });
    let data;
    try {
        data = await requestWithKeyFailover(apiUrl, body, signal);
    }
    catch (err) {
        if (options.signal?.aborted || (err instanceof Error && err.name === "AbortError"))
            activityMonitor.logComplete(activityId, 0);
        else {
            const status = tavilyErrorStatus(err);
            if (status > 0)
                activityMonitor.logComplete(activityId, status);
            else
                activityMonitor.logError(activityId, errorMessage(err));
        }
        throw err;
    }
    activityMonitor.logComplete(activityId, 200);
    const result = {
        answer: typeof data.answer === "string" ? data.answer : "",
        results: mapResults(data.results, numResults),
    };
    if (options.includeContent) {
        const inlineContent = mapInlineContent(data.results);
        if (inlineContent.length > 0)
            result.inlineContent = inlineContent;
    }
    return result;
}
function tavilyErrorStatus(err) {
    return Number(errorMessage(err).match(/^Tavily API error (\d{3}):/)?.[1] ?? 0);
}
async function requestWithKeyFailover(apiUrl, body, signal) {
    const pool = tavilyKeyPool();
    const keys = pool.length > 0 ? pool : [await requireApiKey(signal)];
    let fallbackChecked = pool.length === 0;
    for (let i = 0;; i++) {
        try {
            return await tavilyRequest(apiUrl, keys[i], body, signal);
        }
        catch (err) {
            if (!TAVILY_KEY_POOL_RETRIES.has(tavilyErrorStatus(err)))
                throw err;
            if (i + 1 < keys.length)
                continue;
            if (fallbackChecked)
                throw err;
            // Resolve the standalone credential only after every numbered pool key failed.
            fallbackChecked = true;
            const fallback = await getApiKey(signal);
            if (!fallback || keys.includes(fallback))
                throw err;
            keys.push(fallback);
        }
    }
}
async function tavilyRequest(apiUrl, apiKey, body, signal) {
    let response;
    try {
        response = await fetchWithCredentialRedirects(apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal,
        }, ["Authorization"]);
    }
    catch (err) {
        const message = errorMessage(err);
        const redactedMessage = redactCredential(message, apiKey);
        if (redactedMessage === message)
            throw err;
        const redactedError = new Error(redactedMessage);
        if (err instanceof Error)
            redactedError.name = err.name;
        throw redactedError;
    }
    if (!response.ok) {
        const errorText = redactCredential(await response.text(), apiKey);
        throw new Error(`Tavily API error ${response.status}: ${errorText.slice(0, 300)}`);
    }
    try {
        return await response.json();
    }
    catch (err) {
        throw new Error(`Tavily API returned invalid JSON: ${errorMessage(err)}`);
    }
}
