import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { normalizeDomain } from "./domain-filter-normalization.js";
import { formatSearchResultsAsAnswer } from "./search-answer-formatting.js";
import { normalizeSearchResultCount } from "./search-result-count-normalization.js";
import { hasCredentialSource, redactCredential, resolveCredential } from "./credential-source.js";
import { getWebSearchConfigPath } from "./utils.js";
const XCRAWL_API_URL = "https://run.xcrawl.com/v1/serp";
const CONFIG_PATH = getWebSearchConfigPath();
// The SERP API is usually fast (a few seconds, cached responses are quicker),
// but leave generous headroom before treating a slow job as a provider failure.
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
        provider: "XCrawl",
        configuredValue: loadConfig().xcrawlApiKey,
        environmentValue: process.env.XCRAWL_API_KEY,
        signal,
    });
}
export function isXcrawlAvailable() {
    return hasCredentialSource({ provider: "XCrawl", configuredValue: loadConfig().xcrawlApiKey, environmentValue: process.env.XCRAWL_API_KEY });
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function invalidResponse(message) {
    return new Error(`XCrawl API returned invalid response: ${message}`);
}
function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return "";
    }
}
// XCrawl's Google SERP results can carry links relative to the API origin
// (e.g. "/goto?url=..." redirect stubs) instead of the documented absolute
// URLs. Resolve those against the API origin so callers always receive a
// well-formed absolute URL; absolute http(s) links pass through unchanged.
function absolutizeLink(link) {
    if (/^https?:\/\//i.test(link))
        return link;
    try {
        return new URL(link, XCRAWL_API_URL).href;
    }
    catch {
        return link;
    }
}
// XCrawl's SERP API has no server-side domain filter, so apply the shared
// include/exclude domainFilter locally instead of returning off-domain results.
function applyDomainFilter(results, domainFilter) {
    const includes = [];
    const excludes = [];
    for (const raw of domainFilter) {
        const normalized = normalizeDomain(raw);
        if (!normalized)
            continue;
        if (raw.trim().startsWith("-"))
            excludes.push(normalized);
        else
            includes.push(normalized);
    }
    if (!includes.length && !excludes.length)
        return results;
    return results.filter((result) => {
        const host = hostnameOf(result.url);
        if (!host)
            return false;
        const matches = (domain) => host === domain || host.endsWith(`.${domain}`);
        if (excludes.some(matches))
            return false;
        if (includes.length && !includes.some(matches))
            return false;
        return true;
    });
}
function parseResponse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalidResponse("expected an object envelope");
    }
    const envelope = value;
    const metadata = envelope.search_metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw invalidResponse("expected search_metadata object");
    }
    const status = metadata.status;
    if (status !== undefined && status !== "completed") {
        throw invalidResponse(`expected search_metadata.status \"completed\", got ${JSON.stringify(status)}`);
    }
    if (!Array.isArray(envelope.organic_results))
        throw invalidResponse("expected organic_results array");
    const results = [];
    for (const [index, value] of envelope.organic_results.entries()) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw invalidResponse(`expected organic_results[${index}] object`);
        }
        const result = value;
        const { title, link, snippet } = result;
        if (typeof link !== "string" || !link.trim())
            throw invalidResponse(`expected organic_results[${index}].link to be a non-empty string`);
        if (title !== null && title !== undefined && typeof title !== "string") {
            throw invalidResponse(`expected organic_results[${index}].title to be a string or null`);
        }
        if (snippet !== undefined && snippet !== null && typeof snippet !== "string") {
            throw invalidResponse(`expected organic_results[${index}].snippet to be a string or null`);
        }
        const resolved = absolutizeLink(link.trim());
        results.push({
            title: typeof title === "string" && title.trim().length > 0 ? title : resolved,
            url: resolved,
            snippet: typeof snippet === "string" ? snippet : "",
        });
    }
    return results;
}
export async function searchWithXCrawl(query, options = {}) {
    const apiKey = await getApiKey(options.signal);
    const numResults = normalizeSearchResultCount(options.numResults);
    if (!apiKey) {
        throw new Error("XCrawl search requires an API key. Set xcrawlApiKey in " + CONFIG_PATH +
            " or export XCRAWL_API_KEY. Get one at https://dash.xcrawl.com/");
    }
    const body = { engine: "google_search", q: query };
    const activityId = activityMonitor.logStart({ type: "api", query });
    // Distinguishing caller cancellation from a provider-side timeout lets the
    // timeout surface as a retriable failure instead of looking like an abort.
    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    let response;
    try {
        response = await fetch(XCRAWL_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: options.signal
                ? AbortSignal.any([timeoutSignal, options.signal])
                : timeoutSignal,
        });
    }
    catch (err) {
        const message = errorMessage(err);
        if (options.signal?.aborted) {
            activityMonitor.logComplete(activityId, 0);
            throw new Error("Aborted");
        }
        // AbortSignal.timeout rejects with a TimeoutError; treat either that
        // shape or our own fired timer as a retriable provider-side timeout so
        // routing fallback still applies.
        const providerTimeout = timeoutSignal.aborted || (err instanceof Error && err.name === "TimeoutError");
        let outgoing;
        if (providerTimeout) {
            outgoing = new Error(`XCrawl search request timed out after ${Math.round(SEARCH_TIMEOUT_MS / 1000)}s`);
        }
        else {
            const redactedMessage = redactCredential(message, apiKey);
            outgoing = redactedMessage === message && err instanceof Error ? err : new Error(redactedMessage);
            if (err instanceof Error && outgoing.name === "Error")
                outgoing.name = err.name;
        }
        activityMonitor.logError(activityId, redactCredential(errorMessage(outgoing), apiKey));
        throw outgoing;
    }
    if (!response.ok) {
        activityMonitor.logComplete(activityId, response.status);
        const errorText = redactCredential(await response.text(), apiKey);
        let detail = errorText.slice(0, 300);
        try {
            const parsed = JSON.parse(errorText);
            if (typeof parsed.message === "string")
                detail = parsed.message.slice(0, 300);
            else if (typeof parsed.error === "string")
                detail = parsed.error.slice(0, 300);
        }
        catch {
            // keep raw text slice
        }
        throw new Error(`XCrawl API error (${response.status}): ${detail}`);
    }
    activityMonitor.logComplete(activityId, response.status);
    let payload;
    try {
        payload = await response.json();
    }
    catch (err) {
        throw invalidResponse(`response body is not valid JSON: ${errorMessage(err)}`);
    }
    const results = parseResponse(payload);
    const filtered = (options.domainFilter?.length ? applyDomainFilter(results, options.domainFilter) : results).slice(0, numResults);
    return {
        answer: formatSearchResultsAsAnswer(filtered),
        results: filtered,
    };
}
