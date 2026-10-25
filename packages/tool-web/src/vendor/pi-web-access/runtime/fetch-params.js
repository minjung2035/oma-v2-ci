import { normalizeProxyUrl } from "./utils.js";
export function normalizeFetchContentParams(params) {
    const normalizedUrls = uniqueUrls(normalizeUrlArray(params.urls));
    const urlList = normalizedUrls.length > 0 ? normalizedUrls : normalizeSingleUrl(params.url);
    const prompt = normalizeOptionalString(params.prompt);
    const timestamp = normalizeOptionalString(params.timestamp);
    const frames = normalizeOptionalFrameCount(params.frames);
    const shouldIncludeFrames = frames !== undefined && (timestamp !== undefined || frames > 1);
    const forceClone = typeof params.forceClone === "boolean" ? params.forceClone : undefined;
    const model = normalizeOptionalString(params.model);
    const mode = normalizeMode(params.mode);
    const answerModel = normalizeOptionalString(params.answerModel);
    const auth = normalizeAuth(params.auth);
    const proxy = normalizeProxy(params.proxy);
    return {
        urlList,
        options: {
            ...(forceClone !== undefined ? { forceClone } : {}),
            ...(prompt !== undefined ? { prompt } : {}),
            ...(timestamp !== undefined ? { timestamp } : {}),
            ...(shouldIncludeFrames ? { frames } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(mode !== undefined ? { mode } : {}),
            ...(answerModel !== undefined ? { answerModel } : {}),
            ...(auth !== undefined ? { auth } : {}),
            ...(proxy !== undefined ? { proxy } : {}),
        },
    };
}
function normalizeUrlArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap(normalizeSingleUrl);
}
function normalizeSingleUrl(value) {
    if (typeof value !== "string")
        return [];
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
}
function normalizeOptionalString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}
function normalizeMode(value) {
    if (value === undefined)
        return undefined;
    if (value === "readable" || value === "raw" || value === "answer")
        return value;
    throw new Error('mode must be "readable", "raw", or "answer"');
}
function normalizeAuth(value) {
    if (value === undefined || value === false)
        return undefined;
    if (value === true)
        return true;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed)
            return trimmed;
    }
    throw new Error("auth must be a profile name, true, or false");
}
function normalizeProxy(value) {
    if (value === undefined || value === false)
        return undefined;
    if (value === null)
        throw new Error("proxy must be an http(s) or socks proxy URL string");
    const normalized = normalizeProxyUrl(value, "proxy");
    return normalized ?? "";
}
function normalizeOptionalFrameCount(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 12)
        return undefined;
    return value;
}
function uniqueUrls(urls) {
    return [...new Set(urls)];
}
