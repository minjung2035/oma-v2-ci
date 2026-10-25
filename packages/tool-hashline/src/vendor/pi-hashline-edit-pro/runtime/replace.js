import { constants } from "node:fs";
import { genDiff, } from "./replace-diff.js";
import { readNormFile } from "./file-reader.js";
import { editToolSchema, buildEditToolSchema, assertReq, normReq } from "./payload-contract.js";
import { literalEscapeHints, splitLines } from "./utils.js";
import { loadP, loadGuide } from "./prompts.js";
import { applyEdit, lineHashes, resEdit, preserveDeletionSeparators, MAX_HASH_LINES, RangeStaleError, AnchorMismatchError, } from "./hashline/index.js";
import { loadHashStore } from "./hash-store.js";
import { adoptAnchors, servedForPath, withAnchorSession } from "./anchor-registry.js";
import { resolveTarget } from "./fs-write.js";
import { toCwd, toDisplayPath } from "./paths.js";
import { queuedEdit, editToolBase, editRenderCallWrapper, editRenderResultWrapper, resolveEditTargetWithRequirement, throwIfStrictInput, withReplacePrompts, DEFAULT_EDIT_FLAGS } from "./edit-common.js";
import { commitEdit } from "./commit.js";
import { batchMemberFor, executeBatchMember, noteBatchFailure } from "./batch.js";
export { editToolSchema, assertReq };
export function hashSpan(hashes, from, to) {
    const a = hashes.indexOf(from);
    const b = hashes.indexOf(to);
    if (a < 0 || b < 0)
        return undefined;
    return [Math.min(a, b), Math.max(a, b)];
}
export function spanForEdit(originalHashes, from, to, resultContent) {
    const span = hashSpan(originalHashes, from, to);
    if (!span)
        return undefined;
    const replacementCount = splitLines(resultContent).length - (originalHashes.length - (span[1] - span[0] + 1));
    return { start: span[0], end: span[1], replacementCount };
}
export async function noteAnchorError(absolutePath, error, noPersist) {
    if (noPersist === true)
        return;
    if (error instanceof RangeStaleError) {
        adoptAnchors(absolutePath, error.rangeServedMap);
    }
    else if (error instanceof AnchorMismatchError) {
        adoptAnchors(absolutePath, error.feedbackMap);
    }
}
function countLineChanges(edit, originalHashes, isNoop) {
    if (isNoop)
        return { totalAddedLines: 0, totalRemovedLines: 0 };
    const span = hashSpan(originalHashes, edit.hash_bounds[0].hash, edit.hash_bounds[1].hash);
    const totalRemovedLines = span ? span[1] - span[0] + 1 : 0;
    return {
        totalAddedLines: edit.content_lines.length,
        totalRemovedLines,
    };
}
export function buildReplaceHEdit(params) {
    const editWarnings = [];
    const anchors = { remove_from: params.remove_from, remove_to: params.remove_to };
    const edit = typeof params.replacement_lines === "string"
        ? resEdit({ ...anchors, replacement_lines: params.replacement_lines }, editWarnings)
        : resEdit({ ...anchors, replacement_lines: params.replacement_lines }, editWarnings);
    return { edit, warnings: editWarnings };
}
function withEndingOverrides(edit, overrides) {
    if (overrides === undefined)
        return edit;
    const length = Math.max(edit.content_separators?.length ?? 0, overrides.length);
    const separators = new Array(length);
    for (let index = 0; index < length; index++) {
        separators[index] = overrides[index] ?? edit.content_separators?.[index];
    }
    if (separators.every((ending) => ending === undefined))
        return edit;
    return { ...edit, content_separators: separators };
}
export async function execPipeline(targetPath, params, cwd, options) {
    const { edit, warnings: editWarnings } = buildReplaceHEdit(params);
    const anchoredEdit = withEndingOverrides(edit, options?.endingOverrides);
    const hashStore = options?.store ?? await loadHashStore();
    const preResolvedPath = await resolveTarget(toCwd(targetPath, cwd));
    const served = options?.served ?? servedForPath(preResolvedPath);
    const { normalized: originalNormalized, bom, originalEnding, endingSeparators: originalSeparators, fileHashes: originalHashes, hadUtf8DecodeErrors, absolutePath, identity } = await readNormFile(targetPath, cwd, { signal: options?.signal, accessMode: options?.accessMode, maxLines: MAX_HASH_LINES, store: hashStore, noPersist: options?.noPersist, allocation: options?.noPersist ? "shadow" : "real", preloadedNorm: options?.preloadedNorm });
    const displayPath = toDisplayPath(cwd, absolutePath, targetPath);
    const effectiveEdit = options?.preserveDeletionSeparators === false
        ? anchoredEdit
        : preserveDeletionSeparators(anchoredEdit, splitLines(originalNormalized), originalHashes);
    let anchorResult;
    try {
        anchorResult = applyEdit(originalNormalized, effectiveEdit, options?.signal, originalHashes, displayPath, served, options?.allowEmpty, options?.stripWarning);
    }
    catch (error) {
        await noteAnchorError(absolutePath, error, options?.noPersist);
        throw error;
    }
    const result = anchorResult.content;
    const isNoop = result === originalNormalized;
    const resultHashes = isNoop
        ? originalHashes
        : await lineHashes(result, absolutePath, {
            content: originalNormalized,
            hashes: originalHashes,
        }, hashStore, false, true);
    const warnings = [...editWarnings, ...(anchorResult.warnings ?? [])];
    await throwIfStrictInput(warnings);
    const { totalAddedLines, totalRemovedLines } = countLineChanges(effectiveEdit, originalHashes, isNoop);
    const pipeSpan = isNoop ? undefined : spanForEdit(originalHashes, effectiveEdit.hash_bounds[0].hash, effectiveEdit.hash_bounds[1].hash, result);
    const pipeSpans = pipeSpan ? [pipeSpan] : undefined;
    return {
        path: displayPath,
        originalNormalized,
        result,
        bom,
        originalEnding,
        originalSeparators,
        hadUtf8DecodeErrors,
        warnings,
        noopEdit: anchorResult.noopEdit,
        firstChangedLine: anchorResult.firstChangedLine,
        lastChangedLine: anchorResult.lastChangedLine,
        resultHashes,
        originalHashes,
        totalAddedLines,
        totalRemovedLines,
        identity,
        ...(pipeSpans ? { spans: pipeSpans } : {}),
        ...(effectiveEdit.content_separators !== undefined ? { contentSeparators: effectiveEdit.content_separators } : {}),
    };
}
export function previewFromPipe(pipe) {
    if (pipe.originalNormalized === pipe.result) {
        if (pipe.contentSeparators !== undefined) {
            return { diff: "", path: pipe.path };
        }
        return {
            error: `No changes made to ${pipe.path}. The edit produced identical content.`,
            path: pipe.path,
        };
    }
    const base = genDiff(pipe.originalNormalized, pipe.result, 4, pipe.resultHashes, pipe.originalHashes, undefined, pipe.spans);
    return { diff: base.diff, path: pipe.path };
}
export function previewError(error) {
    return { error: error instanceof Error ? error.message : String(error) };
}
export async function compPreview(request, cwd, signal) {
    try {
        const normalized = normReq(request);
        assertReq(normalized);
        const targetPath = await resolveEditTargetWithRequirement({
            removeFrom: normalized.remove_from,
            removeTo: normalized.remove_to,
            providedPath: normalized.path,
            cwd,
        });
        const pipe = await execPipeline(targetPath, normalized, cwd, { accessMode: constants.R_OK, noPersist: true, signal });
        return previewFromPipe(pipe);
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        return previewError(error);
    }
}
export function buildToolDef(flags = DEFAULT_EDIT_FLAGS) {
    const prompted = withReplacePrompts({
        description: loadP("../prompts/replace.md"),
        snippet: loadP("../prompts/replace-snippet.md"),
        guidelines: loadGuide("../prompts/replace-guidelines.md"),
    }, flags);
    const parameters = buildEditToolSchema(flags.requirePath);
    return {
        name: "replace",
        label: "Replace",
        description: prompted.description,
        parameters,
        promptSnippet: prompted.snippet,
        promptGuidelines: prompted.guidelines,
        ...editToolBase,
        renderCall: editRenderCallWrapper(compPreview),
        renderResult: editRenderResultWrapper,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            return withAnchorSession(ctx, async () => {
                const canonical = normReq(params);
                assertReq(canonical);
                const normalizedParams = canonical;
                const literalEscapes = literalEscapeHints([normalizedParams.replacement_lines], "replacement_lines");
                const targetPath = await resolveEditTargetWithRequirement({
                    removeFrom: normalizedParams.remove_from,
                    removeTo: normalizedParams.remove_to,
                    providedPath: normalizedParams.path,
                    cwd: ctx.cwd,
                }).catch((error) => {
                    const member = batchMemberFor(_toolCallId);
                    if (member)
                        noteBatchFailure(member, error);
                    throw error;
                });
                return queuedEdit(targetPath, ctx.cwd, signal, async (absolutePath, mutationTargetPath) => {
                    const member = batchMemberFor(_toolCallId);
                    if (!member) {
                        const pipe = await execPipeline(targetPath, normalizedParams, ctx.cwd, { accessMode: constants.R_OK | constants.W_OK, signal });
                        return await commitEdit(pipe, {
                            path: pipe.path,
                            absolutePath,
                            mutationTargetPath,
                            editAnchors: [normalizedParams.remove_from, normalizedParams.remove_to],
                            prefixWarnings: literalEscapes,
                            signal,
                        });
                    }
                    let built;
                    try {
                        built = buildReplaceHEdit(normalizedParams);
                    }
                    catch (error) {
                        noteBatchFailure(member, error);
                        throw error;
                    }
                    return executeBatchMember({
                        kind: "replace",
                        member,
                        targetPath,
                        mutationTargetPath,
                        cwd: ctx.cwd,
                        signal,
                        hedit: built.edit,
                        extraWarnings: [...literalEscapes, ...built.warnings],
                    });
                });
            });
        },
    };
}
export function regReplace(pi, flags = DEFAULT_EDIT_FLAGS) {
    pi.registerTool(buildToolDef(flags));
}
