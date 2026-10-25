import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectSupportedFiles, resolveRoot, resolveSupportedFile } from "./files.js";
import { LspClient } from "./lsp-client.js";
import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits, OMA_MAX_WORKSPACE_EDITS, OMA_MAX_WORKSPACE_EDIT_BYTES } from "./text-edits.js";
// OMA divergence: pull-path diagnostics are flagged-truncated by the same
// helper the pushed store uses (lsp-client.js) -- a flood answers with a
// visibly cut list, not a thrown call. omaIsMarker keeps OMA's own
// annotations out of the codeAction context the server sees; the error
// marker names a file whose own request failed.
import { omaFlaggedDiagnostics, omaIsMarker, omaMarkerDiagnostic } from "./lsp-client.js";
export const DEFAULT_FILE_LIMIT = 50;
export async function runDiagnostics(adapter, params, timeoutMs, signal, ctx, statusKey) {
    throwIfAborted(signal, adapter);
    const root = resolveRoot(params.root);
    const command = adapter.defaultCommand;
    const files = params.files ?? collectSupportedFiles(adapter, root, params.paths, params.limit ?? DEFAULT_FILE_LIMIT);
    if (files.length === 0) {
        return textResult(`${adapter.name} LSP found no supported files to check.`, {
            root,
            command,
            files: [],
            summary: { files: 0, diagnostics: 0 },
        });
    }
    return withLspClient(adapter, root, timeoutMs, signal, ctx, statusKey, "diagnostics", async (client) => {
        const openedFiles = [];
        try {
            for (const file of files) {
                throwIfAborted(signal, adapter);
                const uri = pathToFileURL(file).href;
                const text = readFileSync(file, "utf8");
                // OMA divergence: the write's own backpressure signal is
                // honored -- when stdin buffered the frame the loop waits
                // for 'drain' (bounded by the request budget and settled
                // by an abort through close()) instead of materializing
                // the whole corpus in this process's memory. A drain or
                // write failure still reports as the abort when the
                // caller aborted the call.
                try {
                    if (client.didOpen(uri, text, adapter.languageIdFor(file)) === false)
                        await client.didDrain();
                }
                catch (error) {
                    throwIfAborted(signal, adapter);
                    throw error;
                }
                openedFiles.push({ file, uri });
            }
            // OMA divergence: every file's request settles independently
            // -- one slow or failed file degrades to a per-file error
            // marker and the completed files keep their real diagnostics.
            // The call is refused only by the caller's abort
            // (throwIfAborted below), never by one file's timeout alone.
            const settled = await Promise.allSettled(openedFiles.map(({ uri }) => client.diagnostics(uri)));
            const entries = settled.map((outcome, index) => {
                const { file, uri } = openedFiles[index];
                const diagnostics = outcome.status === "fulfilled"
                    ? omaFlaggedDiagnostics(outcome.value)
                    : [omaMarkerDiagnostic(`diagnostics failed for this file: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`, "oma/error", 1)];
                return { path: path.relative(root, file) || file, uri, diagnostics };
            });
            throwIfAborted(signal, adapter);
            return textResult(formatDiagnostics(adapter, entries), {
                root,
                command,
                files: entries,
                summary: summarize(entries),
            });
        }
        finally {
            for (const { uri } of openedFiles)
                client.didClose(uri);
        }
    });
}
export async function runFix(adapter, params, timeoutMs, signal, ctx, statusKey) {
    const root = resolveRoot(params.root);
    const file = resolveSupportedFile(adapter, root, params.path);
    const actionKind = params.kind?.trim() || "source.fixAll";
    return withLspClient(adapter, root, timeoutMs, signal, ctx, statusKey, "fix", async (client) => {
        const uri = pathToFileURL(file).href;
        const text = readFileSync(file, "utf8");
        client.didOpen(uri, text, adapter.languageIdFor(file));
        let resolvedActions;
        let selectedActions;
        let edits;
        let newText;
        try {
            const diagnostics = omaFlaggedDiagnostics(await client.diagnostics(uri));
            throwIfAborted(signal, adapter);
            // OMA divergence: every oma/ prefixed marker is OMA's own
            // annotation -- truncation flags AND per-file error markers --
            // and none are ever sent to the server inside the codeAction
            // context.
            const actions = await client.codeActions(uri, text, diagnostics.filter((entry) => !omaIsMarker(entry)), actionKind);
            throwIfAborted(signal, adapter);
            resolvedActions = await client.resolveActions(actions);
            throwIfAborted(signal, adapter);
            selectedActions = selectCodeActions(resolvedActions, actionKind);
            // OMA divergence: the accumulated list is bounded across ALL
            // selected actions, not only per action -- and it is counted as
            // it accumulates, so an over-bound action set fails that one
            // request before the whole list is materialized. Refusal, not
            // truncation: a cut edit list would fabricate a corrupt fix.
            edits = [];
            let editBytes = 0;
            for (const action of selectedActions) {
                const collected = collectWorkspaceEdits(action.edit, uri);
                if (edits.length + collected.length > OMA_MAX_WORKSPACE_EDITS)
                    throw new Error(`${adapter.name} LSP returned ${edits.length + collected.length} accumulated workspace edits; OMA's bound is ${OMA_MAX_WORKSPACE_EDITS}.`);
                for (const edit of collected) {
                    editBytes += typeof edit?.newText === "string" ? edit.newText.length : 0;
                    if (editBytes > OMA_MAX_WORKSPACE_EDIT_BYTES)
                        throw new Error(`${adapter.name} LSP returned more than ${OMA_MAX_WORKSPACE_EDIT_BYTES} accumulated workspace edit bytes; OMA's bound was exceeded.`);
                }
                edits.push(...collected);
            }
            if (hasOverlappingTextEdits(text, edits)) {
                const relativePath = path.relative(root, file) || file;
                throw new Error(`${adapter.name} LSP returned overlapping code-action edits for ${relativePath}; ` +
                    "use a narrower action kind.");
            }
            newText = applyTextEdits(text, edits);
        }
        finally {
            client.didClose(uri);
        }
        const changed = newText !== text;
        throwIfAborted(signal, adapter);
        if (params.write && changed)
            writeFileSync(file, newText);
        return textResult(formatEditSummary(adapter, "fix", root, file, changed, params.write, newText), {
            path: path.relative(root, file) || file,
            uri,
            changed,
            write: params.write ?? false,
            kind: actionKind,
            actions: resolvedActions.map(({ title, kind }) => ({ title, kind })),
            appliedActions: selectedActions.map(({ title, kind }) => ({ title, kind })),
            edits,
            text: params.write ? undefined : newText,
        });
    });
}
async function withLspClient(adapter, root, timeoutMs, signal, ctx, statusKey, activity, operation) {
    throwIfAborted(signal, adapter);
    const client = new LspClient(adapter, adapter.defaultCommand, root, timeoutMs);
    const abort = () => client.close();
    signal?.addEventListener("abort", abort, { once: true });
    let cleanupFailure;
    let result;
    try {
        ctx.ui.setStatus(statusKey, `${adapter.name} ${activity}`);
        throwIfAborted(signal, adapter);
        await client.start();
        throwIfAborted(signal, adapter);
        await client.initialize(root);
        throwIfAborted(signal, adapter);
        result = await operation(client);
    }
    finally {
        clearStatus(ctx, statusKey);
        try {
            await client.shutdown();
        }
        catch (error) {
            cleanupFailure = { error };
        }
        finally {
            signal?.removeEventListener("abort", abort);
        }
    }
    // An operation rejection already propagates through finally and remains primary.
    if (cleanupFailure)
        throw cleanupFailure.error;
    throwIfAborted(signal, adapter);
    return result;
}
export function clearStatus(ctx, statusKey) {
    try {
        ctx.ui.setStatus(statusKey, undefined);
    }
    catch {
        // UI may be unavailable during teardown; it must never bypass resource cleanup.
    }
}
function selectCodeActions(actions, requestedKind) {
    return actions.filter((action) => action.kind === requestedKind || action.kind?.startsWith(`${requestedKind}.`));
}
function formatDiagnostics(adapter, entries) {
    const lines = entries.flatMap((entry) => {
        if (entry.diagnostics.length === 0)
            return [`${entry.path}: no diagnostics`];
        return entry.diagnostics.map((diagnostic) => {
            const line = diagnostic.range.start.line + 1;
            const column = diagnostic.range.start.character + 1;
            const severity = severityName(diagnostic.severity);
            const source = diagnostic.source ?? adapter.name;
            const code = diagnostic.code === undefined ? "" : ` ${diagnostic.code}`;
            return `${entry.path}:${line}:${column}: ${severity} ${source}${code}: ${diagnostic.message}`;
        });
    });
    const summary = summarize(entries);
    return [
        `${adapter.name} LSP diagnostics: ${summary.diagnostics} diagnostic(s) across ${summary.files} file(s).`,
        "",
        ...lines,
    ].join("\n");
}
function formatEditSummary(adapter, action, root, file, changed, write, text) {
    const relativePath = path.relative(root, file) || file;
    const status = changed ? (write ? "updated" : "computed changes for") : "left unchanged";
    const summary = `${adapter.name} LSP ${action} ${status} ${relativePath}.`;
    if (write || !changed)
        return summary;
    return `${summary}\n\n${text}`;
}
function summarize(entries) {
    return {
        files: entries.length,
        diagnostics: entries.reduce((total, entry) => total + entry.diagnostics.length, 0),
    };
}
function severityName(severity) {
    if (severity === 1)
        return "error";
    if (severity === 2)
        return "warning";
    if (severity === 3)
        return "info";
    if (severity === 4)
        return "hint";
    return "diagnostic";
}
function throwIfAborted(signal, adapter) {
    if (signal?.aborted)
        throw new Error(`${adapter.name} LSP request aborted.`);
}
export function textResult(text, details) {
    return {
        content: [{ type: "text", text }],
        details,
    };
}
