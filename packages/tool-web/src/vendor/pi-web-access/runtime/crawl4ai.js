import { existsSync, readFileSync } from "node:fs";
import { activityMonitor } from "./activity.js";
import { redactCredential, resolveCredential } from "./credential-source.js";
import { fetchRemoteUrl, loadSsrfConfig, validateRemoteUrl } from "./ssrf-protection.js";
import { getWebSearchConfigPath, isLoopbackHostname } from "./utils.js";
const CONFIG_PATH = getWebSearchConfigPath();
const EXTRACT_TIMEOUT_MS = 60_000;
const MARKDOWN_FILTER = "fit";
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
export function clearCrawl4aiConfigCache() {
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
        throw new Error(`Invalid Crawl4AI base URL in ${CONFIG_PATH}: expected an HTTP or HTTPS URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`Invalid Crawl4AI base URL in ${CONFIG_PATH}: expected an HTTP or HTTPS URL`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Invalid Crawl4AI base URL in ${CONFIG_PATH}: URL credentials are not allowed`);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
}
function getBaseUrl() {
    return normalizeBaseUrl(process.env.CRAWL4AI_BASE_URL) ?? normalizeBaseUrl(loadConfig().crawl4aiBaseUrl);
}
function requireBaseUrl() {
    const baseUrl = getBaseUrl();
    if (!baseUrl) {
        throw new Error("Crawl4AI base URL not configured. Either:\n" +
            `  1. Set crawl4aiBaseUrl in ${CONFIG_PATH}\n` +
            "  2. Set CRAWL4AI_BASE_URL environment variable");
    }
    return baseUrl;
}
async function getApiToken(signal) {
    return resolveCredential({
        provider: "Crawl4AI",
        configuredValue: loadConfig().crawl4aiApiToken,
        environmentValue: process.env.CRAWL4AI_API_TOKEN,
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
function isAbortException(err) {
    return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}
function ssrfOptions(options) {
    return {
        ...(options?.ssrf ?? loadSsrfConfig()),
        ...(options?.lookup ? { lookup: options.lookup } : {}),
    };
}
function firstHeadingTitle(markdown) {
    return /^[ \t]*#[ \t]+(\S.*?)[ \t\r]*$/m.exec(markdown)?.[1] ?? "";
}
export function isCrawl4aiAvailable() {
    return getBaseUrl() !== null;
}
export async function extractWithCrawl4ai(url, signal, options) {
    const baseUrl = requireBaseUrl();
    const ssrf = ssrfOptions(options);
    await validateRemoteUrl(url, ssrf);
    const token = await getApiToken(signal);
    const headers = { "Content-Type": "application/json" };
    if (token)
        headers.Authorization = `Bearer ${token}`;
    const requestUrl = new URL(`${baseUrl}/md`);
    const init = {
        method: "POST",
        headers,
        body: JSON.stringify({ url, f: MARKDOWN_FILTER }),
        signal: requestSignal(options?.timeoutMs ?? EXTRACT_TIMEOUT_MS, signal),
    };
    let seeOther = false;
    const activityId = activityMonitor.logStart({ type: "fetch", url: requestUrl.toString() });
    try {
        const response = await fetchRemoteUrl(requestUrl, init, {
            ...ssrf,
            allowLoopback: isLoopbackHostname(requestUrl.hostname),
            onRedirect: ({ to, init: redirectInit, response }) => {
                if (to.origin !== requestUrl.origin) {
                    throw new Error(`Crawl4AI refused cross-origin redirect to ${to.origin}`);
                }
                // 303 genuinely means "GET the other resource", and it is final: once a hop has turned the
                // chain into a GET, no later hop may resurrect the extraction body.
                if (response.status === 303)
                    seeOther = true;
                // 301/302 are the hops a reverse proxy in front of a self-hosted instance actually emits, and
                // fetchRemoteUrl turns those into a bodyless GET that /md cannot serve, so replay the POST.
                // 307/308 already keep the method, so their init needs no help.
                const replayPost = !seeOther && (response.status === 301 || response.status === 302);
                return replayPost ? init : redirectInit;
            },
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Crawl4AI md error ${response.status}: ${redactCredential(text, token).slice(0, 300)}`);
        }
        let data;
        try {
            data = await response.json();
        }
        catch {
            // The parser message quotes the offending body, which can echo the configured token, so it never
            // reaches the thrown error or the activity log.
            throw new Error("Crawl4AI md returned invalid JSON");
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Crawl4AI md returned an unexpected response shape");
        }
        const envelope = data;
        if (envelope.success === false) {
            const detail = typeof envelope.error === "string" ? envelope.error : typeof envelope.detail === "string" ? envelope.detail : "";
            throw new Error(`Crawl4AI md unsuccessful: ${redactCredential(detail.trim() || "unknown error", token)}`);
        }
        if (envelope.success !== true) {
            throw new Error("Crawl4AI md returned an unexpected response shape");
        }
        if (typeof envelope.markdown !== "string") {
            throw new Error("Crawl4AI md returned markdown in an unexpected shape");
        }
        activityMonitor.logComplete(activityId, response.status);
        const content = envelope.markdown.trim();
        if (!content)
            return null;
        return { url, title: firstHeadingTitle(content), content, error: null };
    }
    catch (err) {
        if (signal?.aborted || isAbortException(err))
            activityMonitor.logComplete(activityId, 0);
        else
            activityMonitor.logError(activityId, errorMessage(err));
        throw err;
    }
}
