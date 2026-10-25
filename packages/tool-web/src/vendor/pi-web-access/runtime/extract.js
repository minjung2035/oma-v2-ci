import { existsSync, readFileSync } from "node:fs";
import pLimit from "p-limit";
import { activityMonitor } from "./activity.js";
import { extractRSCContent } from "./rsc-extract.js";
import { extractPDFToMarkdown, isPDF, loadPDFConfig } from "./pdf-extract.js";
import { extractGitHub } from "./github-extract.js";
import { extractGitHubIssuePr } from "./github-issue-pr.js";
import { isYouTubeURL, isYouTubeEnabled, extractYouTube, extractYouTubeFrame, extractYouTubeFrames, getYouTubeStreamInfo } from "./youtube-extract.js";
import { CredentialResolutionError } from "./credential-source.js";
import { extractWithUrlContext, extractWithGeminiWeb } from "./gemini-url-context.js";
import { extractWithParallel, isParallelAvailable } from "./parallel.js";
import { extractWithParallelMcp } from "./parallel-mcp.js";
import { extractWithTinyFish, isTinyFishAvailable } from "./tinyfish.js";
import { extractWithSearch1API, isSearch1APIAvailable } from "./search1api.js";
import { extractWithQuerit, isQueritAvailable } from "./querit.js";
import { extractWithKagi, isKagiExtractAvailable } from "./kagi.js";
import { extractWithOllama, isOllamaFetchAvailable } from "./ollama.js";
import { extractWithFirecrawl, isFirecrawlAvailable } from "./firecrawl.js";
import { extractWithCrawl4ai, isCrawl4aiAvailable } from "./crawl4ai.js";
import { extractWithBrightDataUnlocker, isBrightDataUnlockerAvailable } from "./brightdata-unlocker.js";
import { isVideoFile, extractVideo, extractVideoFrame, getLocalVideoDuration } from "./video-extract.js";
import { appendDeclaredWebLinks, discoverDeclaredWebLinks } from "./declared-web-links.js";
import { fetchRemoteUrl, loadFetchContentDomainPolicy, loadSsrfConfig, validateRemoteUrl } from "./ssrf-protection.js";
import { formatSeconds, getWebSearchConfigPath } from "./utils.js";
import { isImageEnabled } from "./feature-config.js";
import { assertAuthFetchUrl, authFetchRedirectGuard } from "./auth-fetch.js";
import { getBrowserCookiesForHosts, getLastBrowserCookieDiagnostic } from "./chrome-cookies.js";
import { sanitizeInlineDataUris } from "./data-uri-sanitize.js";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_CONFIGURED_TIMEOUT_MS = 2_147_483_647;
const CONCURRENT_LIMIT = 3;
const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();
function loadFetchTimeoutMs() {
    if (!existsSync(WEB_SEARCH_CONFIG_PATH))
        return DEFAULT_TIMEOUT_MS;
    let raw;
    try {
        raw = JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8"));
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Invalid config in ${WEB_SEARCH_CONFIG_PATH}: expected a JSON object`);
    }
    const fetchConfig = raw.fetch;
    if (fetchConfig === undefined)
        return DEFAULT_TIMEOUT_MS;
    if (!fetchConfig || typeof fetchConfig !== "object" || Array.isArray(fetchConfig)) {
        throw new Error(`fetch in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
    }
    const value = fetchConfig.timeout;
    if (value === undefined)
        return DEFAULT_TIMEOUT_MS;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid fetch.timeout in ${WEB_SEARCH_CONFIG_PATH}: expected a positive finite number of seconds, got ${JSON.stringify(value)}`);
    }
    const timeoutMs = Math.ceil(value * 1000);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CONFIGURED_TIMEOUT_MS) {
        throw new Error(`Invalid fetch.timeout in ${WEB_SEARCH_CONFIG_PATH}: converted timeout must be a finite safe integer from 1 through ${MAX_CONFIGURED_TIMEOUT_MS} milliseconds`);
    }
    return Math.max(1, timeoutMs);
}
const NON_RECOVERABLE_ERRORS = ["Unsupported content type", "Response too large", "PDF extraction is disabled", "Image fetching is disabled"];
const MIN_USEFUL_CONTENT = 500;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FETCH_PROVIDERS = ["http", "firecrawl", "crawl4ai", "jina", "tinyfish", "search1api", "querit", "kagi", "ollama", "parallel", "parallel-mcp", "brightdata", "gemini"];
const DEFAULT_FETCH_PROVIDER_ORDER = ["http", "firecrawl", "crawl4ai", "jina", "tinyfish", "search1api", "querit", "kagi", "ollama", "parallel", "brightdata", "gemini"];
const REMOTE_HOSTED_FETCH_PROVIDERS = new Set(["jina", "tinyfish", "search1api", "querit", "kagi", "ollama", "parallel", "parallel-mcp", "brightdata", "gemini"]);
function isDefuddleConsoleError(args) {
    const prefix = args[0];
    return prefix === "Defuddle" || (typeof prefix === "string" && /^Defuddle(?:\s|:)/.test(prefix));
}
async function extractWithDefuddle(text, url) {
    const { Defuddle } = await import("defuddle/node");
    const { parseHTML } = await import("linkedom");
    const { document } = parseHTML(text);
    Object.defineProperty(document, "location", {
        value: new URL(url),
        configurable: true,
    });
    let processingError;
    const originalConsoleError = console.error;
    console.error = (...args) => {
        if (isDefuddleConsoleError(args)) {
            if (args[0] === "Defuddle" && args[1] === "Error processing document:") {
                processingError = args[2];
            }
            return;
        }
        originalConsoleError(...args);
    };
    let resultPromise;
    try {
        // With useAsync:false, Defuddle parses synchronously before returning its promise.
        // Keep the console interception limited to that call so unrelated Pi output is
        // never routed through this fallback's handler.
        resultPromise = Defuddle(document, url, { markdown: true, useAsync: false });
    }
    finally {
        console.error = originalConsoleError;
    }
    const result = await resultPromise;
    if (processingError !== undefined) {
        throw new Error(`Defuddle failed to process document: ${errorMessage(processingError)}`);
    }
    return typeof result.content === "string" ? { title: result.title, content: result.content } : null;
}
export { loadSsrfConfig } from "./ssrf-protection.js";
export function loadSsrfAllowRanges() {
    return loadSsrfConfig().allowRanges;
}
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
function isConfigParseError(err) {
    return errorMessage(err).startsWith("Failed to parse ");
}
function isAbortError(err) {
    return errorMessage(err).toLowerCase().includes("abort");
}
function isAbortException(err) {
    return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}
function isRedirectPolicyError(message) {
    return message.startsWith("Authenticated fetch refused cross-origin redirect") ||
        message.startsWith("Blocked internal ") ||
        message.startsWith("Blocked hostname by fetch_content domain policy") ||
        message.startsWith("Hostname not allowed by fetch_content domain policy") ||
        message.startsWith("Too many redirects fetching ") ||
        message === "Only HTTP and HTTPS URLs can be fetched remotely" ||
        message === "URL must include a hostname" ||
        message.startsWith("Failed to resolve ");
}
function imageGateError() {
    try {
        return isImageEnabled() ? null : "Image fetching is disabled by image.enabled";
    }
    catch (err) {
        return errorMessage(err);
    }
}
async function resolveAuthCookieHeader(url, profile) {
    const parsed = assertAuthFetchUrl(profile, url.toString());
    const result = await getBrowserCookiesForHosts({ hosts: [parsed.hostname], profile: profile.chromeProfile, requestUrl: parsed });
    if (result?.cookieHeader)
        return result.cookieHeader;
    if (!result) {
        const diagnostic = getLastBrowserCookieDiagnostic();
        throw new Error(`Authenticated fetch profile ${profile.name} could not read browser cookies${diagnostic ? `: ${diagnostic}` : ""}`);
    }
    throw new Error(`Authenticated fetch profile ${profile.name} could not build a cookie header`);
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
async function fetchAuthenticatedRemoteUrl(url, init, validationOptions, profile) {
    let current = await validateRemoteUrl(url, {
        allowRanges: validationOptions.ssrf.allowRanges,
        trustEnvProxy: validationOptions.ssrf.trustEnvProxy,
        domainPolicy: validationOptions.domainPolicy,
        proxy: validationOptions.proxy,
        ...(validationOptions.lookup ? { lookup: validationOptions.lookup } : {}),
    });
    let requestInit = init;
    for (let redirects = 0; redirects <= 5; redirects++) {
        const cookieHeader = await resolveAuthCookieHeader(current, profile);
        const headers = { ...requestInit.headers, cookie: cookieHeader };
        const response = await fetch(current, { ...requestInit, headers, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status))
            return response;
        const location = response.headers.get("location");
        if (!location)
            return response;
        if (redirects === 5)
            throw new Error(`Too many redirects fetching ${current.toString()}`);
        const from = current;
        current = await validateRemoteUrl(new URL(location, current), {
            allowRanges: validationOptions.ssrf.allowRanges,
            trustEnvProxy: validationOptions.ssrf.trustEnvProxy,
            domainPolicy: validationOptions.domainPolicy,
            proxy: validationOptions.proxy,
            ...(validationOptions.lookup ? { lookup: validationOptions.lookup } : {}),
        });
        authFetchRedirectGuard(profile, from, current);
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestInit.method?.toUpperCase() === "POST")) {
            const { body: _body, ...nextInit } = requestInit;
            requestInit = { ...nextInit, method: "GET" };
        }
    }
    throw new Error(`Too many redirects fetching ${current.toString()}`);
}
function loadFetchRouting() {
    if (!existsSync(WEB_SEARCH_CONFIG_PATH)) {
        return { providers: DEFAULT_FETCH_PROVIDER_ORDER, allowRemoteHostedProviders: false };
    }
    let raw;
    try {
        const parsed = JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("expected a JSON object");
        }
        raw = parsed;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
    }
    if (!Object.hasOwn(raw, "fetchRouting")) {
        return { providers: DEFAULT_FETCH_PROVIDER_ORDER, allowRemoteHostedProviders: false };
    }
    const routing = raw.fetchRouting;
    if (!routing || typeof routing !== "object" || Array.isArray(routing)) {
        throw new Error(`fetchRouting in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
    }
    const routingConfig = routing;
    const providersValue = routingConfig.providers;
    let providers = DEFAULT_FETCH_PROVIDER_ORDER;
    if (providersValue !== undefined) {
        if (!Array.isArray(providersValue) || providersValue.length === 0) {
            throw new Error(`fetchRouting.providers in ${WEB_SEARCH_CONFIG_PATH} must be a non-empty array`);
        }
        providers = [];
        for (const provider of providersValue) {
            const normalized = typeof provider === "string" ? provider.trim().toLowerCase() : "";
            if (!FETCH_PROVIDERS.includes(normalized)) {
                throw new Error(`fetchRouting.providers in ${WEB_SEARCH_CONFIG_PATH} contains an invalid provider: ${String(provider)}`);
            }
            if (providers.includes(normalized)) {
                throw new Error(`fetchRouting.providers in ${WEB_SEARCH_CONFIG_PATH} must not contain duplicates: ${normalized}`);
            }
            providers.push(normalized);
        }
    }
    const allowRemoteHostedProvidersValue = routingConfig.allowRemoteHostedProviders;
    if (allowRemoteHostedProvidersValue !== undefined && typeof allowRemoteHostedProvidersValue !== "boolean") {
        throw new Error(`fetchRouting.allowRemoteHostedProviders in ${WEB_SEARCH_CONFIG_PATH} must be a boolean`);
    }
    return { providers, allowRemoteHostedProviders: allowRemoteHostedProvidersValue === true };
}
/** Guidance for definitive origin 404/410 responses: no extraction provider
 * can retrieve a page the origin says is gone, so point at the registered
 * search/fetch tools (when the caller knows them) instead of provider config. */
function notFoundGuidance(result, toolNames) {
    const lines = [
        result.error ?? `HTTP ${result.status}`,
        "",
        `The origin server says this page does not exist (HTTP ${result.status}), so extraction providers cannot retrieve it.`,
    ];
    if (toolNames?.webSearch && toolNames.fetchContent) {
        lines.push(`The page may have moved or been renamed. Use ${toolNames.webSearch} to find the current URL, then retry ${toolNames.fetchContent} with it.`);
    }
    else if (toolNames?.webSearch) {
        lines.push(`The page may have moved or been renamed. Use ${toolNames.webSearch} to find the current URL.`);
    }
    else {
        lines.push("The page may have moved or been renamed. Find the current URL, then retry the fetch with it.");
    }
    return lines.join("\n");
}
/** Fallback-list hint for the keyless Jina Reader. Returns null when Jina
 * already ran for this fetch, and otherwise names only the config change still
 * missing, so users keep their existing or default provider order. */
function jinaReaderGuidance(routing, providerOrder, needsRemoteOptIn) {
    if (providerOrder.includes("jina"))
        return null;
    const privacy = "target URLs are fetched through Jina's infrastructure";
    const optInCaveat = "this also allows the other hosted providers in your fetch provider order";
    if (routing.providers.includes("jina")) {
        return `  • Enable the keyless Jina Reader fallback: set fetchRouting.allowRemoteHostedProviders to true in ${WEB_SEARCH_CONFIG_PATH} (Jina is already in your fetch provider order; ${optInCaveat}; ${privacy})`;
    }
    return needsRemoteOptIn
        ? `  • Enable the keyless Jina Reader fallback: add "jina" to your existing fetchRouting.providers and set fetchRouting.allowRemoteHostedProviders to true in ${WEB_SEARCH_CONFIG_PATH} (${optInCaveat}; ${privacy})`
        : `  • Enable the keyless Jina Reader fallback: add "jina" to your existing fetchRouting.providers in ${WEB_SEARCH_CONFIG_PATH} (${privacy})`;
}
function abortedResult(url) {
    return { url, title: "", content: "", error: "Aborted" };
}
// Share first-use initialization without loading Turndown at extension startup.
let turndownInstance;
async function loadTurndown() {
    const { default: TurndownService } = await import("turndown");
    return new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
    });
}
function getTurndown() {
    turndownInstance ??= loadTurndown();
    return turndownInstance;
}
const fetchLimit = pLimit(CONCURRENT_LIMIT);
/** Resolve the direct HTTP/Jina fetch budget, with a per-call override taking precedence. */
export function resolveFetchTimeoutMs(options) {
    return options?.timeoutMs ?? loadFetchTimeoutMs();
}
const JINA_READER_BASE = "https://r.jina.ai/";
async function extractWithJinaReader(url, timeoutMs, signal, lookup) {
    const jinaUrl = JINA_READER_BASE + url;
    const activityId = activityMonitor.logStart({ type: "api", query: `jina: ${url}` });
    try {
        const ssrf = loadSsrfConfig();
        const domainPolicy = loadFetchContentDomainPolicy();
        await validateRemoteUrl(url, {
            allowRanges: ssrf.allowRanges,
            trustEnvProxy: ssrf.trustEnvProxy,
            domainPolicy,
            ...(lookup ? { lookup } : {}),
        });
        const res = await fetch(jinaUrl, {
            headers: {
                "Accept": "text/markdown",
                "X-No-Cache": "true",
            },
            signal: AbortSignal.any([
                AbortSignal.timeout(timeoutMs),
                ...(signal ? [signal] : []),
            ]),
        });
        if (!res.ok) {
            activityMonitor.logComplete(activityId, res.status);
            return null;
        }
        const content = await res.text();
        activityMonitor.logComplete(activityId, res.status);
        const contentStart = content.indexOf("Markdown Content:");
        if (contentStart < 0) {
            return null;
        }
        const markdownPart = content.slice(contentStart + 17).trim(); // 17 = "Markdown Content:".length
        // Check for failed JS rendering or minimal content
        if (markdownPart.length < 100 ||
            markdownPart.startsWith("Loading...") ||
            markdownPart.startsWith("Please enable JavaScript")) {
            return null;
        }
        const title = extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url);
        return { url, title, content: markdownPart, error: null };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
        }
        else {
            activityMonitor.logError(activityId, message);
        }
        return null;
    }
}
function parseTimestamp(ts) {
    const num = Number(ts);
    if (!isNaN(num) && num >= 0)
        return Math.floor(num);
    const parts = ts.split(":").map(Number);
    if (parts.some(p => isNaN(p) || p < 0))
        return null;
    if (parts.length === 3)
        return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2)
        return Math.floor(parts[0] * 60 + parts[1]);
    return null;
}
function parseTimestampSpec(ts) {
    const dashIdx = ts.indexOf("-", 1);
    if (dashIdx > 0) {
        const start = parseTimestamp(ts.slice(0, dashIdx));
        const end = parseTimestamp(ts.slice(dashIdx + 1));
        if (start !== null && end !== null && end > start)
            return { type: "range", start, end };
    }
    const seconds = parseTimestamp(ts);
    return seconds !== null ? { type: "single", seconds } : null;
}
const DEFAULT_RANGE_FRAMES = 6;
const MIN_FRAME_INTERVAL = 5;
function computeRangeTimestamps(start, end, maxFrames = DEFAULT_RANGE_FRAMES) {
    if (maxFrames <= 1)
        return [start];
    const duration = end - start;
    const idealInterval = duration / (maxFrames - 1);
    if (idealInterval < MIN_FRAME_INTERVAL) {
        const timestamps = [];
        for (let t = start; t <= end && timestamps.length < maxFrames; t += MIN_FRAME_INTERVAL) {
            timestamps.push(t);
        }
        return timestamps;
    }
    return Array.from({ length: maxFrames }, (_, i) => Math.round(start + i * idealInterval));
}
function buildFrameResult(url, label, requestedCount, frames, error, duration) {
    if (frames.length === 0) {
        const msg = error ?? "Frame extraction failed";
        return { url, title: `Frames ${label} (0/${requestedCount})`, content: msg, error: msg };
    }
    return {
        url,
        title: `Frames ${label} (${frames.length}/${requestedCount})`,
        content: `${frames.length} frames extracted from ${label}`,
        error: null,
        frames,
        ...(duration !== undefined ? { duration } : {}),
    };
}
async function extractLocalFrames(filePath, timestamps) {
    const results = await Promise.all(timestamps.map(async (t) => {
        const frame = await extractVideoFrame(filePath, t);
        if ("error" in frame)
            return { error: frame.error };
        return { ...frame, timestamp: formatSeconds(t) };
    }));
    const frames = results.filter((f) => "data" in f);
    const firstError = results.find((f) => "error" in f);
    return { frames, error: frames.length === 0 && firstError ? firstError.error : null };
}
function safeVideoInfo(url) {
    try {
        const info = isVideoFile(url);
        return info ? { status: "video", info } : { status: "not-video" };
    }
    catch (err) {
        return { status: "invalid", error: errorMessage(err) };
    }
}
export async function extractContent(url, signal, options) {
    if (signal?.aborted) {
        return { url, title: "", content: "", error: "Aborted" };
    }
    let remoteUrl = null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:")
            remoteUrl = parsed;
    }
    catch {
    }
    if (remoteUrl) {
        try {
            const ssrf = loadSsrfConfig();
            const domainPolicy = loadFetchContentDomainPolicy();
            await validateRemoteUrl(remoteUrl, {
                allowRanges: ssrf.allowRanges,
                trustEnvProxy: ssrf.trustEnvProxy,
                domainPolicy,
                proxy: options?.proxy,
                ...(options?.lookup ? { lookup: options.lookup } : {}),
            });
        }
        catch (err) {
            return { url, title: "", content: "", error: errorMessage(err) };
        }
    }
    if (options?.authFetchProfile || options?.mode === "raw") {
        try {
            return await extractViaHttp(url, resolveFetchTimeoutMs(options), signal, options);
        }
        catch (err) {
            return { url, title: "", content: "", error: errorMessage(err) };
        }
    }
    if (options?.frames || options?.timestamp) {
        const disabled = imageGateError();
        if (disabled)
            return { url, title: "", content: "", error: disabled };
    }
    if (options?.frames && !options.timestamp) {
        const frameCount = options.frames;
        const ytInfo = isYouTubeURL(url);
        if (ytInfo.isYouTube && ytInfo.videoId) {
            const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
            if ("error" in streamInfo) {
                return { url, title: "Frames", content: streamInfo.error, error: streamInfo.error };
            }
            if (streamInfo.duration === null) {
                const error = "Cannot determine video duration. Use a timestamp range instead.";
                return { url, title: "Frames", content: error, error };
            }
            const dur = Math.floor(streamInfo.duration);
            const timestamps = computeRangeTimestamps(0, dur, frameCount);
            const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
            const label = `${formatSeconds(0)}-${formatSeconds(dur)}`;
            return buildFrameResult(url, label, timestamps.length, result.frames, result.error, streamInfo.duration);
        }
        const localVideo = safeVideoInfo(url);
        if (localVideo.status === "invalid") {
            return { url, title: "", content: "", error: localVideo.error };
        }
        if (localVideo.status === "video") {
            const durationResult = await getLocalVideoDuration(localVideo.info.absolutePath);
            if (typeof durationResult !== "number") {
                return { url, title: "Frames", content: durationResult.error, error: durationResult.error };
            }
            const dur = Math.floor(durationResult);
            const timestamps = computeRangeTimestamps(0, dur, frameCount);
            const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
            const label = `${formatSeconds(0)}-${formatSeconds(dur)}`;
            return buildFrameResult(url, label, timestamps.length, result.frames, result.error, durationResult);
        }
        return { url, title: "", content: "", error: "Frame extraction only works with YouTube and local video files" };
    }
    if (options?.timestamp) {
        const spec = parseTimestampSpec(options.timestamp);
        if (!spec) {
            return {
                url,
                title: "",
                content: "",
                error: `Invalid timestamp format: "${options.timestamp}". Use "H:MM:SS", "MM:SS", "85", or "start-end".`,
            };
        }
        const frameCount = options.frames;
        const ytInfo = isYouTubeURL(url);
        if (ytInfo.isYouTube && ytInfo.videoId) {
            const streamInfo = await getYouTubeStreamInfo(ytInfo.videoId);
            if ("error" in streamInfo) {
                if (spec.type === "range") {
                    const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
                    return { url, title: `Frames ${label}`, content: streamInfo.error, error: streamInfo.error };
                }
                if (frameCount) {
                    const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
                    const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
                    return { url, title: `Frames ${label}`, content: streamInfo.error, error: streamInfo.error };
                }
                return { url, title: `Frame at ${options.timestamp}`, content: streamInfo.error, error: streamInfo.error };
            }
            if (spec.type === "range") {
                const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
                if (streamInfo.duration !== null && spec.end > streamInfo.duration) {
                    const error = `Timestamp ${formatSeconds(spec.end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
                    return { url, title: `Frames ${label}`, content: error, error };
                }
                const timestamps = frameCount
                    ? computeRangeTimestamps(spec.start, spec.end, frameCount)
                    : computeRangeTimestamps(spec.start, spec.end);
                const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
                return buildFrameResult(url, label, timestamps.length, result.frames, result.error, result.duration ?? undefined);
            }
            if (frameCount) {
                const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
                const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
                if (streamInfo.duration !== null && end > streamInfo.duration) {
                    const error = `Timestamp ${formatSeconds(end)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
                    return { url, title: `Frames ${label}`, content: error, error };
                }
                const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
                const result = await extractYouTubeFrames(ytInfo.videoId, timestamps, streamInfo);
                return buildFrameResult(url, label, timestamps.length, result.frames, result.error, result.duration ?? undefined);
            }
            if (streamInfo.duration !== null && spec.seconds > streamInfo.duration) {
                const error = `Timestamp ${formatSeconds(spec.seconds)} exceeds video duration (${formatSeconds(Math.floor(streamInfo.duration))})`;
                return { url, title: `Frame at ${options.timestamp}`, content: error, error };
            }
            const frame = await extractYouTubeFrame(ytInfo.videoId, spec.seconds, streamInfo);
            if ("error" in frame) {
                return { url, title: `Frame at ${options.timestamp}`, content: frame.error, error: frame.error };
            }
            return { url, title: `Frame at ${options.timestamp}`, content: `Video frame at ${options.timestamp}`, error: null, thumbnail: frame };
        }
        const localVideo = safeVideoInfo(url);
        if (localVideo.status === "invalid") {
            return { url, title: "", content: "", error: localVideo.error };
        }
        if (localVideo.status === "video") {
            if (spec.type === "range") {
                const timestamps = frameCount
                    ? computeRangeTimestamps(spec.start, spec.end, frameCount)
                    : computeRangeTimestamps(spec.start, spec.end);
                const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
                const label = `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`;
                return buildFrameResult(url, label, timestamps.length, result.frames, result.error);
            }
            if (frameCount) {
                const end = spec.seconds + (frameCount - 1) * MIN_FRAME_INTERVAL;
                const timestamps = computeRangeTimestamps(spec.seconds, end, frameCount);
                const result = await extractLocalFrames(localVideo.info.absolutePath, timestamps);
                const label = `${formatSeconds(spec.seconds)}-${formatSeconds(end)}`;
                return buildFrameResult(url, label, timestamps.length, result.frames, result.error);
            }
            const frame = await extractVideoFrame(localVideo.info.absolutePath, spec.seconds);
            if ("error" in frame) {
                return { url, title: `Frame at ${options.timestamp}`, content: frame.error, error: frame.error };
            }
            return { url, title: `Frame at ${options.timestamp}`, content: `Video frame at ${options.timestamp}`, error: null, thumbnail: frame };
        }
        return { url, title: "", content: "", error: "Timestamp extraction only works with YouTube and local video files" };
    }
    const localVideo = safeVideoInfo(url);
    if (localVideo.status === "invalid") {
        return { url, title: "", content: "", error: localVideo.error };
    }
    if (localVideo.status === "video") {
        try {
            const result = await extractVideo(localVideo.info, signal, options);
            if (signal?.aborted)
                return abortedResult(url);
            return result ?? { url, title: "", content: "", error: `Video analysis requires Gemini access. Either:\n  1. Sign into gemini.google.com in Chrome (free, uses cookies)\n  2. Set GEMINI_API_KEY in ${WEB_SEARCH_CONFIG_PATH}` };
        }
        catch (err) {
            if (isAbortError(err))
                return abortedResult(url);
            return { url, title: "", content: "", error: errorMessage(err) };
        }
    }
    try {
        if (!remoteUrl)
            new URL(url);
    }
    catch (err) {
        return { url, title: "", content: "", error: errorMessage(err) };
    }
    try {
        const ghIssuePrResult = await extractGitHubIssuePr(url, signal, options);
        if (ghIssuePrResult)
            return ghIssuePrResult;
        if (signal?.aborted)
            return abortedResult(url);
    }
    catch (err) {
        const message = errorMessage(err);
        if (isAbortError(err))
            return abortedResult(url);
        if (isConfigParseError(err)) {
            return { url, title: "", content: "", error: message };
        }
    }
    try {
        const ghResult = await extractGitHub(url, signal, options?.forceClone);
        if (ghResult)
            return ghResult;
        if (signal?.aborted)
            return abortedResult(url);
    }
    catch (err) {
        const message = errorMessage(err);
        if (isAbortError(err))
            return abortedResult(url);
        if (isConfigParseError(err)) {
            return { url, title: "", content: "", error: message };
        }
    }
    const ytInfo = isYouTubeURL(url);
    let youtubeEnabled = false;
    try {
        youtubeEnabled = isYouTubeEnabled();
    }
    catch (err) {
        return { url, title: "", content: "", error: errorMessage(err) };
    }
    if (ytInfo.isYouTube && youtubeEnabled) {
        try {
            const ytResult = await extractYouTube(url, signal, options?.prompt, options?.model);
            if (ytResult)
                return ytResult;
            if (signal?.aborted)
                return abortedResult(url);
        }
        catch (err) {
            const message = errorMessage(err);
            if (isAbortError(err))
                return abortedResult(url);
            return { url, title: "", content: "", error: message };
        }
        return {
            url,
            title: "",
            content: "",
            error: "Could not extract YouTube video content. Sign into Google in a supported Chromium browser for automatic access, or set GEMINI_API_KEY.",
        };
    }
    if (signal?.aborted)
        return abortedResult(url);
    let fetchTimeoutMs;
    try {
        fetchTimeoutMs = resolveFetchTimeoutMs(options);
    }
    catch (err) {
        return { url, title: "", content: "", error: errorMessage(err) };
    }
    let fetchRouting;
    try {
        fetchRouting = loadFetchRouting();
    }
    catch (err) {
        return { url, title: "", content: "", error: errorMessage(err) };
    }
    const providerOrder = remoteUrl && !fetchRouting.allowRemoteHostedProviders
        ? fetchRouting.providers.filter(provider => !REMOTE_HOSTED_FETCH_PROVIDERS.has(provider))
        : fetchRouting.providers;
    if (providerOrder.length === 0) {
        return {
            url,
            title: "",
            content: "",
            error: "Remote hosted fetch providers are disabled unless fetchRouting.allowRemoteHostedProviders is true",
        };
    }
    let httpResult = null;
    let declaredLinks = [];
    const withDeclaredLinks = (result) => ({
        ...result,
        content: appendDeclaredWebLinks(result.content, declaredLinks),
    });
    const parseErrorResult = (message) => httpResult
        ? { ...httpResult, error: message }
        : { url, title: "", content: "", error: message };
    const runHttpProvider = async () => {
        const { declaredLinks: discoveredLinks = [], ...result } = await extractViaHttp(url, fetchTimeoutMs, signal, options);
        httpResult = result;
        declaredLinks = discoveredLinks;
        if (signal?.aborted)
            return abortedResult(url);
        if (!httpResult.error)
            return httpResult;
        if (NON_RECOVERABLE_ERRORS.some(prefix => httpResult.error.startsWith(prefix)) || isRedirectPolicyError(httpResult.error) || isConfigParseError(httpResult.error)) {
            return httpResult;
        }
        return null;
    };
    let firecrawlError = null;
    let crawl4aiError = null;
    let tinyfishError = null;
    let search1apiError = null;
    let queritError = null;
    let kagiError = null;
    let ollamaError = null;
    let parallelError = null;
    let parallelMcpError = null;
    let brightdataError = null;
    if (remoteUrl && providerOrder[0] !== "http") {
        const httpGateResult = await runHttpProvider();
        if (httpGateResult)
            return httpGateResult;
    }
    for (const provider of providerOrder) {
        if (signal?.aborted)
            return abortedResult(url);
        if (provider === "http") {
            const result = await runHttpProvider();
            if (result)
                return result;
            continue;
        }
        if (provider === "firecrawl") {
            try {
                if (isFirecrawlAvailable()) {
                    const ssrf = loadSsrfConfig();
                    const firecrawlResult = await extractWithFirecrawl(url, signal, {
                        timeoutMs: options?.timeoutMs,
                        ...(options?.lookup ? { lookup: options.lookup } : {}),
                        ssrf,
                    });
                    if (firecrawlResult)
                        return withDeclaredLinks(firecrawlResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                firecrawlError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(firecrawlError);
            }
            continue;
        }
        if (provider === "crawl4ai") {
            try {
                if (isCrawl4aiAvailable()) {
                    const ssrf = loadSsrfConfig();
                    const crawl4aiResult = await extractWithCrawl4ai(url, signal, {
                        timeoutMs: options?.timeoutMs,
                        ...(options?.lookup ? { lookup: options.lookup } : {}),
                        ssrf,
                    });
                    if (crawl4aiResult)
                        return withDeclaredLinks(crawl4aiResult);
                }
            }
            catch (err) {
                if (signal?.aborted || isAbortException(err))
                    return abortedResult(url);
                crawl4aiError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(crawl4aiError);
            }
            continue;
        }
        if (provider === "jina") {
            const jinaResult = await extractWithJinaReader(url, fetchTimeoutMs, signal, options?.lookup);
            if (jinaResult)
                return withDeclaredLinks(jinaResult);
            continue;
        }
        if (provider === "tinyfish") {
            try {
                if (isTinyFishAvailable()) {
                    const tinyfishResult = await extractWithTinyFish(url, signal, options);
                    if (tinyfishResult)
                        return withDeclaredLinks(tinyfishResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                tinyfishError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(tinyfishError);
            }
            continue;
        }
        if (provider === "search1api") {
            try {
                if (isSearch1APIAvailable()) {
                    const search1apiResult = await extractWithSearch1API(url, signal, options);
                    if (search1apiResult)
                        return withDeclaredLinks(search1apiResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                search1apiError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(search1apiError);
            }
            continue;
        }
        if (provider === "querit") {
            try {
                if (isQueritAvailable()) {
                    const queritResult = await extractWithQuerit(url, signal, options);
                    if (queritResult)
                        return withDeclaredLinks(queritResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                queritError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(queritError);
            }
            continue;
        }
        if (provider === "kagi") {
            try {
                if (isKagiExtractAvailable()) {
                    const ssrf = loadSsrfConfig();
                    const kagiResult = await extractWithKagi(url, signal, {
                        timeoutMs: options?.timeoutMs,
                        ...(options?.lookup ? { lookup: options.lookup } : {}),
                        ssrf,
                    });
                    if (kagiResult)
                        return withDeclaredLinks(kagiResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                kagiError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(kagiError);
            }
            continue;
        }
        if (provider === "ollama") {
            try {
                if (isOllamaFetchAvailable()) {
                    const ssrf = loadSsrfConfig();
                    const ollamaResult = await extractWithOllama(url, signal, {
                        timeoutMs: options?.timeoutMs,
                        ...(options?.lookup ? { lookup: options.lookup } : {}),
                        ssrf,
                    });
                    if (ollamaResult)
                        return withDeclaredLinks(ollamaResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                ollamaError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(ollamaError);
            }
            continue;
        }
        if (provider === "parallel") {
            try {
                if (isParallelAvailable()) {
                    const parallelResult = await extractWithParallel(url, signal, options);
                    if (parallelResult)
                        return withDeclaredLinks(parallelResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                parallelError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(parallelError);
            }
            continue;
        }
        if (provider === "parallel-mcp") {
            try {
                const parallelMcpResult = await extractWithParallelMcp(url, signal, options);
                if (parallelMcpResult)
                    return withDeclaredLinks(parallelMcpResult);
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                parallelMcpError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(parallelMcpError);
            }
            continue;
        }
        if (provider === "brightdata") {
            try {
                if (isBrightDataUnlockerAvailable()) {
                    const ssrf = loadSsrfConfig();
                    const brightdataResult = await extractWithBrightDataUnlocker(url, signal, {
                        timeoutMs: options?.timeoutMs,
                        ...(options?.lookup ? { lookup: options.lookup } : {}),
                        ssrf,
                    });
                    if (brightdataResult)
                        return withDeclaredLinks(brightdataResult);
                }
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                brightdataError = errorMessage(err);
                if (isConfigParseError(err))
                    return parseErrorResult(brightdataError);
            }
            continue;
        }
        if (provider === "gemini") {
            let geminiResult = null;
            try {
                geminiResult = await extractWithUrlContext(url, signal)
                    ?? await extractWithGeminiWeb(url, signal);
            }
            catch (err) {
                if (isAbortError(err))
                    return abortedResult(url);
                if (err instanceof CredentialResolutionError || isConfigParseError(err)) {
                    return parseErrorResult(errorMessage(err));
                }
            }
            if (geminiResult)
                return withDeclaredLinks(geminiResult);
        }
    }
    if (signal?.aborted)
        return abortedResult(url);
    const finalHttpResult = httpResult;
    if (finalHttpResult && declaredLinks.length > 0)
        return { ...finalHttpResult, error: null };
    // A definitive 404/410 from the origin means no extraction provider can
    // retrieve the page, so the provider-configuration checklist below would
    // send users down the wrong path. Point at search instead.
    if (finalHttpResult?.status === 404 || finalHttpResult?.status === 410) {
        return { ...finalHttpResult, error: notFoundGuidance(finalHttpResult, options?.toolNames) };
    }
    const searchToolName = options?.toolNames?.webSearch;
    const jinaHint = jinaReaderGuidance(fetchRouting, providerOrder, Boolean(remoteUrl) && !fetchRouting.allowRemoteHostedProviders);
    const guidance = [
        finalHttpResult?.error ?? "No fetch_content provider returned content",
        ...(firecrawlError ? [`Firecrawl fallback failed: ${firecrawlError}`] : []),
        ...(crawl4aiError ? [`Crawl4AI fallback failed: ${crawl4aiError}`] : []),
        ...(tinyfishError ? [`TinyFish fallback failed: ${tinyfishError}`] : []),
        ...(search1apiError ? [`Search1API fallback failed: ${search1apiError}`] : []),
        ...(queritError ? [`Querit fallback failed: ${queritError}`] : []),
        ...(kagiError ? [`Kagi fallback failed: ${kagiError}`] : []),
        ...(ollamaError ? [`Ollama fallback failed: ${ollamaError}`] : []),
        ...(parallelError ? [`Parallel fallback failed: ${parallelError}`] : []),
        ...(parallelMcpError ? [`Parallel MCP fallback failed: ${parallelMcpError}`] : []),
        ...(brightdataError ? [`Bright Data fallback failed: ${brightdataError}`] : []),
        "",
        "Fallback options:",
        ...(jinaHint ? [jinaHint] : []),
        `  • Set firecrawlBaseUrl in ${WEB_SEARCH_CONFIG_PATH} to a self-hosted Firecrawl instance`,
        `  • Set crawl4aiBaseUrl in ${WEB_SEARCH_CONFIG_PATH} to a self-hosted Crawl4AI instance`,
        `  • Set tinyfishApiKey in ${WEB_SEARCH_CONFIG_PATH} or TINYFISH_API_KEY`,
        `  • Set search1apiApiKey in ${WEB_SEARCH_CONFIG_PATH} or SEARCH1API_KEY`,
        `  • Set queritApiKey in ${WEB_SEARCH_CONFIG_PATH} or QUERIT_API_KEY`,
        `  • Set kagiApiKey in ${WEB_SEARCH_CONFIG_PATH} or KAGI_API_KEY`,
        `  • Set ollamaApiKey in ${WEB_SEARCH_CONFIG_PATH} or OLLAMA_API_KEY`,
        `  • Set parallelApiKey in ${WEB_SEARCH_CONFIG_PATH} or PARALLEL_API_KEY`,
        `  • Set brightdataApiKey and brightdataUnlockerZone in ${WEB_SEARCH_CONFIG_PATH} or BRIGHTDATA_API_KEY and BRIGHTDATA_UNLOCKER_ZONE`,
        `  • Set GEMINI_API_KEY in ${WEB_SEARCH_CONFIG_PATH}`,
        "  • Sign into gemini.google.com in Chrome",
        ...(searchToolName ? [`  • Use ${searchToolName} to find content about this topic`] : []),
    ].join("\n");
    return { ...(finalHttpResult ?? { url, title: "", content: "", error: null }), error: guidance };
}
// Cloudflare interstitials served with HTTP 200. The header is authoritative for
// any text response; the body check is HTML-only and needs both challenge-platform
// markers so a generic "Just a moment..." page never matches.
function isCloudflareChallenge(response, text, isHTML) {
    if (response.status !== 200)
        return false;
    if (response.headers.get("cf-mitigated") === "challenge")
        return true;
    return isHTML &&
        /<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(text) &&
        text.includes("window._cf_chl_opt") &&
        text.includes("/cdn-cgi/challenge-platform/");
}
function isLikelyJSRendered(html) {
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch)
        return false;
    const bodyHtml = bodyMatch[1];
    const textContent = bodyHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const scriptCount = (html.match(/<script/gi) || []).length;
    return textContent.length < 500 && scriptCount > 3;
}
export async function readPDFResponseBuffer(response, maxSizeMB) {
    const maxBytes = maxSizeMB * 1024 * 1024;
    return readResponseBufferWithLimit(response, maxBytes, () => pdfSizeLimitError(maxSizeMB));
}
async function readTextResponseWithLimit(response, maxBytes) {
    const buffer = await readResponseBufferWithLimit(response, maxBytes, () => responseSizeLimitError(maxBytes));
    const charset = response.headers.get("content-type")?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
    try {
        return new TextDecoder(charset || "utf-8").decode(buffer);
    }
    catch {
        return new TextDecoder("utf-8").decode(buffer);
    }
}
function isTextContentType(contentType) {
    const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/ld+json" ||
        mimeType === "application/xml" ||
        mimeType === "application/xhtml+xml" ||
        mimeType === "application/javascript" ||
        mimeType === "application/x-javascript" ||
        mimeType.endsWith("+json") ||
        mimeType.endsWith("+xml");
}
async function readResponseBufferWithLimit(response, maxBytes, buildError) {
    const reader = response.body?.getReader();
    if (!reader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > maxBytes)
            throw buildError();
        return buffer;
    }
    const chunks = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw buildError();
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return combined.buffer;
}
function pdfSizeLimitError(maxSizeMB) {
    return new Error(`PDF exceeds configured pdf.maxSizeMB limit (${maxSizeMB} MB)`);
}
function responseSizeLimitError(maxBytes) {
    return new Error(`Response too large (${Math.round(maxBytes / 1024 / 1024)}MB)`);
}
async function extractViaHttp(url, timeoutMs, signal, options) {
    const activityId = activityMonitor.logStart({ type: "fetch", url });
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    try {
        const ssrf = loadSsrfConfig();
        const domainPolicy = loadFetchContentDomainPolicy();
        const authProfile = options?.authFetchProfile;
        const requestInit = {
            signal: controller.signal,
            __proxy: options?.proxy,
            headers: {
                "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            },
        };
        const response = authProfile
            ? await fetchAuthenticatedRemoteUrl(url, requestInit, { ssrf, domainPolicy, proxy: options?.proxy, ...(options?.lookup ? { lookup: options.lookup } : {}) }, authProfile)
            : await fetchRemoteUrl(url, requestInit, {
                allowRanges: ssrf.allowRanges,
                trustEnvProxy: ssrf.trustEnvProxy,
                domainPolicy,
                proxy: options?.proxy,
                ...(options?.lookup ? { lookup: options.lookup } : {}),
            });
        if (!response.ok && options?.mode !== "raw") {
            activityMonitor.logComplete(activityId, response.status);
            return {
                url,
                title: "",
                content: "",
                error: `HTTP ${response.status}: ${response.statusText}`,
                status: response.status,
            };
        }
        const contentLengthHeader = response.headers.get("content-length");
        const contentType = response.headers.get("content-type") || "";
        const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        const isPDFContent = isPDF(url, contentType);
        const pdfConfig = isPDFContent ? loadPDFConfig() : null;
        if (isPDFContent && pdfConfig && !pdfConfig.enabled) {
            activityMonitor.logComplete(activityId, response.status);
            return { url, title: "", content: "", error: "PDF extraction is disabled by pdf.enabled", mimeType, status: response.status };
        }
        const maxResponseSize = (pdfConfig?.maxSizeMB ?? 5) * 1024 * 1024;
        if (contentLengthHeader) {
            const contentLength = Number.parseInt(contentLengthHeader, 10);
            if (Number.isFinite(contentLength) && contentLength > maxResponseSize) {
                activityMonitor.logComplete(activityId, response.status);
                return {
                    url,
                    title: "",
                    content: "",
                    error: pdfConfig
                        ? pdfSizeLimitError(pdfConfig.maxSizeMB).message
                        : `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`,
                };
            }
        }
        if (options?.mode === "raw") {
            if (!isTextContentType(contentType)) {
                activityMonitor.logComplete(activityId, response.status);
                return { url, title: "", content: "", error: `Unsupported content type in raw mode: ${mimeType || "missing"}`, mimeType, status: response.status };
            }
            const text = await readTextResponseWithLimit(response, maxResponseSize);
            activityMonitor.logComplete(activityId, response.status);
            return { url, title: extractTextTitle(text, url), content: text, error: null, mimeType, status: response.status };
        }
        if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
            const disabled = imageGateError();
            if (disabled) {
                activityMonitor.logComplete(activityId, response.status);
                return { url, title: "", content: "", error: disabled, mimeType, status: response.status };
            }
            try {
                const buffer = await readResponseBufferWithLimit(response, maxResponseSize, () => responseSizeLimitError(maxResponseSize));
                const { resizeImage } = await import("@earendil-works/pi-coding-agent");
                const resized = await resizeImage(new Uint8Array(buffer), mimeType, { maxWidth: 2000, maxHeight: 2000 });
                activityMonitor.logComplete(activityId, response.status);
                if (!resized)
                    return { url, title: "", content: "", error: `Could not decode image: ${mimeType}`, mimeType, status: response.status };
                const title = new URL(response.url || url).pathname.split("/").pop() || url;
                return {
                    url,
                    title,
                    content: `Image fetched (${resized.width}×${resized.height}, ${resized.mimeType})`,
                    error: null,
                    thumbnail: { data: resized.data, mimeType: resized.mimeType },
                    mimeType: resized.mimeType,
                    status: response.status,
                };
            }
            catch (err) {
                const message = errorMessage(err);
                activityMonitor.logError(activityId, message);
                return { url, title: "", content: "", error: message, mimeType, status: response.status };
            }
        }
        if (isPDFContent && pdfConfig) {
            try {
                const buffer = await readPDFResponseBuffer(response, pdfConfig.maxSizeMB);
                if (signal?.aborted)
                    return abortedResult(url);
                const result = await extractPDFToMarkdown(buffer, url, { signal });
                activityMonitor.logComplete(activityId, response.status);
                return {
                    url,
                    title: result.title,
                    content: options?.mode === "answer"
                        ? result.content
                        : `PDF extracted and saved to: ${result.outputPath}\n\nPages: ${result.pages}\nCharacters: ${result.chars}`,
                    error: null,
                };
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                activityMonitor.logError(activityId, message);
                if (message.startsWith("PDF exceeds configured pdf.maxSizeMB limit")) {
                    return { url, title: "", content: "", error: message };
                }
                if (err instanceof CredentialResolutionError || isConfigParseError(err)) {
                    return { url, title: "", content: "", error: message };
                }
                return { url, title: "", content: "", error: `PDF extraction failed: ${message}` };
            }
        }
        if (contentType.includes("application/octet-stream") ||
            contentType.includes("image/") ||
            contentType.includes("audio/") ||
            contentType.includes("video/") ||
            contentType.includes("application/zip")) {
            activityMonitor.logComplete(activityId, response.status);
            return {
                url,
                title: "",
                content: "",
                error: `Unsupported content type: ${contentType.split(";")[0]}`,
            };
        }
        const text = await readTextResponseWithLimit(response, maxResponseSize);
        const isHTML = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
        if (isCloudflareChallenge(response, text, isHTML)) {
            activityMonitor.logComplete(activityId, response.status);
            return { url, title: "", content: "", error: `HTTP ${response.status}: Blocked by Cloudflare challenge page`, status: response.status };
        }
        if (!isHTML) {
            activityMonitor.logComplete(activityId, response.status);
            const title = extractTextTitle(text, url);
            return { url, title, content: text, error: null };
        }
        const { parseHTML } = await import("linkedom");
        const { document } = parseHTML(text);
        const documentTitle = document.title?.trim() ?? "";
        const declaredLinks = discoverDeclaredWebLinks(document, response.headers.get("link"), response.url || url);
        const { Readability } = await import("@mozilla/readability");
        const reader = new Readability(document);
        const article = reader.parse();
        if (!article) {
            const rscResult = extractRSCContent(text);
            if (rscResult && rscResult.content.length >= MIN_USEFUL_CONTENT) {
                activityMonitor.logComplete(activityId, response.status);
                return {
                    url,
                    title: rscResult.title,
                    content: appendDeclaredWebLinks(rscResult.content, declaredLinks),
                    error: null,
                    declaredLinks,
                };
            }
            controller.signal.throwIfAborted();
            const defuddleResult = await extractWithDefuddle(text, response.url || url);
            controller.signal.throwIfAborted();
            if (defuddleResult && defuddleResult.content.length >= MIN_USEFUL_CONTENT) {
                activityMonitor.logComplete(activityId, response.status);
                return {
                    url,
                    title: documentTitle || defuddleResult.title,
                    content: appendDeclaredWebLinks(defuddleResult.content, declaredLinks),
                    error: null,
                    declaredLinks,
                };
            }
            activityMonitor.logComplete(activityId, response.status);
            const jsRendered = isLikelyJSRendered(text);
            const errorMsg = jsRendered
                ? "Page appears to be JavaScript-rendered (content loads dynamically)"
                : "Could not extract readable content from HTML structure";
            return {
                url,
                title: documentTitle,
                content: appendDeclaredWebLinks("", declaredLinks),
                error: errorMsg,
                declaredLinks,
            };
        }
        if (typeof article.content !== "string") {
            throw new Error("Readability returned invalid article content");
        }
        const markdown = (await getTurndown()).turndown(article.content);
        activityMonitor.logComplete(activityId, response.status);
        if (markdown.length < MIN_USEFUL_CONTENT) {
            const rscResult = extractRSCContent(text);
            if (rscResult && rscResult.content.length >= MIN_USEFUL_CONTENT) {
                return {
                    url,
                    title: rscResult.title,
                    content: appendDeclaredWebLinks(rscResult.content, declaredLinks),
                    error: null,
                    declaredLinks,
                };
            }
            controller.signal.throwIfAborted();
            const defuddleResult = await extractWithDefuddle(text, response.url || url);
            controller.signal.throwIfAborted();
            if (defuddleResult && defuddleResult.content.length >= MIN_USEFUL_CONTENT) {
                return {
                    url,
                    title: article.title || documentTitle || defuddleResult.title,
                    content: appendDeclaredWebLinks(defuddleResult.content, declaredLinks),
                    error: null,
                    declaredLinks,
                };
            }
            return {
                url,
                title: article.title || documentTitle,
                content: appendDeclaredWebLinks(markdown, declaredLinks),
                error: isLikelyJSRendered(text)
                    ? "Page appears to be JavaScript-rendered (content loads dynamically)"
                    : "Extracted content appears incomplete",
                declaredLinks,
            };
        }
        return {
            url,
            title: article.title || documentTitle,
            content: appendDeclaredWebLinks(markdown, declaredLinks),
            error: null,
            declaredLinks,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("abort")) {
            activityMonitor.logComplete(activityId, 0);
        }
        else {
            activityMonitor.logError(activityId, message);
        }
        return { url, title: "", content: "", error: message };
    }
    finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        // Imports and CPU-bound processing need not observe the fetch signal, and
        // can finish before an expired timer gets a turn. Guard every exit, with
        // caller cancellation taking precedence over the internal deadline.
        if (signal?.aborted)
            return abortedResult(url);
        if (controller.signal.aborted || Date.now() - startedAt >= timeoutMs) {
            return { url, title: "", content: "", error: "The operation was aborted." };
        }
    }
}
export function extractHeadingTitle(text) {
    const match = text.match(/^#{1,2}\s+(.+)/m);
    if (!match)
        return null;
    const cleaned = match[1].replace(/\*+/g, "").trim();
    return cleaned || null;
}
function extractTextTitle(text, url) {
    return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}
export async function fetchAllContent(urls, signal, options) {
    const results = await Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
    if (options?.mode === "raw")
        return results;
    // Inline data: URIs in extracted markdown would otherwise flow into tool
    // results and the fetch cache as opaque base64; typed thumbnail/frame image
    // blocks are deliberate outputs and are left untouched.
    return results.map((result, index) => {
        if (!result.content)
            return result;
        const sanitized = sanitizeInlineDataUris(result.content, `urls[${index}].content`);
        return sanitized.omissions.length > 0 ? { ...result, content: sanitized.text } : result;
    });
}
