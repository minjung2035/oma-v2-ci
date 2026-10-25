import { genDiff, genPatch } from "./replace-diff.js";
import { visLines, clipLine } from "./utils.js";
import { annotateLiteralEscapeHints, fidelityHints } from "./edit-fidelity.js";
export function buildMetrics(args) {
    const metrics = {
        edits_attempted: args.editsAttempted,
        edits_noop: args.noopEditsCount,
        warnings: args.warningsCount,
        classification: args.classification,
    };
    if (args.classification === "applied" &&
        args.firstChangedLine !== undefined &&
        args.lastChangedLine !== undefined) {
        metrics.changed_lines = {
            first: args.firstChangedLine,
            last: args.lastChangedLine,
        };
    }
    if (args.addedLines !== undefined)
        metrics.added_lines = args.addedLines;
    if (args.removedLines !== undefined)
        metrics.removed_lines = args.removedLines;
    return metrics;
}
function warnBlock(warnings) {
    return warnings?.length ? `\n\nWarnings:\n${warnings.join("\n")}` : "";
}
function hintBlock(hints) {
    return hints?.length ? `\n\nHints:\n${hints.join("\n")}` : "";
}
function splitNotices(notices) {
    const warnings = [];
    const hints = [];
    for (const notice of notices ?? [])
        (notice.startsWith("[H_") ? hints : warnings).push(notice);
    return { warnings, hints };
}
export function buildNoop(input, noopNoun = "Replacement") {
    const { path, noopEdit, snapshotId, editMeta, warnings, } = input;
    const noopDetailsText = noopEdit
        ? `${noopNoun} for ${noopEdit.loc} is identical to current content:\n  ${noopEdit.loc}: ${clipLine(noopEdit.currentContent)}`
        : "The edit produced identical content.";
    const { warnings: noticeWarnings, hints } = splitNotices(warnings);
    const text = `No changes made to ${path}\nClassification: noop\n${noopDetailsText}${warnBlock(noticeWarnings)}${hintBlock(hints)}`;
    const metrics = buildMetrics({
        classification: "noop",
        editsAttempted: editMeta.editsAttempted,
        noopEditsCount: editMeta.noopEditsCount,
        warningsCount: noticeWarnings.length,
    });
    return {
        content: [{ type: "text", text }],
        details: {
            diff: "",
            patch: "",
            firstChangedLine: undefined,
            snapshotId,
            classification: "noop",
            metrics,
            ...(noticeWarnings.length ? { warnings: [...noticeWarnings] } : {}),
            ...(hints.length ? { hints: [...hints] } : {}),
        },
    };
}
export function buildChanged(input, verb = "replaced", diffContextLines = 1) {
    const { path, result, warnings, snapshotId, originalNormalized, originalHashes, editMeta, resultHashes, spans } = input;
    const resultLines = visLines(result);
    const diffResult = genDiff(originalNormalized, result, diffContextLines, resultHashes, originalHashes, undefined, spans);
    const addedLines = editMeta.addedLines;
    const removedLines = editMeta.removedLines;
    const fidelity = fidelityHints(originalNormalized, result, spans, originalHashes, { separatorMoved: verb === "inserted" || verb === "edited", indentHints: verb !== "copied" && verb !== "moved" });
    const { warnings: noticeWarnings, hints } = splitNotices(fidelity.length > 0 ? [...(warnings ?? []), ...fidelity] : warnings);
    const annotatedHints = annotateLiteralEscapeHints(hints, result, spans, resultHashes);
    const noticesBlock = `${warnBlock(noticeWarnings)}${hintBlock(annotatedHints)}`;
    const successPrefix = `Successfully ${verb} in ${path}.`;
    const lineSummary = addedLines > 0 || removedLines > 0
        ? ` Added ${addedLines} line(s), removed ${removedLines} line(s).`
        : "";
    const text = resultLines.length === 0
        ? "File is empty. Use replace to insert content."
        : noticesBlock
            ? `${successPrefix}${lineSummary}${noticesBlock}`
            : `${successPrefix}${lineSummary}`;
    const metrics = buildMetrics({
        classification: "applied",
        editsAttempted: editMeta.editsAttempted,
        noopEditsCount: editMeta.noopEditsCount,
        warningsCount: noticeWarnings.length,
        firstChangedLine: editMeta.firstChangedLine,
        lastChangedLine: editMeta.lastChangedLine,
        addedLines,
        removedLines,
    });
    const patchResult = genPatch(path, originalNormalized, result);
    return {
        content: [{ type: "text", text }],
        details: {
            diff: diffResult.diff,
            patch: patchResult.patch,
            ...(patchResult.truncated ? { patchTruncated: true } : {}),
            firstChangedLine: editMeta.firstChangedLine ?? diffResult.firstChangedLine,
            snapshotId,
            metrics,
            diffLineNumbers: diffResult.lineNumbers.map((line) => line ?? null),
            ...(noticeWarnings.length ? { warnings: [...noticeWarnings] } : {}),
            ...(annotatedHints.length ? { hints: [...annotatedHints] } : {}),
        },
    };
}
