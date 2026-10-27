import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { fetchWithCredentialRedirects, getWebSearchConfigPath } from "./utils.js";
const YOU_SEARCH_URL = "https://ydc-index.io/v1/search";
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
async function requireApiKey(signal) {
    const apiKey = await resolveCredential({
        provider: "You.com",
        configuredValue: loadConfig().youApiKey,
        environmentValue: process.env.YDC_API_KEY,
        signal,
    });
    if (!apiKey) {
        throw new Error("You.com API key not found. Either:\n" +
            `  1. Create ${CONFIG_PATH} with { "youApiKey": "your-key" }\n` +
            "  2. Set YDC_API_KEY environment variable\n" +
            "Get a key at https://you.com/platform/api-keys");
    }
    return apiKey;
}
function mapDomainFilter(domainFilter) {
    const include_domains = [];
    const exclude_domains = [];
    for (const raw of domainFilter ?? []) {
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
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function parseWebResults(value) {
    const results = value && typeof value === "object" ? value.results : undefined;
    const web = results && typeof results === "object" ? results.web : undefined;
    if (!Array.isArray(web))
        throw new Error("You.com returned invalid response: expected results.web array");
    return web;
}
export function isYouAvailable() {
    return hasCredentialSource({ provider: "You.com", configuredValue: loadConfig().youApiKey, environmentValue: process.env.YDC_API_KEY });
}
export async function searchWithYou(query, options = {}) {
    const apiKey = await requireApiKey(options.signal);
    const numResults = normalizeSearchResultCount(options.numResults);
    const body = {
        query,
        count: numResults,
        ...(options.recencyFilter ? { freshness: options.recencyFilter } : {}),
        ...mapDomainFilter(options.domainFilter),
    };
    const activityId = activityMonitor.logStart({ type: "api", query });
    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    let response;
    let entries;
    try {
        response = await fetchWithCredentialRedirects(YOU_SEARCH_URL, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify(body),
            signal: options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal,
        }, ["X-API-Key"]);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`You.com error ${response.status}: ${redactCredential(errorText, apiKey).slice(0, 300)}`);
        }
        let rawData;
        try {
            rawData = await response.json();
        }
        catch (err) {
            if (err instanceof Error && err.name === "TimeoutError")
                throw err;
            throw new Error(`You.com returned invalid JSON: ${errorMessage(err)}`);
        }
        entries = parseWebResults(rawData);
    }
    catch (err) {
        if (options.signal?.aborted) {
            activityMonitor.logComplete(activityId, 0);
            throw new Error("Aborted");
        }
        const message = errorMessage(err);
        const providerTimeout = timeoutSignal.aborted || (err instanceof Error && err.name === "TimeoutError");
        const outgoing = providerTimeout
            ? new Error(`You.com request timed out after ${Math.round(SEARCH_TIMEOUT_MS / 1000)}s`)
            : (() => {
                const redactedMessage = redactCredential(message, apiKey);
                if (redactedMessage === message && err instanceof Error)
                    return err;
                const redactedError = new Error(redactedMessage);
                if (err instanceof Error)
                    redactedError.name = err.name;
                return redactedError;
            })();
        activityMonitor.logError(activityId, redactCredential(errorMessage(outgoing), apiKey));
        throw outgoing;
    }
    activityMonitor.logComplete(activityId, response.status);
    const results = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== "object")
            continue;
        const { url, title, description, snippets } = entry;
        if (typeof url !== "string" || !url)
            continue;
        let resultUrl;
        try {
            resultUrl = new URL(url);
        }
        catch {
            continue;
        }
        if (resultUrl.protocol !== "http:" && resultUrl.protocol !== "https:")
            continue;
        const snippet = typeof description === "string" && description.trim()
            ? description
            : Array.isArray(snippets) && typeof snippets[0] === "string" ? snippets[0] : "";
        results.push({
            title: typeof title === "string" && title.trim() ? title.trim() : `Source ${results.length + 1}`,
            url: resultUrl.href,
            snippet,
        });
        if (results.length >= numResults)
            break;
    }
    return { answer: formatSearchResultsAsAnswer(results), results };
}
