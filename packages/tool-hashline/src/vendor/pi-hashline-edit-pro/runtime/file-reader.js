import { constants } from "node:fs";
import { stat } from "node:fs/promises";
import { lineHashes } from "./hashline/index.js";
import { loadFileKindAndText } from "./file-kind.js";
import { resolveTarget } from "./fs-write.js";
import { toCwd, toDisplayPath } from "./paths.js";
import { detectEnding, toLF, stripBOM } from "./normalize.js";
import { splitSeparators } from "./line-endings.js";
import { abortIf, errCode, assertLineLimit } from "./utils.js";
import { ANCHOR_POOL_EXHAUSTED_PREFIX } from "./constants.js";
import { valKind, valAccess } from "./validation.js";
function fmtSnapId(canonicalPath, info) {
    return `v2|${canonicalPath}|${info.ino}|${info.mtimeMs}|${info.ctimeMs}|${info.size}`;
}
export async function fileSnap(absolutePath) {
    const canonicalPath = await resolveTarget(absolutePath);
    const stats = await stat(canonicalPath);
    return {
        snapshotId: fmtSnapId(canonicalPath, stats),
        ino: stats.ino,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        size: stats.size,
    };
}
export async function safeSnapId(absolutePath, context) {
    try {
        return (await fileSnap(absolutePath)).snapshotId;
    }
    catch (error) {
        console.error(`[safeSnapId] ${context}: failed to stat "${absolutePath}" (code=${errCode(error) ?? "?"}):`, error);
        return undefined;
    }
}
export async function readNormFile(path, cwd, options) {
    const absolutePath = toCwd(path, cwd);
    const resolvedPath = await resolveTarget(absolutePath);
    const signal = options?.signal;
    const accessMode = options?.accessMode ?? constants.R_OK;
    abortIf(signal);
    await valAccess(resolvedPath, path, accessMode);
    abortIf(signal);
    const preloadedNorm = options?.preloadedNorm;
    if (preloadedNorm)
        return preloadedNorm;
    const file = options?.preloadedFile ?? (await loadFileKindAndText(resolvedPath, { maxLines: options?.maxLines, displayPath: path }));
    valKind(file, path);
    abortIf(signal);
    const { bom, text: rawContent } = stripBOM(file.text);
    const originalEnding = detectEnding(rawContent);
    const endingSeparators = splitSeparators(rawContent);
    const normalized = toLF(rawContent);
    if (options?.maxLines !== undefined)
        assertLineLimit(normalized, path, options.maxLines);
    const fileHashes = await lineHashes(normalized, resolvedPath, undefined, options?.store, options?.noPersist !== true, options?.allocation === "shadow");
    let identity = file.identity;
    if (!identity) {
        const { dev, ino } = await stat(resolvedPath);
        identity = { dev, ino };
    }
    return {
        absolutePath: resolvedPath,
        normalized,
        bom,
        originalEnding,
        endingSeparators,
        fileHashes,
        identity,
        hadUtf8DecodeErrors: file.hadUtf8DecodeErrors === true,
    };
}
export async function tryReadNormFile(absPath, cwd, options) {
    try {
        const displayPath = toDisplayPath(cwd, absPath);
        const file = await loadFileKindAndText(absPath, { maxLines: options?.maxLines, displayPath });
        if (file.kind !== "text")
            return undefined;
        return await readNormFile(absPath, cwd, { ...options, preloadedFile: file });
    }
    catch (error) {
        const code = errCode(error);
        if (code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "ELOOP")
            return undefined;
        if (error instanceof Error) {
            const msg = error.message;
            if (msg.startsWith(ANCHOR_POOL_EXHAUSTED_PREFIX))
                throw error;
            if (msg.startsWith("[E_FILE_TOO_LARGE]") || msg.startsWith("[E_NOT_FOUND]") || msg.startsWith("[E_ACCESS]") || msg.startsWith("[E_NOT_TEXT]"))
                return undefined;
        }
        throw error;
    }
}
