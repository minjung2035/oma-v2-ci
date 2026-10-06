import { abortIf, rejectUnknownFields, clipLine, decodeStringArray, assertNoNul } from "../utils.js";
import { parseHashRef, parsePayloadText, parseTextWithSeparators } from "./parse.js";
import { HASH_SEP, stripRowPrefix, lineChecksum } from "./hash.js";
import { HASH_RUN } from "./alphabet.js";
import { NEW_CONTENT_NOT_ARRAY_MSG, NEW_CONTENT_NOT_STRING_MSG, MAX_RANGE_STALE_LINES } from "../constants.js";
function resAnchorFromMap(ref, hashIndex) {
    const hashMatches = hashIndex.get(ref.hash);
    if (!hashMatches || hashMatches.length === 0) {
        return { ref, kind: "not_found" };
    }
    return {
        line: hashMatches[0],
        hash: ref.hash,
    };
}
function assertAligned(fileLines, fileHashes, ctx) {
    if (fileHashes.length !== fileLines.length) {
        throw new Error(`${ctx}: fileHashes.length (${fileHashes.length}) must match fileLines.length (${fileLines.length}).`);
    }
}
export function fmtRow(hash, line) {
    return `${hash}${HASH_SEP}${line}`;
}
export function fmtRegion(hashes, lines) {
    if (hashes.length !== lines.length) {
        throw new Error(`fmtRegion: hashes.length (${hashes.length}) must match lines.length (${lines.length}).`);
    }
    return lines.map((line, index) => fmtRow(hashes[index], line)).join("\n");
}
export function fmtMismatchWithHashes(mismatches, fileLines, fileHashes, filePath) {
    assertAligned(fileLines, fileHashes, "fmtMismatch");
    const out = [];
    const hashes = [];
    const servedMap = new Map();
    const notFound = mismatches;
    if (notFound.length > 0) {
        const refList = notFound.map((m) => `"${m.ref.hash}"`).join(", ");
        out.push(`[E_STALE_ANCHOR] ${notFound.length} stale anchor${notFound.length > 1 ? "s" : ""}${filePath ? ` in ${filePath}` : ""}: ${refList}. The file changed since read. Call read()${filePath ? ` on ${filePath}` : ""} for fresh anchors.`);
        for (const m of notFound) {
            const ctx = m.context;
            if (!ctx)
                continue;
            const from = Math.max(1, ctx.line - 1);
            const to = Math.min(fileLines.length, ctx.line + 1);
            const rows = [];
            for (let ln = from; ln <= to; ln++) {
                const h = fileHashes[ln - 1];
                const c = fileLines[ln - 1] ?? "";
                hashes.push(h);
                servedMap.set(h, lineChecksum(c));
                rows.push(`    ${ln}: ${h}│${clipLine(c)}`);
            }
            out.push("");
            out.push(`  Current context around resolved anchor "${ctx.hash}" (line ${ctx.line}):\n${rows.join("\n")}`);
        }
    }
    return { text: out.join("\n"), hashes, servedMap };
}
const ITEM_KS = new Set(["replacement_lines", "remove_from", "remove_to"]);
function assertBounds(edit) {
    if ("remove_from" in edit && typeof edit.remove_from !== "string") {
        throw new Error(`[E_BAD_SHAPE] Field "remove_from" must be an anchor string (4-char anchor).`);
    }
    if ("remove_to" in edit && typeof edit.remove_to !== "string") {
        throw new Error(`[E_BAD_SHAPE] Field "remove_to" must be an anchor string (4-char anchor).`);
    }
    if (typeof edit.remove_from !== "string" || typeof edit.remove_to !== "string") {
        throw new Error(`[E_BAD_SHAPE] The edit requires "remove_from" and "remove_to" anchor strings (4-char anchors from read output).`);
    }
}
function assertItem(edit) {
    rejectUnknownFields(edit, ITEM_KS, "Edit", "The edit takes only { replacement_lines, remove_from, remove_to }.");
    assertBounds(edit);
    if (!("replacement_lines" in edit)) {
        throw new Error(`[E_BAD_SHAPE] The edit requires a "replacement_lines" array (use [] to delete).`);
    }
    if (!Array.isArray(edit.replacement_lines) || edit.replacement_lines.some((line) => typeof line !== "string")) {
        throw new Error(NEW_CONTENT_NOT_ARRAY_MSG);
    }
}
function assertPayloadItem(edit) {
    rejectUnknownFields(edit, ITEM_KS, "Edit", "The edit takes only { replacement_lines, remove_from, remove_to }.");
    assertBounds(edit);
    if (!("replacement_lines" in edit)) {
        throw new Error(`[E_BAD_SHAPE] The edit requires a "replacement_lines" string (use "" to delete).`);
    }
    if (typeof edit.replacement_lines !== "string") {
        throw new Error(NEW_CONTENT_NOT_STRING_MSG);
    }
}
function resolveParsedEdit(removeFrom, removeTo, parsed, warnings) {
    const replaceLines = parsed.lines;
    assertNoNul(replaceLines);
    const bounds = [removeFrom, removeTo].map((ref) => {
        return stripAnchorRow(ref.trim(), "remove_from/remove_to entry", warnings);
    });
    return {
        content_lines: replaceLines,
        hash_bounds: [parseHashRef(bounds[0]), parseHashRef(bounds[1])],
        ...(parsed.separators.some((separator) => separator !== undefined) ? { content_separators: parsed.separators } : {}),
    };
}
export const ANCHOR_ROW_RE = new RegExp(`^([+-]?)(${HASH_RUN})│`);
export function stripAnchorRow(trimmed, entryLabel, warnings) {
    const match = trimmed.match(ANCHOR_ROW_RE);
    if (!match)
        return trimmed;
    const marker = match[1] === "+"
        ? "diff-preview marker"
        : match[1] === "-"
            ? 'leading "-" marker'
            : '"anchor│" prefix';
    warnings?.push(`[W_BAD_REF] Stripped ${marker} from ${entryLabel} "${clipLine(trimmed, 48)}".`);
    return match[2];
}
export function resEdit(edit, warnings) {
    if (typeof edit.replacement_lines === "string") {
        assertPayloadItem(edit);
        return resolveParsedEdit(edit.remove_from, edit.remove_to, parsePayloadText(edit.replacement_lines), warnings);
    }
    assertItem(edit);
    const parsed = parseTextWithSeparators(decodeStringArray(edit.replacement_lines, warnings) ?? edit.replacement_lines);
    return resolveParsedEdit(edit.remove_from, edit.remove_to, parsed, warnings);
}
function warnUnicodeEsc(edit, warnings) {
    if (edit.content_lines.some((line) => /\\uDDDD/i.test(line))) {
        warnings.push("Detected literal \\uDDDD in edit content; no autocorrection applied.");
    }
}
function stripRowPrefixes(edit, warnings, kinds, code, marker, location) {
    const stripped = [];
    const contentLines = edit.content_lines.map((line, lineIndex) => {
        const result = stripRowPrefix(line);
        if (result.kind === null || !kinds.includes(result.kind))
            return line;
        stripped.push(lineIndex);
        return result.text;
    });
    if (stripped.length === 0)
        return edit;
    const locations = stripped.map((i) => `${location.label} line ${i + 1 + location.indexOffset}`).join(", ");
    warnings.push(`${code} Stripped ${marker} from ${locations}.`);
    return { ...edit, content_lines: contentLines };
}
const DEFAULT_STRIP_WARNING_LOCATION = { label: "replacement_lines", indexOffset: 0 };
export function stripBarePrefixes(edit, warnings, location = DEFAULT_STRIP_WARNING_LOCATION) {
    return stripRowPrefixes(edit, warnings, ["bare"], "[W_BARE_HASH_PREFIX]", '"anchor│" prefix', location);
}
export function stripDiffPrefixes(edit, warnings, location = DEFAULT_STRIP_WARNING_LOCATION) {
    return stripRowPrefixes(edit, warnings, ["plus", "minus"], "[W_INVALID_PATCH]", "diff-preview marker", location);
}
export function swapReversedRanges(edit, fileHashes) {
    const lineByHash = new Map();
    for (let i = 0; i < fileHashes.length; i++) {
        lineByHash.set(fileHashes[i], i + 1);
    }
    const [startRef, endRef] = edit.hash_bounds;
    const startLine = lineByHash.get(startRef.hash);
    const endLine = lineByHash.get(endRef.hash);
    if (startLine === undefined ||
        endLine === undefined ||
        startLine <= endLine) {
        return edit;
    }
    return { ...edit, hash_bounds: [endRef, startRef] };
}
export function preserveDeletionSeparators(edit, fileLines, fileHashes) {
    if (edit.content_lines.length > 0)
        return edit;
    const lineByHash = new Map();
    for (let index = 0; index < fileHashes.length; index++) {
        const hash = fileHashes[index];
        if (!lineByHash.has(hash))
            lineByHash.set(hash, index);
    }
    const fromLine = lineByHash.get(edit.hash_bounds[0].hash);
    const toLine = lineByHash.get(edit.hash_bounds[1].hash);
    if (fromLine === undefined || toLine === undefined)
        return edit;
    const rangeStart = Math.min(fromLine, toLine);
    const rangeEnd = Math.max(fromLine, toLine);
    const isBlank = (index) => (fileLines[index] ?? "").trim().length === 0;
    let start = rangeStart;
    let end = rangeEnd;
    while (start <= end && isBlank(start))
        start += 1;
    while (end >= start && isBlank(end))
        end -= 1;
    if (start > end || (start === rangeStart && end === rangeEnd))
        return edit;
    return { ...edit, hash_bounds: [{ hash: fileHashes[start] }, { hash: fileHashes[end] }] };
}
export function valEdit(edit, fileLines, fileHashes, warnings, signal) {
    assertAligned(fileLines, fileHashes, "valEdit");
    const mismatches = [];
    const hashIndex = new Map();
    for (let i = 0; i < fileHashes.length; i++) {
        const h = fileHashes[i];
        const list = hashIndex.get(h) ?? [];
        list.push(i + 1);
        hashIndex.set(h, list);
    }
    const tryResolve = (ref) => {
        const result = resAnchorFromMap(ref, hashIndex);
        if ("kind" in result) {
            mismatches.push(result);
            return undefined;
        }
        return result;
    };
    abortIf(signal);
    const startResolved = tryResolve(edit.hash_bounds[0]);
    const endResolved = tryResolve(edit.hash_bounds[1]);
    if (!startResolved || !endResolved) {
        if (!startResolved && endResolved) {
            const startMismatch = mismatches.findLast((m) => m.ref === edit.hash_bounds[0]);
            if (startMismatch && startMismatch.kind === "not_found")
                startMismatch.context = endResolved;
        }
        else if (startResolved && !endResolved) {
            const endMismatch = mismatches.findLast((m) => m.ref === edit.hash_bounds[1]);
            if (endMismatch && endMismatch.kind === "not_found")
                endMismatch.context = startResolved;
        }
        return { resolved: undefined, mismatches };
    }
    return {
        resolved: {
            content_lines: edit.content_lines,
            hash_bounds: [startResolved, endResolved],
            ...(edit.content_separators !== undefined ? { content_separators: edit.content_separators } : {}),
        },
        mismatches,
    };
}
export function resolveAnchorLine(ref, fileLines, fileHashes, filePath) {
    const { resolved, mismatches } = valEdit({ hash_bounds: [ref, ref], content_lines: [] }, fileLines, fileHashes, [], undefined);
    if (mismatches.length > 0 || !resolved) {
        const feedback = fmtMismatchWithHashes(mismatches, fileLines, fileHashes, filePath);
        throw new AnchorMismatchError(feedback.text, feedback.hashes, feedback.servedMap);
    }
    return resolved.hash_bounds[0].line;
}
export class RangeStaleError extends Error {
    rangeHashes;
    rangeServedMap;
    constructor(message, rangeHashes, rangeServedMap) {
        super(message);
        this.name = "RangeStaleError";
        this.rangeHashes = rangeHashes;
        this.rangeServedMap = rangeServedMap;
    }
}
export class AnchorMismatchError extends Error {
    feedbackHashes;
    feedbackMap;
    constructor(message, feedbackHashes, feedbackMap) {
        super(message);
        this.name = "AnchorMismatchError";
        this.feedbackHashes = feedbackHashes;
        this.feedbackMap = feedbackMap;
    }
}
export function assertRangeServed(resolved, fileLines, fileHashes, served, filePath) {
    assertAligned(fileLines, fileHashes, "assertRangeServed");
    const startLine = resolved.hash_bounds[0].line;
    const endLine = resolved.hash_bounds[1].line;
    const mismatchLines = [];
    const deletion = resolved.content_lines.length === 0;
    for (let line = startLine; line <= endLine; line++) {
        const hash = fileHashes[line - 1];
        const content = fileLines[line - 1];
        const servedContent = served?.get(hash);
        if (servedContent === undefined && deletion && line !== startLine && line !== endLine)
            continue;
        if (servedContent === undefined || servedContent !== lineChecksum(content))
            mismatchLines.push(line);
    }
    if (mismatchLines.length === 0)
        return;
    const rangeLength = endLine - startLine + 1;
    const shownLength = Math.min(rangeLength, MAX_RANGE_STALE_LINES);
    const rows = [];
    const shownHashes = [];
    const shownMap = new Map();
    for (let line = startLine; line < startLine + shownLength; line++) {
        const hash = fileHashes[line - 1];
        const content = fileLines[line - 1];
        shownHashes.push(hash);
        shownMap.set(hash, lineChecksum(content));
        rows.push(fmtRow(hash, clipLine(content)));
    }
    const location = filePath ? ` in ${filePath}` : "";
    const first = mismatchLines[0];
    const mismatchText = mismatchLines.length === 1
        ? `Line ${first} of the replaced range (lines ${startLine}-${endLine})${location} does not match`
        : `${mismatchLines.length} of ${rangeLength} line(s) in the replaced range (lines ${startLine}-${endLine})${location} do not match`;
    const capHint = rangeLength > shownLength
        ? `\n\n[The range has ${rangeLength} lines; showing the first ${shownLength}. Call read()${filePath ? ` on ${filePath}` : ""} with offset=${startLine + shownLength} to see the rest.]`
        : "\n\nRetry with the fresh anchors above without a read.";
    const message = `[E_RANGE_STALE] ${mismatchText} what was shown. Current range with fresh anchors:\n\n${rows.join("\n")}${capHint}`;
    throw new RangeStaleError(message, shownHashes, shownMap);
}
export { warnUnicodeEsc };
