import { constants } from "node:fs";
import { open, stat } from "node:fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadHashStore, persistSnapshot, upsertUndo, getUndoEntry, deleteUndo } from "./hash-store.js";
import { servedHashesFromDiff, serveRows } from "./served.js";
import { lineChecksum } from "./hashline/index.js";
import { freeAnchors, adoptAnchors, withAnchorSession, formatAnchorReclaimNotice, takeReclaimedPaths } from "./anchor-registry.js";
import { resolveInCwd, writeAtomic } from "./fs-write.js";
import { toLF, stripBOM, restoreEndings } from "./normalize.js";
import { joinSeparators } from "./line-endings.js";
import { genDiff, genPatch, spansFromHashes } from "./replace-diff.js";
import { getDiffContextLines } from "./config.js";
import { cntDiff, errCode, makePrepareArguments, splitLines } from "./utils.js";
import { loadP, loadGuide } from "./prompts.js";
import { withUndoPrompts, DEFAULT_EDIT_FLAGS } from "./edit-common.js";
import { buildMetrics } from "./replace-response.js";
import { renderEditResult, fmtCall } from "./replace-render.js";
import { Text } from "@earendil-works/pi-tui";
import { changedRange, lineHashes } from "./hashline/index.js";
export async function saveUndo(path, entry) {
    let previous;
    try {
        const store = await loadHashStore();
        previous = getUndoEntry(store, path);
        let mode;
        try {
            mode = (await stat(path)).mode & 0o7777;
        }
        catch {
        }
        upsertUndo(store, path, {
            content: entry.content,
            bom: entry.bom,
            ending: entry.originalEnding,
            ...(entry.separators !== undefined ? { separators: entry.separators } : {}),
            hashes: entry.hashes,
            resultContent: entry.resultContent,
            ...(entry.resultSeparators !== undefined ? { resultSeparators: entry.resultSeparators } : {}),
            ...(mode !== undefined ? { mode } : {}),
        });
    }
    catch (error) {
        console.error("Failed to persist undo entry:", error);
        return { persisted: false, restore: async () => undefined };
    }
    return {
        persisted: true,
        restore: async () => {
            try {
                const store = await loadHashStore();
                if (previous)
                    upsertUndo(store, path, previous);
                else
                    deleteUndo(store, path);
            }
            catch (error) {
                console.error("Failed to restore previous undo entry:", error);
            }
        },
    };
}
export async function getUndo(path) {
    try {
        const store = await loadHashStore();
        const record = getUndoEntry(store, path);
        if (!record)
            return undefined;
        const originalEnding = record.ending;
        if (originalEnding !== "\r\n" && originalEnding !== "\n" && originalEnding !== "\r") {
            await deleteUndo(store, path);
            return undefined;
        }
        return {
            content: record.content,
            bom: record.bom,
            originalEnding,
            ...(record.separators !== undefined ? { separators: record.separators } : {}),
            hashes: record.hashes,
            resultContent: record.resultContent,
            ...(record.resultSeparators !== undefined ? { resultSeparators: record.resultSeparators } : {}),
            ...(record.mode !== undefined ? { mode: record.mode } : {}),
        };
    }
    catch (error) {
        console.error("Failed to load undo entry:", error);
        return undefined;
    }
}
export async function clearUndo(path) {
    try {
        const store = await loadHashStore();
        deleteUndo(store, path);
    }
    catch (error) {
        console.error("Failed to clear undo entry:", error);
    }
}
function fallbackFileMode() {
    return 0o666 & ~process.umask();
}
export function regUndo(pi, flags = DEFAULT_EDIT_FLAGS) {
    const prompted = withUndoPrompts({
        description: loadP("../prompts/undo-last-change.md"),
        snippet: loadP("../prompts/undo-last-change-snippet.md"),
        guidelines: loadGuide("../prompts/undo-last-change-guidelines.md"),
    }, flags);
    pi.registerTool({
        name: "undo_last_change",
        label: "Undo Last Change",
        description: prompted.description,
        promptSnippet: prompted.snippet,
        promptGuidelines: prompted.guidelines,
        prepareArguments: makePrepareArguments(),
        parameters: Type.Object({
            path: Type.String({
                description: "Path to the file to undo",
            }),
        }),
        executionMode: "sequential",
        renderCall(args, theme, context) {
            const text = context.lastComponent ?? new Text("", 0, 0);
            text.setText(fmtCall(args, { preview: undefined }, context.expanded === true, theme, "undo_last_change"));
            return text;
        },
        renderResult(result, opts, theme, context) {
            return renderEditResult(result, opts, theme, context);
        },
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            return withAnchorSession(ctx, async () => {
                const path = params.path;
                if (typeof path !== "string" || path.length === 0) {
                    throw new Error('[E_BAD_SHAPE] Undo request requires a non-empty "path" string.');
                }
                const { resolved: mutationTargetPath } = await resolveInCwd(path, ctx.cwd);
                const undo = await getUndo(mutationTargetPath);
                if (!undo) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `No undo history for ${path}.`,
                            },
                        ],
                        isError: true,
                        details: {},
                    };
                }
                return withFileMutationQueue(mutationTargetPath, async () => {
                    let currentRaw;
                    let currentIdentity;
                    try {
                        const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
                        const handle = await open(mutationTargetPath, constants.O_RDONLY | noFollow);
                        try {
                            const { dev, ino } = await handle.stat();
                            currentIdentity = { dev, ino };
                            currentRaw = await handle.readFile("utf-8");
                        }
                        finally {
                            await handle.close();
                        }
                    }
                    catch (error) {
                        if (errCode(error) !== "ENOENT")
                            throw error;
                    }
                    if (currentRaw !== undefined &&
                        currentRaw !== undo.bom + (undo.resultSeparators !== undefined ? joinSeparators(undo.resultContent, undo.resultSeparators) : restoreEndings(undo.resultContent, undo.originalEnding))) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `[E_UNDO_STALE] Cannot undo last change on ${path}: the file was modified after the edit, so nothing was reverted and the file was left untouched. The undo record is kept. Do not edit the file to force the undo. Call read() to inspect the current state.`
                                },
                            ],
                            isError: true,
                            details: {},
                        };
                    }
                    await writeAtomic(mutationTargetPath, undo.bom + (undo.separators !== undefined ? joinSeparators(undo.content, undo.separators) : restoreEndings(undo.content, undo.originalEnding)), currentIdentity, undo.mode ?? fallbackFileMode());
                    const currentNormalized = currentRaw === undefined ? "" : toLF(stripBOM(currentRaw).text);
                    const currentHashes = await lineHashes(currentNormalized, mutationTargetPath);
                    const diffResult = genDiff(undo.content, undo.resultContent, 0, undefined, undo.hashes, { unlimited: true });
                    const linesAddedByReplace = cntDiff(diffResult.diff, "+");
                    const linesRemovedByReplace = cntDiff(diffResult.diff, "-");
                    const restoredRange = changedRange(currentNormalized, undo.content);
                    const undoSpans = spansFromHashes(currentHashes, undo.hashes);
                    const undoDiffResult = genDiff(currentNormalized, undo.content, await getDiffContextLines(), undo.hashes, currentHashes, undefined, undoSpans);
                    const undoDiff = undoDiffResult.diff;
                    try {
                        const store = await loadHashStore();
                        const undoLines = splitLines(undo.content);
                        persistSnapshot(store, mutationTargetPath, undo.content, undo.hashes, undoLines.map(lineChecksum));
                        freeAnchors(mutationTargetPath);
                        adoptAnchors(mutationTargetPath, new Map(undoLines.map((line, i) => [undo.hashes[i], lineChecksum(line)])));
                        serveRows(mutationTargetPath, undo.hashes, undoLines, servedHashesFromDiff(undoDiff));
                    }
                    catch (error) {
                        console.error("Failed to restore hash store snapshot after undo:", error);
                    }
                    await clearUndo(mutationTargetPath);
                    const parts = [
                        `Undone last change on ${path}.`,
                    ];
                    if (currentRaw === undefined) {
                        parts.push("The file was deleted; restored it from undo history.");
                    }
                    if (linesAddedByReplace > 0 || linesRemovedByReplace > 0) {
                        parts.push(`Removed ${linesAddedByReplace} line(s), restored ${linesRemovedByReplace} line(s).`);
                    }
                    parts.push("Call read for fresh anchors.");
                    const reclaimNotice = formatAnchorReclaimNotice(takeReclaimedPaths());
                    if (reclaimNotice !== undefined)
                        parts.push(reclaimNotice);
                    const patchResult = genPatch(path, currentNormalized, undo.content);
                    return {
                        content: [
                            {
                                type: "text",
                                text: parts.join("\n"),
                            },
                        ],
                        details: {
                            diff: undoDiff,
                            diffLineNumbers: undoDiffResult.lineNumbers.map((line) => line ?? null),
                            patch: patchResult.patch,
                            ...(patchResult.truncated ? { patchTruncated: true } : {}),
                            metrics: buildMetrics({
                                classification: "applied",
                                editsAttempted: 1,
                                noopEditsCount: 0,
                                warningsCount: reclaimNotice !== undefined ? 1 : 0,
                                firstChangedLine: restoredRange?.firstChangedLine,
                                lastChangedLine: restoredRange?.lastChangedLine,
                                addedLines: linesRemovedByReplace,
                                removedLines: linesAddedByReplace,
                            }),
                        },
                    };
                });
            });
        },
    });
}
