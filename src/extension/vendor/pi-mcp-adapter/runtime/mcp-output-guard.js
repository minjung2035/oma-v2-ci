import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, } from "@earendil-works/pi-coding-agent";
import { omaAmbientEnv, omaTmpdir } from "./utils.js";
export const DEFAULT_MCP_OUTPUT_MAX_BYTES = DEFAULT_MAX_BYTES;
export const DEFAULT_MCP_OUTPUT_MAX_LINES = DEFAULT_MAX_LINES;
export const DEFAULT_MCP_DETAILS_MAX_BYTES = 16 * 1024;
const SCRIPT_PIPE_HINT_MIN_BYTES = 8 * 1024;
const CONTENT_SUMMARY_LIMIT = 20;
const KEY_PREVIEW_LIMIT = 20;
const KEY_MAX_BYTES = 120;
const STRUCTURED_CONTENT_PRESERVE_MAX_BYTES = 4 * 1024;
const STRUCTURED_CONTENT_FIELD_PRESERVE_MAX_BYTES = 512;
export function resolveMcpOutputGuardOptions(settings) {
    const configured = settings?.outputGuard;
    const tuning = typeof configured === "object" && configured !== null ? configured : undefined;
    return {
        enabled: envKillSwitch("MCP_OUTPUT_GUARD") ?? configured !== false,
        maxBytes: positiveInt(tuning?.maxBytes) ?? DEFAULT_MCP_OUTPUT_MAX_BYTES,
        maxLines: positiveInt(tuning?.maxLines) ?? DEFAULT_MCP_OUTPUT_MAX_LINES,
        detailsMaxBytes: positiveInt(tuning?.detailsMaxBytes) ?? DEFAULT_MCP_DETAILS_MAX_BYTES,
    };
}
/**
 * Models retype large results into the next call's arguments unless told otherwise at the moment
 * they see the result; the same wording in tool descriptions did not change that.
 */
export function scriptPipeHint(scriptTool, content) {
    if (scriptTool !== true)
        return {};
    const bytes = content.reduce((total, block) => total + (block.type === "text" ? byteLength(block.text) : 0), 0);
    return bytes >= SCRIPT_PIPE_HINT_MIN_BYTES
        ? { footer: "\n\n[Use mcpScript to pass this result to another MCP call without copying it through the conversation.]" }
        : {};
}
/** Spread helper for tool-result details: includes mcpResult/outputGuard only when present. */
export function guardedMcpDetails(guarded) {
    return {
        ...(guarded.mcpResult !== undefined ? { mcpResult: guarded.mcpResult } : {}),
        ...(guarded.outputGuard ? { outputGuard: guarded.outputGuard } : {}),
    };
}
/**
 * Bound model-facing MCP output. Text output is capped at maxBytes/maxLines and
 * spilled to a temp file when oversized. Image blocks pass through untouched —
 * they are delivered to the provider as native image content, not text context.
 */
export async function guardMcpOutput(content, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MCP_OUTPUT_MAX_BYTES;
    const maxLines = options.maxLines ?? DEFAULT_MCP_OUTPUT_MAX_LINES;
    const detailsMaxBytes = options.detailsMaxBytes ?? DEFAULT_MCP_DETAILS_MAX_BYTES;
    const prefix = options.prefix ?? "";
    const suffix = options.suffix ?? "";
    const footer = options.footer ?? "";
    const normalizedContent = withEmptyTextFallback(content.length > 0
        ? sanitizeContent(content)
        : [{ type: "text", text: options.emptyTextFallback ?? "(empty result)" }], options.emptyTextFallback);
    if (options.enabled === false) {
        return {
            content: addAffixes(normalizedContent, prefix, `${suffix}${footer}`),
            ...(options.rawMcpResult !== undefined ? { mcpResult: options.rawMcpResult } : {}),
        };
    }
    const imageBlocks = normalizedContent.filter((block) => block.type === "image");
    const textOutput = normalizedContent
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    const composedOutput = `${prefix}${textOutput}${suffix}`;
    const truncation = truncateHead(`${composedOutput}${footer}`, { maxBytes, maxLines });
    let guardedContent = addAffixes(normalizedContent, prefix, `${suffix}${footer}`);
    let outputGuard;
    if (truncation.truncated) {
        const { path: fullOutputPath, error: writeError } = await saveArtifact("output", composedOutput);
        const initialNotice = formatTruncationNotice(truncation, fullOutputPath, writeError);
        // Footers are optional guidance: drop one that would not fit beside the notice rather than exceed the limits.
        const noticeWithFooter = textStats(`\n\n${initialNotice}${footer}`);
        const keptFooter = noticeWithFooter.bytes < maxBytes && noticeWithFooter.lines < maxLines ? footer : "";
        const previewBudget = reserveBudget(maxBytes, maxLines, `${initialNotice}${keptFooter}`);
        const preview = truncateHead(composedOutput, {
            maxBytes: previewBudget.maxBytes,
            maxLines: previewBudget.maxLines,
        });
        const notice = formatTruncationNotice({ ...truncation, outputLines: preview.outputLines, outputBytes: preview.outputBytes }, fullOutputPath, writeError);
        const finalText = `${preview.content}\n\n${notice}${keptFooter}`;
        const finalStats = textStats(finalText);
        guardedContent = [{ type: "text", text: finalText }, ...imageBlocks];
        outputGuard = {
            truncated: true,
            originalBytes: truncation.totalBytes,
            returnedBytes: finalStats.bytes,
            originalLines: truncation.totalLines,
            returnedLines: finalStats.lines,
            truncatedBy: truncation.truncatedBy,
            totalLines: truncation.totalLines,
            totalBytes: truncation.totalBytes,
            outputLines: preview.outputLines,
            outputBytes: preview.outputBytes,
            lastLinePartial: truncation.lastLinePartial,
            firstLineExceedsLimit: truncation.firstLineExceedsLimit,
            maxLines: truncation.maxLines,
            maxBytes: truncation.maxBytes,
            ...(imageBlocks.length > 0 ? { imageBlocksPassedThrough: imageBlocks.length } : {}),
            ...(fullOutputPath !== undefined ? { fullOutputPath } : {}),
            ...(writeError !== undefined ? { writeError } : {}),
        };
    }
    const mcpResult = options.rawMcpResult === undefined
        ? undefined
        : await boundMcpResult(options.rawMcpResult, detailsMaxBytes);
    return {
        content: guardedContent,
        ...(outputGuard ? { outputGuard } : {}),
        ...(mcpResult !== undefined ? { mcpResult } : {}),
    };
}
function sanitizeContent(content) {
    return content.map((block) => {
        if (block.type !== "image")
            return block;
        const mimeType = typeof block.mimeType === "string" && block.mimeType.trim()
            ? block.mimeType.trim().slice(0, 100)
            : "image/png";
        return { ...block, mimeType };
    });
}
function withEmptyTextFallback(content, fallback) {
    if (!fallback)
        return content;
    const textOutput = content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    if (textOutput)
        return content;
    return [{ type: "text", text: fallback }, ...content.filter((block) => block.type === "image")];
}
function addAffixes(content, prefix, suffix) {
    if (!prefix && !suffix)
        return content;
    const next = [...content];
    if (prefix) {
        const index = next.findIndex((block) => block.type === "text");
        const block = next[index];
        if (block?.type === "text") {
            next[index] = { ...block, text: `${prefix}${block.text}` };
        }
        else {
            next.unshift({ type: "text", text: prefix });
        }
    }
    if (suffix) {
        let index = -1;
        for (let i = next.length - 1; i >= 0; i--) {
            if (next[i]?.type === "text") {
                index = i;
                break;
            }
        }
        const block = next[index];
        if (block?.type === "text") {
            next[index] = { ...block, text: `${block.text}${suffix}` };
        }
        else {
            next.push({ type: "text", text: suffix });
        }
    }
    return next;
}
function reserveBudget(maxBytes, maxLines, notice) {
    const noticeStats = textStats(`\n\n${notice}`);
    return {
        maxBytes: Math.max(0, maxBytes - noticeStats.bytes),
        maxLines: Math.max(0, maxLines - noticeStats.lines),
    };
}
function truncateStringToBytes(value, maxBytes) {
    if (byteLength(value) <= maxBytes)
        return value;
    const buffer = Buffer.from(value, "utf8");
    let end = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
    while (end > 0 && (buffer.readUInt8(end) & 0xc0) === 0x80)
        end--;
    return buffer.subarray(0, end).toString("utf8");
}
function formatTruncationNotice(truncation, fullOutputPath, writeError) {
    let reason;
    if (truncation.firstLineExceedsLimit) {
        reason = `First line exceeds ${formatSize(truncation.maxBytes)} limit`;
    }
    else if (truncation.truncatedBy === "lines") {
        reason = `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines} line limit)`;
    }
    else {
        reason = `Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes)} limit)`;
    }
    const base = `[MCP text output truncated: original ${truncation.totalLines.toLocaleString()} lines / ${formatSize(truncation.totalBytes)}. ${reason}.`;
    if (fullOutputPath) {
        return `${base} Full text saved to: ${fullOutputPath} — use read with offset/limit or grep to inspect.]`;
    }
    return `${base} Full output could not be saved: ${writeError ?? "unknown error"}]`;
}
/**
 * Bound details.mcpResult: keep the raw result when its JSON fits within
 * detailsMaxBytes; otherwise replace it with a compact summary and spill the
 * raw JSON to a temp file.
 */
async function boundMcpResult(result, detailsMaxBytes) {
    const raw = safeStringify(result);
    const rawBytes = byteLength(raw);
    if (rawBytes <= detailsMaxBytes)
        return result;
    const marker = { omitted: true };
    if (byteLength(safeStringify(marker)) > detailsMaxBytes)
        return undefined;
    const summary = await summarizeMcpResult(result, raw, rawBytes);
    if (byteLength(safeStringify(summary)) <= detailsMaxBytes)
        return summary;
    return compactMcpResultOmission(summary, marker, detailsMaxBytes);
}
async function compactMcpResultOmission(summary, marker, maxBytes) {
    if (summary.fullResultPath) {
        const withPathAndSize = {
            ...marker,
            rawResultBytes: summary.rawResultBytes,
            fullResultPath: summary.fullResultPath,
        };
        if (byteLength(safeStringify(withPathAndSize)) <= maxBytes)
            return withPathAndSize;
        const withPath = { ...marker, fullResultPath: summary.fullResultPath };
        if (byteLength(safeStringify(withPath)) <= maxBytes)
            return withPath;
        await discardArtifact(summary.fullResultPath);
    }
    const withSize = { ...marker, rawResultBytes: summary.rawResultBytes };
    return byteLength(safeStringify(withSize)) <= maxBytes ? withSize : marker;
}
async function summarizeMcpResult(result, raw, rawBytes) {
    const { path: fullResultPath, error: resultWriteError } = await saveArtifact("mcp-result", raw);
    const record = asRecord(result);
    const content = Array.isArray(record?.content) ? record.content : [];
    const summary = {
        omitted: true,
        reason: "Raw MCP result exceeded the details size limit and was replaced with this summary to keep session context bounded.",
        isError: record?.isError === true,
        contentBlocks: content.length,
        contentSummary: summarizeContent(content),
        rawResultBytes: rawBytes,
        ...(fullResultPath !== undefined ? { fullResultPath } : {}),
        ...(resultWriteError !== undefined ? { resultWriteError } : {}),
    };
    if (record && "structuredContent" in record) {
        summary.structuredContent = summarizeStructuredContent(record.structuredContent);
    }
    if (record && "_meta" in record) {
        summary.meta = summarizeValue(record._meta);
    }
    if (record) {
        const standard = new Set(["content", "isError", "structuredContent", "_meta"]);
        const extraFields = Object.keys(record)
            .filter((key) => !standard.has(key))
            .slice(0, KEY_PREVIEW_LIMIT)
            .map((key) => ({ key: truncateKey(key), type: typeof record[key], estimatedBytes: estimateValueBytes(record[key]), omitted: true }));
        if (extraFields.length > 0)
            summary.extraFields = extraFields;
    }
    return summary;
}
function summarizeContent(content) {
    const summaries = content.slice(0, CONTENT_SUMMARY_LIMIT).map((block) => {
        const record = asRecord(block);
        if (!record)
            return { type: typeof block, omitted: true };
        if (record.type === "text") {
            const text = typeof record.text === "string" ? record.text : "";
            return { type: "text", bytes: byteLength(text), lines: textStats(text).lines, textOmitted: true };
        }
        if (record.type === "image") {
            const data = typeof record.data === "string" ? record.data : "";
            return { type: "image", mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined, dataBytes: byteLength(data), dataOmitted: true };
        }
        return { type: typeof record.type === "string" ? record.type : "unknown", estimatedBytes: estimateValueBytes(record), omitted: true };
    });
    if (content.length > CONTENT_SUMMARY_LIMIT) {
        summaries.push({ type: "omitted", count: content.length - CONTENT_SUMMARY_LIMIT });
    }
    return summaries;
}
function summarizeValue(value) {
    const record = asRecord(value);
    if (!record) {
        return { type: value === null ? "null" : typeof value, estimatedBytes: estimateValueBytes(value), omitted: true };
    }
    const keys = Object.keys(record);
    return {
        type: Array.isArray(value) ? "array" : "object",
        estimatedBytes: estimateValueBytes(value),
        keyCount: keys.length,
        keysPreview: uniqueBoundedKeys(keys.slice(0, KEY_PREVIEW_LIMIT)),
        omitted: true,
    };
}
function summarizeStructuredContent(value) {
    const record = asRecord(value);
    if (!record || Array.isArray(value))
        return summarizeValue(value);
    const keys = Object.keys(record);
    const entries = Object.entries(record).slice(0, KEY_PREVIEW_LIMIT);
    const previewKeys = uniqueBoundedKeys(entries.map(([key]) => key));
    const fields = {};
    let preservedBytes = byteLength("{}");
    for (const [key, field] of entries) {
        const fieldBytes = byteLength(safeStringify(field));
        const candidate = fieldBytes <= STRUCTURED_CONTENT_FIELD_PRESERVE_MAX_BYTES
            ? field
            : summarizeValue(field);
        const entryBytes = serializedObjectEntryBytes(key, candidate, Object.keys(fields).length > 0);
        if (preservedBytes + entryBytes > STRUCTURED_CONTENT_PRESERVE_MAX_BYTES)
            continue;
        fields[key] = candidate;
        preservedBytes += entryBytes;
    }
    const preservedCount = Object.keys(fields).length;
    return {
        omitted: true,
        preservedFields: fields,
        summary: {
            type: "object",
            estimatedBytes: estimateValueBytes(value),
            keyCount: keys.length,
            preservedCount,
            droppedCount: keys.length - preservedCount,
            keysPreview: previewKeys,
            omitted: true,
        },
    };
}
function estimateValueBytes(value, depth = 0) {
    if (value === null || value === undefined)
        return 0;
    if (typeof value === "string")
        return byteLength(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
        return byteLength(String(value));
    const record = asRecord(value);
    if (!record || depth >= 2)
        return 0;
    const values = Array.isArray(value) ? value.slice(0, KEY_PREVIEW_LIMIT) : Object.values(record).slice(0, KEY_PREVIEW_LIMIT);
    return values.reduce((total, item) => total + estimateValueBytes(item, depth + 1), 0);
}
function truncateKey(key) {
    if (byteLength(key) <= KEY_MAX_BYTES)
        return key;
    const suffix = "…";
    return `${truncateStringToBytes(key, KEY_MAX_BYTES - byteLength(suffix))}${suffix}`;
}
function uniqueBoundedKeys(keys) {
    const used = new Set();
    return keys.map((key) => {
        let candidate = truncateKey(key);
        let ordinal = 2;
        while (used.has(candidate)) {
            const suffix = `~${ordinal}`;
            candidate = `${truncateStringToBytes(key, KEY_MAX_BYTES - byteLength(suffix))}${suffix}`;
            ordinal += 1;
        }
        used.add(candidate);
        return candidate;
    });
}
function serializedObjectEntryBytes(key, value, hasPrevious) {
    const serialized = safeStringify({ [key]: value });
    return Math.max(0, byteLength(serialized) - byteLength("{}")) + (hasPrevious ? 1 : 0);
}
async function saveArtifact(kind, text) {
    try {
        const dir = await mkdtemp(join(omaTmpdir(), "pi-mcp-output-"));
        const path = join(dir, `${kind}-${randomBytes(4).toString("hex")}.txt`);
        await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
        return { path };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}
async function discardArtifact(path) {
    try {
        await rm(dirname(path), { recursive: true, force: true });
    }
    catch {
        // Cleanup cannot increase the returned details payload.
    }
}
function asRecord(value) {
    return typeof value === "object" && value !== null ? value : undefined;
}
function safeStringify(value) {
    try {
        // The output guard measures and spills raw MCP results; it does not render this JSON for the model.
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function textStats(text) {
    return { bytes: byteLength(text), lines: text.length === 0 ? 0 : text.split("\n").length };
}
function byteLength(text) {
    return Buffer.byteLength(text, "utf8");
}
function positiveInt(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    const integer = Math.floor(value);
    return integer > 0 ? integer : undefined;
}
function envKillSwitch(name) {
    const value = omaAmbientEnv()[name]?.trim().toLowerCase();
    if (!value)
        return undefined;
    if (["0", "false", "no", "off"].includes(value))
        return false;
    if (["1", "true", "yes", "on"].includes(value))
        return true;
    return undefined;
}
