import { constants } from "node:fs";
import { execPipeline, noteAnchorError, previewFromPipe, previewError } from "./replace.js";
import { commitEdit } from "./commit.js";
import { readNormFile } from "./file-reader.js";
import { fmtRegion, MAX_HASH_LINES, parseHashRef, resolveAnchorLine, stripAnchorRow } from "./hashline/index.js";
import { withAnchorSession } from "./anchor-registry.js";
import { loadP, loadGuide } from "./prompts.js";
import { assertReplaceWithinReq, buildReplaceWithinToolSchema, getReplaceWithinInput, normalizeReplaceWithinRequest, } from "./payload-contract.js";
import { literalEscapeHints, splitLines } from "./utils.js";
import { toLF } from "./normalize.js";
import { MAX_RANGE_STALE_LINES } from "./constants.js";
import { DEFAULT_EDIT_FLAGS, editRenderResultWrapper, editToolBase, queuedEdit, resolveEditTargetWithRequirement, throwIfStrictInput, tryResolveEditTarget, withReplaceWithinPrompts, } from "./edit-common.js";
import { makeRenderCall } from "./replace-render.js";
function formatWithinRange(start, end) {
    return start === end ? `line ${start}` : `lines ${start}-${end}`;
}
function offsetLineNumber(rangeLines, offset) {
    let cursor = 0;
    for (let index = 0; index < rangeLines.length; index++) {
        const length = rangeLines[index].length;
        if (offset <= cursor + length)
            return index + 1;
        cursor += length + 1;
    }
    return rangeLines.length;
}
function matchOffsets(text, oldText) {
    const offsets = [];
    let from = 0;
    for (;;) {
        const found = text.indexOf(oldText, from);
        if (found < 0)
            return offsets;
        offsets.push(found);
        from = found + 1;
    }
}
function notFoundMessage(displayPath, start, end, fileHashes, fileLines) {
    const rangeLength = end - start + 1;
    const shownCount = Math.min(rangeLength, MAX_RANGE_STALE_LINES);
    const shown = fmtRegion(fileHashes.slice(start - 1, start - 1 + shownCount), fileLines.slice(start - 1, start - 1 + shownCount));
    const more = rangeLength > shownCount ? `\n[The range has ${rangeLength} lines; showing the first ${shownCount}.]` : "";
    return `[E_SUBSTRING_NOT_FOUND] "replace_old" was not found in ${formatWithinRange(start, end)} of ${displayPath}. Current rows:\n\n${shown}${more}\n\nCopy replace_old exactly from the served row (comparison uses LF breaks and excludes the last line's terminator) and retry.`;
}
function ambiguousMessage(displayPath, start, end, matchLines) {
    const shownCount = 8;
    const shown = matchLines.slice(0, shownCount).join(", ");
    const more = matchLines.length > shownCount ? ` (+${matchLines.length - shownCount} more)` : "";
    return `[E_SUBSTRING_AMBIGUOUS] "replace_old" occurs ${matchLines.length} times in ${formatWithinRange(start, end)} of ${displayPath} (matching lines ${shown}${more}). Narrow replace_from/replace_to to one line, or extend replace_old so it matches exactly once.`;
}
export function parseWithinAnchors(req) {
    const warnings = [];
    const from = stripAnchorRow(req.replace_from.trim(), "replace_from entry", warnings);
    const to = stripAnchorRow(req.replace_to.trim(), "replace_to entry", warnings);
    return { refs: { from: parseHashRef(from), to: parseHashRef(to) }, warnings };
}
export function buildReplaceWithinEdit(req, refs, preload, displayPath) {
    const fileLines = splitLines(preload.normalized);
    const fromLine = resolveAnchorLine(refs.from, fileLines, preload.fileHashes, displayPath);
    const toLine = resolveAnchorLine(refs.to, fileLines, preload.fileHashes, displayPath);
    const start = Math.min(fromLine, toLine);
    const end = Math.max(fromLine, toLine);
    const rangeLines = fileLines.slice(start - 1, end);
    const rangeText = rangeLines.join("\n");
    const oldText = toLF(req.replace_old);
    const offsets = matchOffsets(rangeText, oldText);
    if (offsets.length === 0) {
        throw new Error(notFoundMessage(displayPath, start, end, preload.fileHashes, fileLines));
    }
    if (offsets.length > 1) {
        throw new Error(ambiguousMessage(displayPath, start, end, offsets.map((offset) => start - 1 + offsetLineNumber(rangeLines, offset))));
    }
    const matchOffset = offsets[0];
    const replacement = rangeText.slice(0, matchOffset) + req.replace_new + rangeText.slice(matchOffset + oldText.length);
    const startRef = fromLine <= toLine ? refs.from : refs.to;
    const endRef = fromLine <= toLine ? refs.to : refs.from;
    return {
        editParams: {
            remove_from: startRef.hash,
            remove_to: endRef.hash,
            replacement_lines: replacement,
        },
    };
}
export async function replaceWithinPreview(request, cwd, signal) {
    try {
        const normalized = normalizeReplaceWithinRequest(request);
        assertReplaceWithinReq(normalized);
        const req = normalized;
        const { refs, warnings } = parseWithinAnchors(req);
        await throwIfStrictInput(warnings);
        const targetPath = await resolveEditTargetWithRequirement({
            removeFrom: req.replace_from,
            removeTo: req.replace_to,
            providedPath: req.path,
            cwd,
        });
        const preload = await readNormFile(targetPath, cwd, {
            accessMode: constants.R_OK,
            maxLines: MAX_HASH_LINES,
            noPersist: true,
            allocation: "shadow",
            signal,
        });
        const plan = buildReplaceWithinEdit(req, refs, preload, targetPath);
        const pipe = await execPipeline(targetPath, plan.editParams, cwd, {
            accessMode: constants.R_OK,
            noPersist: true,
            preloadedNorm: preload,
            signal,
        });
        return previewFromPipe(pipe);
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return previewError(error);
    }
}
export function buildReplaceWithinToolDef(flags = DEFAULT_EDIT_FLAGS) {
    const prompted = withReplaceWithinPrompts({
        description: loadP("../prompts/replace-within.md"),
        snippet: loadP("../prompts/replace-within-snippet.md"),
        guidelines: loadGuide("../prompts/replace-within-guidelines.md"),
    }, flags);
    return {
        name: "replace_within",
        label: "Replace Within",
        description: prompted.description,
        promptSnippet: prompted.snippet,
        promptGuidelines: prompted.guidelines,
        ...editToolBase,
        prepareArguments: normalizeReplaceWithinRequest,
        parameters: buildReplaceWithinToolSchema(flags.requirePath),
        renderCall: makeRenderCall(replaceWithinPreview, {
            getInput: getReplaceWithinInput,
            toolName: "replace_within",
            resolveTarget: (input) => (typeof input.replace_from === "string" ? tryResolveEditTarget(input.replace_from, input.replace_to) : undefined),
        }),
        renderResult: editRenderResultWrapper,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            return withAnchorSession(ctx, async () => {
                const normalized = normalizeReplaceWithinRequest(params);
                assertReplaceWithinReq(normalized);
                const req = normalized;
                const { refs, warnings } = parseWithinAnchors(req);
                await throwIfStrictInput(warnings);
                const hints = [...literalEscapeHints([req.replace_old], "replace_old"), ...literalEscapeHints([req.replace_new], "replace_new")];
                const targetPath = await resolveEditTargetWithRequirement({
                    removeFrom: req.replace_from,
                    removeTo: req.replace_to,
                    providedPath: req.path,
                    cwd: ctx.cwd,
                });
                return queuedEdit(targetPath, ctx.cwd, signal, async (absolutePath, mutationTargetPath) => {
                    const preload = await readNormFile(targetPath, ctx.cwd, {
                        signal,
                        accessMode: constants.R_OK | constants.W_OK,
                        maxLines: MAX_HASH_LINES,
                    });
                    let plan;
                    try {
                        plan = buildReplaceWithinEdit(req, refs, preload, targetPath);
                    }
                    catch (error) {
                        await noteAnchorError(preload.absolutePath, error);
                        throw error;
                    }
                    const pipe = await execPipeline(targetPath, plan.editParams, ctx.cwd, {
                        accessMode: constants.R_OK | constants.W_OK,
                        signal,
                        preloadedNorm: preload,
                    });
                    return commitEdit(pipe, {
                        path: pipe.path,
                        absolutePath,
                        mutationTargetPath,
                        editAnchors: [plan.editParams.remove_from, plan.editParams.remove_to],
                        prefixWarnings: [...warnings, ...hints],
                        signal,
                        verb: "replaced",
                        noopNoun: "Replacement",
                    });
                });
            });
        },
    };
}
export function regReplaceWithin(pi, flags = DEFAULT_EDIT_FLAGS) {
    pi.registerTool(buildReplaceWithinToolDef(flags));
}
