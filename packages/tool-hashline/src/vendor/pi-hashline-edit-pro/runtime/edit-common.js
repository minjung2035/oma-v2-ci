import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { resolveInCwd } from "./fs-write.js";
import { abortIf, makePrepareArguments } from "./utils.js";
import { ownerOf, ownersDifferingOnlyByCase } from "./anchor-registry.js";
import { parseHashRef, stripAnchorRow } from "./hashline/index.js";
import { readConfig } from "./config.js";
import { makeRenderCall, renderEditResult } from "./replace-render.js";
export const editPrepare = makePrepareArguments();
export const DEFAULT_EDIT_FLAGS = {
    requirePath: false,
    strictInput: false,
    autoRead: true,
    autoReadAllActive: false,
    replaceWithinEnabled: true,
    copyMoveEnabled: true
};
export async function currentEditFlags() {
    const config = await readConfig();
    return {
        requirePath: config.requirePath === true,
        strictInput: config.strictInput === true,
        autoRead: config.autoRead !== false,
        autoReadAllActive: (config.autoReadAll ?? "off") !== "off",
        replaceWithinEnabled: config.replaceWithinEnabled !== false,
        copyMoveEnabled: config.copyMoveEnabled !== false
    };
}
function preferenceGuideline(flags) {
    const tools = gatedEditOps(["read", "replace", "replace_within", "insert", "copy", "move", "undo_last_change"], flags);
    return `Prefer the hashline tools for anything that touches files: ${joinOps(tools, { backtick: true })}.`;
}
export function withReplacePrompts(base, flags) {
    let description = base.description;
    const snippetParts = [base.snippet];
    let guidelines = [preferenceGuideline(flags), ...base.guidelines];
    if (!flags.autoRead) {
        description = description.replace(/\n\nExample:[\s\S]*$/, "");
        guidelines = guidelines.filter((guideline) => !guideline.includes("post-edit diff"));
        description = description.replace("and the last call shows the combined diff,", "and the last call shows the combined result,");
    }
    if (!flags.replaceWithinEnabled) {
        description = description.replace(/\n?To change only part of a line without retyping the rest, use `replace_within` instead; it preserves every character the request does not name\./, "");
    }
    const descriptionParts = [description];
    if (flags.requirePath) {
        descriptionParts.push("Also give `path` matching the file the anchors were served for; it is required and must match anchor ownership.");
        snippetParts.push("; include `path` (required)");
    }
    else {
        descriptionParts.push("Path resolution is anchor-only; do not pass `path`.");
    }
    if (flags.strictInput) {
        descriptionParts.push("Strict-input mode is on: auto-fixable slips are rejected instead of fixed with warnings.");
    }
    return { description: descriptionParts.join(" "), snippet: snippetParts.join(""), guidelines };
}
export function withReadPrompts(base, flags) {
    const preference = preferenceGuideline(flags);
    if (flags.autoReadAllActive) {
        const rewritten = base.guidelines
            .filter((guideline) => !guideline.includes("call again after an edit"));
        return { description: base.description, snippet: base.snippet, guidelines: [preference, ...rewritten] };
    }
    const withoutAutoReadAll = base.guidelines.filter((guideline) => !guideline.includes("E_AUTO_READ_ALL"));
    if (flags.autoRead)
        return { description: base.description, snippet: base.snippet, guidelines: [preference, ...withoutAutoReadAll] };
    const guidelines = [preference, ...withoutAutoReadAll];
    const mapped = guidelines.map((guideline) => guideline.startsWith("`read`: call again after an edit") ? "`read`: call again after an edit when you need anchors you lack." : guideline);
    return { description: base.description, snippet: base.snippet, guidelines: mapped };
}
export function withInsertPrompts(base, flags) {
    const baseDescription = flags.autoRead ? base.description : base.description.replace("and the last call shows the combined diff,", "and the last call shows the combined result,");
    const descriptionParts = [baseDescription];
    const snippetParts = [base.snippet];
    const guidelines = [...base.guidelines];
    if (flags.requirePath) {
        descriptionParts.push("Also give `path` matching the file the anchor was served for; it is required and must match anchor ownership.");
        snippetParts.push("; include `path` (required)");
    }
    else {
        descriptionParts.push("Path resolution is anchor-only; do not pass `path`.");
    }
    if (flags.strictInput) {
        descriptionParts.push("Strict-input mode is on: auto-fixable slips are rejected instead of fixed with warnings.");
    }
    return { description: descriptionParts.join(" "), snippet: snippetParts.join(""), guidelines };
}
export function withReplaceWithinPrompts(base, flags) {
    const descriptionParts = [base.description];
    const snippetParts = [base.snippet];
    const guidelines = [...base.guidelines];
    if (flags.requirePath) {
        descriptionParts.push("Also give `path` matching the file the anchors were served for; it is required and must match anchor ownership.");
        snippetParts.push("; include `path` (required)");
    }
    else {
        descriptionParts.push("Path resolution is anchor-only; do not pass `path`.");
    }
    if (flags.strictInput) {
        descriptionParts.push("Strict-input mode is on: auto-fixable slips are rejected instead of fixed with warnings.");
    }
    return { description: descriptionParts.join(" "), snippet: snippetParts.join(""), guidelines };
}
function gatedEditOps(ops, flags) {
    return ops.filter((op) => {
        if (op === "replace_within")
            return flags.replaceWithinEnabled;
        if (op === "copy" || op === "move")
            return flags.copyMoveEnabled;
        return true;
    });
}
function joinOps(ops, options) {
    const formatted = ops.map((op) => (options?.backtick ? `\`${op}\`` : op));
    if (options?.separator === "/")
        return formatted.join("/");
    if (formatted.length <= 1)
        return formatted[0] ?? "";
    const last = formatted[formatted.length - 1];
    const head = formatted.slice(0, -1).join(", ");
    return formatted.length === 2 ? `${head} or ${last}` : `${head}, or ${last}`;
}
export function withGrepPrompts(base, flags) {
    if (flags.copyMoveEnabled)
        return base;
    return { ...base, description: base.description.replaceAll("replace, insert, copy, or move", joinOps(gatedEditOps(["replace", "insert", "copy", "move"], flags))) };
}
export function withUndoPrompts(base, flags) {
    const ops = gatedEditOps(["replace", "replace_within", "insert", "copy", "move"], flags);
    let description = base.description;
    let snippet = base.snippet;
    let guidelines = [...base.guidelines];
    if (!flags.autoRead) {
        guidelines = guidelines.map((guideline) => guideline.includes("bad diff") ? "`undo_last_change`: only the last `replace`/`replace_within`/`insert`/`copy`/`move` per file is undoable; a `write` clears it, so undo right after a bad edit — review what you're restoring." : guideline);
    }
    if (ops.length !== 5) {
        description = description.replaceAll("replace, replace_within, insert, copy, or move", joinOps(ops));
        snippet = snippet.replaceAll("`replace`, `replace_within`, `insert`, `copy`, or `move`", joinOps(ops, { backtick: true }));
        guidelines = guidelines.map((guideline) => guideline.replaceAll("`replace`/`replace_within`/`insert`/`copy`/`move`", joinOps(ops, { backtick: true, separator: "/" })));
    }
    if (!flags.copyMoveEnabled) {
        guidelines = guidelines.filter((guideline) => !guideline.includes("cross-file `move`"));
    }
    return { description, snippet, guidelines };
}
export function withTransferPrompts(base, flags) {
    const descriptionParts = [base.description];
    const snippetParts = [base.snippet];
    const guidelines = [...base.guidelines];
    if (flags.requirePath) {
        descriptionParts.push("Also give `path` matching the source or destination file the anchors were served for; it is required and must match anchor ownership.");
        snippetParts.push("; include `path` (required)");
    }
    else {
        descriptionParts.push("Path resolution is anchor-only; do not pass `path`.");
    }
    if (flags.strictInput) {
        descriptionParts.push("Strict-input mode is on: auto-fixable slips are rejected instead of fixed with warnings.");
    }
    return { description: descriptionParts.join(" "), snippet: snippetParts.join(""), guidelines };
}
function staleAnchorMessage(ref, hash, owners) {
    const knownPaths = new Set();
    for (const owner of owners) {
        if (owner)
            knownPaths.add(owner.path);
    }
    const folded = ownersDifferingOnlyByCase(hash, knownPaths);
    const hint = folded.length > 0
        ? ` Anchors are case-sensitive; ${folded.map((match) => `"${match.anchor}"`).join(", ")} differs only in case.`
        : "";
    return `[E_STALE_ANCHOR] "${ref}" is not owned in this session.${hint} Call read() on the target file first.`;
}
export function resolveEditTarget(removeFrom, removeTo) {
    const refs = [removeFrom, removeTo].filter((value) => typeof value === "string");
    const hashes = refs.map((ref) => parseHashRef(stripAnchorRow(ref.trim(), "anchor entry")).hash);
    const owners = hashes.map((hash) => ownerOf(hash));
    const missing = owners.findIndex((owner) => !owner);
    if (missing >= 0) {
        throw new Error(staleAnchorMessage(refs[missing], hashes[missing], owners));
    }
    const paths = new Set(owners.map((owner) => owner.path));
    if (paths.size > 1) {
        throw new Error(`[E_BAD_SHAPE] The anchors are owned by different files (${owners.map((owner) => owner.path).join(", ")}); edit one file per call.`);
    }
    return owners[0].path;
}
export function tryResolveEditTarget(removeFrom, removeTo) {
    if (typeof removeFrom !== "string")
        return undefined;
    try {
        return resolveEditTarget(removeFrom, removeTo);
    }
    catch {
        return undefined;
    }
}
export async function resolveEditTargetWithRequirement(input) {
    const { requirePath } = await readConfig();
    if (!requirePath && input.providedPath !== undefined) {
        throw new Error("[E_BAD_SHAPE] Edit request contains unknown or unsupported fields: path. Path resolution is anchor-only; retry without `path`.");
    }
    if (requirePath && (typeof input.providedPath !== "string" || input.providedPath.length === 0)) {
        throw new Error('[E_BAD_SHAPE] Edit request requires a non-empty "path" string when require-path mode is on. Provide `path` matching the file the anchors were served for.');
    }
    const anchorTarget = typeof input.anchor === "string"
        ? resolveEditTarget(input.anchor)
        : resolveEditTarget(input.removeFrom, input.removeTo);
    if (requirePath) {
        const { resolved } = await resolveInCwd(input.providedPath, input.cwd);
        if (resolved !== anchorTarget) {
            throw new Error(`[E_BAD_SHAPE] Provided "path" "${input.providedPath}" does not match anchor ownership "${anchorTarget}".`);
        }
    }
    return anchorTarget;
}
const AUTO_FIX_WARNING_CODES = ["[W_BAD_SHAPE]", "[W_BAD_REF]", "[W_INVALID_PATCH]", "[W_BARE_HASH_PREFIX]"];
export async function throwIfStrictInput(warnings) {
    const fixes = warnings.filter((warning) => AUTO_FIX_WARNING_CODES.some((code) => warning.startsWith(code)));
    if (fixes.length === 0)
        return;
    const { strictInput } = await readConfig();
    if (strictInput === true) {
        throw new Error(`[E_BAD_SHAPE] Strict-input mode rejects auto-fixable input:\n${fixes.join("\n")}`);
    }
}
export function editRenderCallWrapper(preview, getInput, toolName) {
    return makeRenderCall(preview, {
        getInput,
        toolName,
        resolveTarget: (input) => {
            if (typeof input.remove_from === "string")
                return tryResolveEditTarget(input.remove_from, input.remove_to);
            if (typeof input.anchor === "string")
                return tryResolveEditTarget(input.anchor);
            return undefined;
        },
    });
}
export function editRenderResultWrapper(result, opts, theme, context) {
    return renderEditResult(result, opts, theme, context);
}
export const editToolBase = {
    prepareArguments: editPrepare,
    executionMode: "sequential",
    renderShell: "default",
};
export async function queuedEdit(path, cwd, signal, work) {
    abortIf(signal);
    const { absolute, resolved } = await resolveInCwd(path, cwd);
    return withFileMutationQueue(resolved, async () => {
        abortIf(signal);
        return work(absolute, resolved);
    });
}
