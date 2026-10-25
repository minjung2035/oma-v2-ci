import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { getLastGoogleCookieDiagnostic, getLastGoogleCookieDiagnosticDetails, getGoogleCookies } from "./chrome-cookies.js";
import { getBrowserCookieSelectionFromConfig, isBrowserCookieAccessAllowed, normalizeChromeProfile } from "./gemini-web-config.js";
const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const GOOGLE_LIST_ACCOUNTS_URL = "https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&laf=b64bin&json=standard";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
export const DEFAULT_GEMINI_WEB_MODEL = "gemini-3.1-pro";
const MODEL_HEADERS = {
    [DEFAULT_GEMINI_WEB_MODEL]: '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
    "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
    "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};
const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];
// Gemini Web talks to Google's frontend inside the host agent (pi), whose
// global undici dispatcher runs HTTP/1.1 with undici's default 16 KiB
// maxHeaderSize. Google's gemini.google.com /app response headers routinely
// exceed that budget over HTTP/1.1, so cookie-bearing requests fail with
// UND_ERR_HEADERS_OVERFLOW surfaced as "fetch failed". Route these requests
// through a dedicated undici Agent with a larger header budget instead; fall
// back to the ambient global fetch when undici is not resolvable (e.g.
// standalone test environments).
let geminiFetchImpl = null;
// Test-only hook: lets tests inject a simulated transport instead of patching
// globalThis.fetch. Gemini Web deliberately bypasses the ambient global fetch
// (inside the pi host agent it is constrained to undici's 16 KiB
// maxHeaderSize and cannot serve Google's /app page over HTTP/1.1), so
// globalThis.fetch patching is no longer a reliable way to intercept these
// requests.
export function setGeminiFetchOverrideForTests(fetchImpl) {
    geminiFetchOverride = fetchImpl;
}
let geminiFetchOverride = null;
// The header budget Gemini Web needs for Google frontend responses.
// Google's /app page exceeds undici's default 16 KiB maxHeaderSize when
// served over HTTP/1.1, which is how pi's global dispatcher operates.
export const GEMINI_MAX_HEADER_SIZE = 4 * 1024 * 1024;
// Build a fetch that routes through a dedicated undici Agent with a larger
// header budget than the host agent's global dispatcher allows. Exported for
// tests so the agent configuration can be asserted without network access.
export function createGeminiFetch(undiciImpl) {
    const agent = new undiciImpl.EnvHttpProxyAgent({
        allowH2: false,
        connectTimeout: 30_000,
        maxHeaderSize: GEMINI_MAX_HEADER_SIZE,
        pipelining: 1,
    });
    return (input, init) => undiciImpl.fetch(input, { ...init, dispatcher: agent });
}
export async function resolveGeminiFetch() {
    if (geminiFetchOverride)
        return geminiFetchOverride;
    if (geminiFetchImpl)
        return geminiFetchImpl;
    let undici;
    try {
        undici = await import("undici");
    }
    catch {
        geminiFetchImpl = fetch;
        return geminiFetchImpl;
    }
    geminiFetchImpl = createGeminiFetch(undici);
    return geminiFetchImpl;
}
export async function isGeminiWebAvailable(chromeProfile) {
    if (!isBrowserCookieAccessAllowed())
        return null;
    const configured = getBrowserCookieSelectionFromConfig();
    const result = await getGoogleCookies({
        browser: configured.browser,
        profile: normalizeChromeProfile(chromeProfile) ?? configured.profile,
        requiredCookies: REQUIRED_COOKIES,
    });
    if (!result)
        return null;
    return result.cookies;
}
export function getGeminiWebAvailabilityDiagnostic() {
    return isBrowserCookieAccessAllowed() ? getLastGoogleCookieDiagnostic() : null;
}
export function getGeminiWebAvailabilityDiagnosticDetails() {
    return isBrowserCookieAccessAllowed() ? getLastGoogleCookieDiagnosticDetails() : null;
}
export async function getActiveGoogleEmail(cookies) {
    const cookieHeader = buildCookieHeader(cookies);
    if (!cookieHeader)
        return null;
    try {
        const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, AbortSignal.timeout(10000));
        const email = extractEmailFromGeminiHtml(html);
        if (email)
            return email;
    }
    catch {
    }
    try {
        const response = await fetchWithCookieRedirects(GOOGLE_LIST_ACCOUNTS_URL, cookieHeader, 10, AbortSignal.timeout(10000));
        return extractEmailFromListAccounts(response);
    }
    catch {
        return null;
    }
}
export async function queryWithCookies(prompt, cookieMap, options = {}) {
    const model = options.model ?? DEFAULT_GEMINI_WEB_MODEL;
    if (!MODEL_HEADERS[model]) {
        throw new Error(`Gemini Web does not support model ${model}; configure Gemini API or choose a supported Gemini Web model.`);
    }
    const timeoutMs = options.timeoutMs ?? 120000;
    let fullPrompt = prompt;
    if (options.youtubeUrl) {
        fullPrompt = `${fullPrompt}\n\nYouTube video: ${options.youtubeUrl}`;
    }
    const result = await runGeminiWebOnce(fullPrompt, cookieMap, model, options.files, timeoutMs, options.signal);
    if (result.errorMessage)
        throw new Error(result.errorMessage);
    if (!result.text)
        throw new Error("Gemini Web returned empty response");
    return result.text;
}
async function runGeminiWebOnce(prompt, cookieMap, model, files, timeoutMs, signal) {
    const effectiveSignal = withTimeout(signal, timeoutMs);
    const cookieHeader = buildCookieHeader(cookieMap);
    const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);
    const uploaded = [];
    if (files) {
        for (const filePath of files) {
            uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
        }
    }
    const fReq = buildFReqPayload(prompt, uploaded);
    const params = new URLSearchParams();
    params.set("at", accessToken);
    params.set("f.req", fReq);
    const res = await (await resolveGeminiFetch())(GEMINI_STREAM_GENERATE_URL, {
        method: "POST",
        redirect: "error",
        headers: {
            "content-type": "application/x-www-form-urlencoded;charset=utf-8",
            host: "gemini.google.com",
            origin: "https://gemini.google.com",
            referer: "https://gemini.google.com/",
            "x-same-domain": "1",
            "user-agent": USER_AGENT,
            cookie: cookieHeader,
            [MODEL_HEADER_NAME]: MODEL_HEADERS[model],
        },
        body: params.toString(),
        signal: effectiveSignal,
    });
    const rawText = await res.text();
    if (!res.ok) {
        return { text: "", errorMessage: `Gemini request failed: ${res.status}` };
    }
    try {
        return parseStreamGenerateResponse(rawText);
    }
    catch (err) {
        let errorCode;
        try {
            const json = JSON.parse(trimJsonEnvelope(rawText));
            errorCode = extractErrorCode(json);
        }
        catch {
        }
        return {
            text: "",
            errorCode,
            errorMessage: err instanceof Error ? err.message : String(err),
        };
    }
}
async function fetchAccessToken(cookieHeader, signal) {
    const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);
    for (const key of ["SNlM0e", "thykhd"]) {
        const match = html.match(new RegExp(`"${key}":"(.*?)"`));
        if (match?.[1])
            return match[1];
    }
    throw new Error("Unable to authenticate with Gemini. Make sure you're signed into gemini.google.com in a supported Chromium-based browser.");
}
async function fetchWithCookieRedirects(url, cookieHeader, maxRedirects, signal) {
    let current = url;
    const allowedOrigin = new URL(url).origin;
    for (let i = 0; i <= maxRedirects; i++) {
        const res = await (await resolveGeminiFetch())(current, {
            headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
            redirect: "manual",
            signal,
        });
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location");
            if (location) {
                const next = new URL(location, current);
                if (next.origin !== allowedOrigin) {
                    throw new Error(`Refusing to send Google cookies across origins: ${allowedOrigin} -> ${next.origin}`);
                }
                current = next.toString();
                continue;
            }
        }
        return await res.text();
    }
    throw new Error(`Too many redirects (>${maxRedirects})`);
}
function extractEmailFromGeminiHtml(html) {
    const patterns = [
        // Gemini bootstraps the active account in oPEP7c. Prefer it over generic
        // feature/config entries that may contain other signed-in Google accounts.
        /"oPEP7c"\s*:\s*"([^"]+)"/,
        // The Google account menu aria-label is rendered for the active account.
        /aria-label="Google Account:[^"]*?\(([^)]+)\)"/,
        /"displayEmail"\s*:\s*"([^"]+)"/,
        /"defaultEmail"\s*:\s*"([^"]+)"/,
        /"email"\s*:\s*"([^"]+)"/,
        /"identifier"\s*:\s*"([^"]+)"/,
        /"gaiaIdentifier"\s*:\s*"([^"]+)"/,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        const email = normalizeEmail(match?.[1]);
        if (email)
            return email;
    }
    return findFirstEmail(html);
}
function extractEmailFromListAccounts(text) {
    const trimmed = text.replace(/^\)\]\}'\s*/, "");
    try {
        return findEmailInValue(JSON.parse(trimmed)) ?? findFirstEmail(trimmed);
    }
    catch {
        return findFirstEmail(trimmed);
    }
}
function findEmailInValue(value) {
    if (typeof value === "string")
        return normalizeEmail(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const email = findEmailInValue(item);
            if (email)
                return email;
        }
        return null;
    }
    if (value && typeof value === "object") {
        for (const item of Object.values(value)) {
            const email = findEmailInValue(item);
            if (email)
                return email;
        }
    }
    return null;
}
function findFirstEmail(text) {
    const normalized = decodeEmailEscapes(text);
    const match = normalized.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
    return match?.[0] ?? null;
}
function normalizeEmail(value) {
    if (!value)
        return null;
    const normalized = decodeEmailEscapes(value.trim());
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(normalized) ? normalized : null;
}
function decodeEmailEscapes(value) {
    return value
        .replace(/\\u0040/gi, "@")
        .replace(/\\x40/gi, "@")
        .replace(/&#64;/gi, "@")
        .replace(/&commat;/gi, "@")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
}
async function uploadFile(filePath, cookieHeader, signal) {
    const data = readFileSync(filePath);
    const fileName = basename(filePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([
        Buffer.from(header, "utf-8"),
        data,
        Buffer.from(footer, "utf-8"),
    ]);
    const res = await (await resolveGeminiFetch())(GEMINI_UPLOAD_URL, {
        method: "POST",
        redirect: "error",
        headers: {
            "content-type": `multipart/form-data; boundary=${boundary}`,
            "push-id": GEMINI_UPLOAD_PUSH_ID,
            "user-agent": USER_AGENT,
            cookie: cookieHeader,
        },
        body,
        signal,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`File upload failed: ${res.status} (${text.slice(0, 200)})`);
    }
    return { id: await res.text(), name: fileName };
}
function buildFReqPayload(prompt, uploaded) {
    const promptPayload = uploaded.length > 0
        ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])]
        : [prompt];
    const innerList = [promptPayload, null, null];
    return JSON.stringify([null, JSON.stringify(innerList)]);
}
function withTimeout(signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function buildCookieHeader(cookieMap) {
    return Object.entries(cookieMap)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}
function getNestedValue(value, pathParts) {
    let current = value;
    for (const part of pathParts) {
        if (current == null)
            return undefined;
        if (!Array.isArray(current))
            return undefined;
        current = current[part];
    }
    return current;
}
function trimJsonEnvelope(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("Gemini response did not contain a JSON payload.");
    }
    return text.slice(start, end + 1);
}
function extractErrorCode(responseJson) {
    const code = getNestedValue(responseJson, [0, 5, 2, 0, 1, 0]);
    return typeof code === "number" && code >= 0 ? code : undefined;
}
function extractCandidateText(candidate) {
    const textRaw = getNestedValue(candidate, [1, 0]);
    let text = typeof textRaw === "string" ? textRaw : "";
    if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
        const alt = getNestedValue(candidate, [22, 0]);
        if (typeof alt === "string" && alt.length > 0)
            text = alt;
    }
    return text;
}
function parseStreamGenerateResponse(rawText) {
    const responseJson = JSON.parse(trimJsonEnvelope(rawText));
    const errorCode = extractErrorCode(responseJson);
    const parts = Array.isArray(responseJson) ? responseJson : [];
    let firstCandidateSeen = undefined;
    let latestNonEmptyText = "";
    for (let i = 0; i < parts.length; i++) {
        const partBody = getNestedValue(parts[i], [2]);
        if (!partBody || typeof partBody !== "string")
            continue;
        try {
            const parsed = JSON.parse(partBody);
            const candidateList = getNestedValue(parsed, [4]);
            if (!Array.isArray(candidateList) || candidateList.length === 0)
                continue;
            const firstCandidate = candidateList[0];
            if (firstCandidateSeen === undefined)
                firstCandidateSeen = firstCandidate;
            const text = extractCandidateText(firstCandidate);
            if (text.length > 0)
                latestNonEmptyText = text;
        }
        catch {
        }
    }
    const text = latestNonEmptyText.length > 0
        ? latestNonEmptyText
        : extractCandidateText(firstCandidateSeen);
    return { text, errorCode };
}
