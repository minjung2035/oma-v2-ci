import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { commandPathValue, mergeEnvironment, resolveCommandPath } from "./command.js";
import { directoryUri } from "./files.js";
import { positionAt } from "./text-edits.js";
export function resolveSpawnCommand(command, platform = process.platform, comSpec = process.env.ComSpec) {
    if (platform !== "win32" || !/\.(?:bat|cmd)$/i.test(command.command))
        return command;
    return {
        command: comSpec?.trim() || "cmd.exe",
        args: ["/d", "/s", "/c", command.command, ...command.args],
    };
}
// Quiet period (ms) after each publish before treating push diagnostics as settled.
const PUBLISHED_DIAGNOSTICS_SETTLE_MS = 800;
const PROCESS_EXIT_GRACE_MS = 500;
// OMA divergences (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json). A bound is honest
// degradation: a request is refused with the bound named, a list is
// truncated with a marker and count -- the server is never killed for a
// single oversized result and a drop is never silent.
const OMA_MAX_STDERR_CHARS = 64 * 1024;
const OMA_MAX_INBOUND_FRAME_BYTES = 4 * 1024 * 1024;
const OMA_MAX_DIAGNOSTICS_PER_FILE = 1024;
const OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS = 8 * 1024;
const OMA_MAX_DIAGNOSTIC_URIS = 4096;
// OMA divergence: every inbound frame chunk is reported to registered
// sinks with the serving client's adapter -- the per-call progress
// signal the adapter's stall window resets on, replacing the fixed
// aggregate deadline that could abort a still-working call.
const omaInboundSinks = new Set();
export function omaOnInboundFrame(sink) {
    omaInboundSinks.add(sink);
    return () => {
        omaInboundSinks.delete(sink);
    };
}
// OMA divergence: a truncation marker is itself a diagnostic, so it
// renders in the same output the kept entries do -- a cut list can
// never pass as complete. The oma/ code prefix is what a second
// flagging pass (and the codeAction context below) recognizes: markers
// are not counted as diagnostics again and are never sent to the
// server. The code and severity specialize the marker -- "oma/error"
// marks one file's own failed request (the per-file degrade in
// runner.js).
export function omaMarkerDiagnostic(text, code = "oma/truncation", severity = 3) {
    return { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity, source: "oma", code, message: `[oma: ${text}]` };
}
export function omaIsMarker(diagnostic) {
    return diagnostic?.source === "oma" && typeof diagnostic?.code === "string" && diagnostic.code.startsWith("oma/");
}
// A message an earlier pass already cut ends with this tail -- cutting it
// again would slice the marker off and re-report the truncated length as
// the original, lying about both the text kept and the total dropped.
const OMA_MESSAGE_TRUNCATION_TAIL = / \[truncated at OMA's \d+-char bound; \d+ chars total\]$/;
// OMA divergence: bound a diagnostics list by truncating WITH markers --
// the first entries stay, an element names how many were dropped, and
// each over-long message is cut with its original length. Never a
// refusal and never a silent drop. Idempotent: a pushed-store list is
// already flagged (real diagnostics plus a tail marker, messages already
// cut), so re-flagging must not count the marker again nor re-cut a
// message -- the drop counts the markers report are the point and
// re-truncating would lie. A resolved list can already end in MORE than
// one marker (the stored truncation marker plus the URI-drop marker
// appended at settle time), so every trailing marker is stripped before
// counting: counting only the last one re-counted the earlier marker as
// a real diagnostic, invented a false "1 more" drop and sliced the real
// markers off the kept prefix. Prior markers also ride after a fresh
// truncation so their own counts are never erased.
export function omaFlaggedDiagnostics(list, bound = OMA_MAX_DIAGNOSTICS_PER_FILE) {
    let flagged = Array.isArray(list) ? list : [];
    let realCount = flagged.length;
    while (realCount > 0 && omaIsMarker(flagged[realCount - 1])) realCount -= 1;
    if (realCount > bound)
        flagged = [...flagged.slice(0, bound),
            omaMarkerDiagnostic(`${realCount - bound} more diagnostic(s) for this file were dropped at OMA's ${bound}-diagnostic bound`),
            ...flagged.slice(realCount)];
    return flagged.map(diagnostic => typeof diagnostic?.message === "string" && diagnostic.message.length > OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS
        && !OMA_MESSAGE_TRUNCATION_TAIL.test(diagnostic.message)
        ? { ...diagnostic, message: `${diagnostic.message.slice(0, OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS)} [truncated at OMA's ${OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS}-char bound; ${diagnostic.message.length} chars total]` }
        : diagnostic);
}
// OMA divergence: the stderr bound as a pure function so the rule is
// testable and the dropped state is explicit. A sample that lands exactly
// on the bound dropped nothing yet; the NEXT chunk is what marks it --
// length alone could not tell those two states apart, which is how the
// first version silently dropped bytes after an exact landing.
export function appendStderrSample(state, text) {
    if (state.dropped)
        return state;
    if (state.sample.length >= OMA_MAX_STDERR_CHARS)
        return { sample: `${state.sample}\n[stderr truncated at OMA's ${OMA_MAX_STDERR_CHARS}-char bound]`, dropped: true };
    const next = state.sample + text;
    if (next.length <= OMA_MAX_STDERR_CHARS)
        return { sample: next, dropped: false };
    return { sample: `${next.slice(0, OMA_MAX_STDERR_CHARS)}\n[stderr truncated at OMA's ${OMA_MAX_STDERR_CHARS}-char bound]`, dropped: true };
}
// Key diagnostics by a canonical path: a server may answer using a different but
// equivalent encoding of the URI the client sent. marksman, like VS Code, sends
// `file:///c%3A/dir/a.md` where pathToFileURL produces `file:///C:/dir/a.md`.
// normalize() also collapses the doubled separators a URI may carry.
// Non-file URIs such as untitled: and jdt: keep their original text.
function documentKey(uri) {
    try {
        const filePath = path.normalize(fileURLToPath(uri));
        return process.platform === "win32" ? filePath.toLowerCase() : filePath;
    }
    catch {
        return uri;
    }
}
export class LspClient {
    #child;
    #process;
    #processExit;
    #buffer = Buffer.alloc(0);
    #nextId = 1;
    #pending = new Map();
    #publishedDiagnostics = new Map();
    #diagnosticWaiters = new Map();
    #stderr = "";
    // OMA divergence: whether stderr bytes were ever refused, tracked
    // separately from the sample's length (see appendStderrSample).
    #stderrDropped = false;
    // OMA divergence: bytes of an oversized frame's body still owed to
    // the discarder. While >0 inbound bytes feed the dropped frame in
    // bounded memory and the parser resumes at the frame's end; a
    // shutdown handshake mid-discard could not be trusted.
    #discardRemaining = 0;
    // OMA divergence: inbound frames dropped without a pending request to
    // refuse (a notification, or an id past the sniffed prefix). The
    // count rides every error tail so the drop is never silent.
    #droppedInboundFrames = 0;
    // OMA divergence: pushed publications refused by the tracked-document
    // bound; the count is flagged into resolved diagnostics lists.
    #droppedDiagnosticUris = 0;
    #serverCapabilities = {};
    #adapter;
    #command;
    #cwd;
    #timeoutMs;
    constructor(adapter, command, cwd, timeoutMs) {
        this.#adapter = adapter;
        this.#command = command;
        this.#cwd = cwd;
        this.#timeoutMs = timeoutMs;
    }
    async start() {
        const commandPath = resolveCommandPath(this.#command.command, this.#cwd, process.platform, commandPathValue(this.#adapter.env));
        if (!commandPath) {
            throw new Error(`${this.#adapter.name} LSP command not found: ${this.#command.command}. ${this.#adapter.missingCommandHint}`);
        }
        const spawnCommand = resolveSpawnCommand({ ...this.#command, command: commandPath });
        const child = spawn(spawnCommand.command, spawnCommand.args, {
            cwd: this.#cwd,
            env: mergeEnvironment(this.#adapter.env),
            stdio: "pipe",
        });
        this.#child = child;
        this.#process = child;
        this.#processExit = new Promise((resolve) => {
            const finish = () => {
                child.off("exit", finish);
                child.off("close", finish);
                resolve();
            };
            child.once("exit", finish);
            child.once("close", finish);
        });
        child.stdout.on("data", (chunk) => {
            try {
                this.#onData(chunk);
            }
            catch (error) {
                this.#fail(`${this.#adapter.name} LSP server sent invalid JSON-RPC data: ${formatErrorMessage(error)}.${this.#formatStderr()}`);
            }
        });
        child.stderr.on("data", (chunk) => {
            // OMA divergence: stderr is a bounded sample, not an accumulator.
            const next = appendStderrSample({ sample: this.#stderr, dropped: this.#stderrDropped }, chunk.toString());
            this.#stderr = next.sample;
            this.#stderrDropped = next.dropped;
        });
        child.stdin.on("error", (error) => {
            this.#fail(`${this.#adapter.name} LSP stdin write failed: ${formatErrorMessage(error)}.${this.#formatStderr()}`);
        });
        child.once("exit", (code, signal) => {
            if (this.#child === child)
                this.#child = undefined;
            if (this.#process === child)
                this.#process = undefined;
            const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
            this.#rejectPending((id) => `${this.#adapter.name} LSP server exited before response ${id} (${reason}).${this.#formatStderr()}`);
        });
        // OMA divergence: the child and its stdio keep 'error' listeners
        // for the process's whole life. Upstream's startup once("error")
        // only covered the first failure and the stdio streams had none at
        // all, so a post-start error escaped as an unhandled 'error' event
        // and crashed the engine. The permanent handler below keeps the
        // same cleanup; the startup promise keeps its spawn-failure reject.
        // An 'error' event does not by itself stop the child -- clearing
        // the refs alone made shutdown() return early and orphaned the
        // process, so the handler kills before it clears.
        child.on("error", (error) => {
            const message = `${this.#adapter.name} LSP server process error: ${error.message}.${this.#formatStderr()}`;
            this.#rejectPending(message);
            if (!child.killed)
                child.kill("SIGKILL");
            if (this.#child === child)
                this.#child = undefined;
            if (this.#process === child)
                this.#process = undefined;
        });
        child.stdout.on("error", () => this.#fail(`${this.#adapter.name} LSP stdout failed.${this.#formatStderr()}`));
        child.stderr.on("error", () => this.#fail(`${this.#adapter.name} LSP stderr failed.${this.#formatStderr()}`));
        await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", (error) => {
                reject(new Error(`${this.#adapter.name} LSP process failed to start: ${error.message}.${this.#formatStderr()}`));
            });
        });
    }
    async initialize(root) {
        const rootUri = directoryUri(root);
        const workspaceFolders = [{ uri: rootUri, name: path.basename(root) || "workspace" }];
        const response = await this.request("initialize", {
            processId: process.pid,
            rootUri,
            workspaceFolders,
            initializationOptions: this.#adapter.initialization ?? {},
            capabilities: {
                textDocument: {
                    // This spawn-per-call client can't track dynamic registrations, so
                    // capabilities must be advertised statically.
                    codeAction: {
                        dynamicRegistration: false,
                        resolveSupport: { properties: ["edit"] },
                    },
                    diagnostic: { dynamicRegistration: false, relatedDocumentSupport: true },
                    publishDiagnostics: {},
                    synchronization: { didSave: true },
                },
                workspace: {
                    configuration: true,
                    workspaceEdit: { documentChanges: true },
                    workspaceFolders: true,
                },
            },
        });
        this.#serverCapabilities =
            response.result?.capabilities ?? {};
        this.notify("initialized", {});
        if (this.#adapter.initialization) {
            this.notify("workspace/didChangeConfiguration", { settings: this.#adapter.initialization });
        }
    }
    didOpen(uri, text, languageId) {
        // OMA divergence: return stdin's backpressure signal -- false
        // means the stream buffered the frame, and the open loop must
        // await didDrain() before writing the next file instead of
        // piling the whole corpus into this process's memory.
        return this.notify("textDocument/didOpen", {
            textDocument: { uri, languageId, version: 1, text },
        });
    }
    // OMA divergence: settle a backpressured write -- resolves on the
    // stream's 'drain', rejects on stdin 'error'/'close' (close() kills
    // the child and ends the stream, so a caller abort still settles the
    // wait), and rejects on the same request budget so a server that
    // never drains is a detected timeout, not a hang.
    didDrain() {
        const stdin = this.#child?.stdin;
        if (stdin === undefined)
            return Promise.reject(new Error(`${this.#adapter.name} LSP server is not running.`));
        if (stdin.destroyed || stdin.closed)
            return Promise.reject(new Error(`${this.#adapter.name} LSP stdin is closed -- the server process is gone.${this.#formatStderr()}`));
        if (stdin.writableLength === 0 && !stdin.writableNeedDrain)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = (error) => {
                clearTimeout(timer);
                stdin.off("drain", onDrain);
                stdin.off("error", onError);
                stdin.off("close", onClose);
                if (error === undefined)
                    resolve();
                else
                    reject(error);
            };
            const onDrain = () => finish();
            const onError = (error) => finish(new Error(`${this.#adapter.name} LSP stdin failed while awaiting drain: ${formatErrorMessage(error)}.${this.#formatStderr()}`));
            const onClose = () => finish(new Error(`${this.#adapter.name} LSP stdin closed before buffered writes drained.${this.#formatStderr()}`));
            const timer = setTimeout(() => finish(new Error(`${this.#adapter.name} LSP stdin did not drain within ${this.#timeoutMs}ms -- the server is not reading.${this.#formatStderr()}`)), this.#timeoutMs);
            stdin.once("drain", onDrain);
            stdin.once("error", onError);
            stdin.once("close", onClose);
            if (stdin.destroyed || stdin.closed)
                onClose();
            else if (stdin.writableLength === 0 && !stdin.writableNeedDrain)
                onDrain();
        });
    }
    didClose(uri) {
        if (!this.#child)
            return false;
        this.notify("textDocument/didClose", {
            textDocument: { uri },
        });
        return true;
    }
    async diagnostics(uri) {
        // Only pull if the server advertised it; otherwise use push diagnostics.
        if (!this.#serverCapabilities.diagnosticProvider) {
            return this.#waitForPublishedDiagnostics(uri, this.#adapter.pushDiagnosticsGraceMs
                ? {
                    afterVersion: 0,
                    diagnostics: [],
                    waitMs: this.#adapter.pushDiagnosticsGraceMs,
                }
                : undefined);
        }
        const published = this.#publishedDiagnostics.get(documentKey(uri));
        // Ignore a provisional empty publish, but preserve diagnostics that arrived before the pull.
        const afterVersion = published?.diagnostics.length ? published.version - 1 : (published?.version ?? 0);
        const response = await this.request("textDocument/diagnostic", {
            textDocument: { uri },
        });
        const result = response.result;
        const diagnostics = result?.items ?? [];
        if (diagnostics.length > 0 || !this.#adapter.pullDiagnosticsGraceMs)
            // OMA divergence: the pull path's early return carries the
            // same URI-bound drop marker the settle path appends -- a
            // non-empty answer never hides dropped pushed publications.
            return this.#withDroppedUriFlag(diagnostics);
        return this.#waitForPublishedDiagnostics(uri, {
            afterVersion,
            diagnostics,
            waitMs: this.#adapter.pullDiagnosticsGraceMs,
        });
    }
    async codeActions(uri, text, diagnostics, kind) {
        const response = await this.request("textDocument/codeAction", {
            textDocument: { uri },
            range: { start: { line: 0, character: 0 }, end: positionAt(text, text.length) },
            context: { diagnostics, only: [kind] },
        });
        return response.result ?? [];
    }
    async resolveActions(actions) {
        // Only resolve when the server advertised resolveProvider; otherwise use the
        // action as-is. Any error from an advertised resolve is real and propagates.
        const codeActionProvider = this.#serverCapabilities.codeActionProvider;
        const canResolve = typeof codeActionProvider === "object" &&
            codeActionProvider !== null &&
            codeActionProvider.resolveProvider === true;
        const resolvedActions = [];
        for (const action of actions) {
            if (action.edit || !canResolve) {
                resolvedActions.push(action);
                continue;
            }
            const response = await this.request("codeAction/resolve", action);
            resolvedActions.push(response.result ?? action);
        }
        return resolvedActions;
    }
    async shutdown() {
        const child = this.#process;
        const processExit = this.#processExit;
        if (!child || !processExit)
            return;
        // OMA divergence: while an oversized frame's body is still owed
        // to the discarder the wire cannot carry a trustworthy handshake --
        // skip it and close. A completed discard leaves framing intact and
        // the handshake proceeds as upstream's does.
        if (this.#child === child && this.#discardRemaining === 0) {
            try {
                await this.request("shutdown", null);
                this.notify("exit", undefined);
                if (await settlesWithin(processExit, PROCESS_EXIT_GRACE_MS))
                    return;
            }
            catch {
                // The process may already be gone; terminate it below if needed.
            }
        }
        this.close();
        if (await settlesWithin(processExit, PROCESS_EXIT_GRACE_MS))
            return;
        child.kill("SIGKILL");
        await processExit;
    }
    close() {
        this.#rejectPending(`${this.#adapter.name} LSP request cancelled.`);
        if (this.#child && !this.#child.killed)
            this.#child.kill("SIGTERM");
        this.#child = undefined;
    }
    #rejectPending(message) {
        for (const [id, pending] of this.#pending.entries()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(typeof message === "string" ? message : message(id)));
        }
        this.#pending.clear();
        for (const waiters of this.#diagnosticWaiters.values()) {
            for (const waiter of [...waiters]) {
                waiter.reject(new Error(typeof message === "string" ? message : message("diagnostics")));
            }
        }
        this.#diagnosticWaiters.clear();
    }
    #fail(message) {
        this.#rejectPending(message);
        if (this.#child && !this.#child.killed)
            this.#child.kill("SIGTERM");
        this.#child = undefined;
    }
    request(method, params) {
        const id = this.#nextId++;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error(`${this.#adapter.name} LSP request timed out: ${method}.${this.#formatStderr()}`));
            }, this.#timeoutMs);
            this.#pending.set(id, { resolve, reject, timeout });
            try {
                this.#send({ jsonrpc: "2.0", id, method, params });
            }
            catch (error) {
                clearTimeout(timeout);
                this.#pending.delete(id);
                reject(error);
            }
        });
    }
    notify(method, params) {
        // OMA divergence: expose the write's backpressure signal -- the
        // didOpen loop is the caller that needs it.
        return this.#send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
    }
    #send(message) {
        if (!this.#child)
            throw new Error(`${this.#adapter.name} LSP server is not running.`);
        const body = JSON.stringify(message);
        try {
            // OMA divergence: the write's backpressure signal is
            // returned so the didOpen loop waits for 'drain' instead of
            // buffering the corpus.
            return this.#child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        }
        catch (error) {
            const errorMessage = `${this.#adapter.name} LSP stdin write failed: ${formatErrorMessage(error)}.` + this.#formatStderr();
            this.#fail(errorMessage);
            throw new Error(errorMessage);
        }
    }
    #onData(chunk) {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        // OMA divergence: every inbound byte is liveness -- a caller's
        // stall window resets on frames, so a server still talking
        // survives a call of any length and only silence is reclaimed.
        for (const sink of omaInboundSinks)
            try {
                sink(this.#adapter);
            }
            catch { /* a sink's failure is not the wire's */ }
        // OMA divergence: while a dropped oversized frame's body is still
        // arriving, inbound bytes feed the discarder in bounded memory
        // and the parser resumes exactly at the frame's end.
        if (this.#discardRemaining > 0) {
            const skip = Math.min(this.#buffer.length, this.#discardRemaining);
            this.#buffer = this.#buffer.subarray(skip);
            this.#discardRemaining -= skip;
            if (this.#discardRemaining > 0)
                return;
        }
        // OMA divergence: accumulation with no frame boundary at all is
        // stream garbage, not a legit huge response. Clear the buffer,
        // refuse the pending request(s) with the bound named, and keep
        // the server alive -- the next real frame still parses.
        if (this.#discardRemaining === 0 && this.#buffer.indexOf("\r\n\r\n") < 0 && this.#buffer.length > OMA_MAX_INBOUND_FRAME_BYTES) {
            this.#buffer = Buffer.alloc(0);
            this.#droppedInboundFrames += 1;
            this.#rejectPending(`${this.#adapter.name} LSP server output exceeded OMA's ${OMA_MAX_INBOUND_FRAME_BYTES}-byte inbound bound without completing a frame; the data was dropped, the server stays up.${this.#formatStderr()}`);
            return;
        }
        while (true) {
            const separator = this.#buffer.indexOf("\r\n\r\n");
            if (separator < 0)
                return;
            const header = this.#buffer.subarray(0, separator).toString("utf8");
            const contentLength = /Content-Length:\s*(\d+)/i.exec(header)?.[1];
            if (!contentLength)
                throw new Error(`Invalid LSP response header: ${header}`);
            const bodyStart = separator + 4;
            const bodyLength = Number(contentLength);
            // OMA divergence: a declared oversized body is refused as one
            // request, not buffered and never a server kill -- the request
            // it answers is rejected with the bound named, the body's
            // bytes are discarded in bounded memory, and the wire realigns
            // at the frame's end so the shutdown handshake can still
            // complete.
            if (bodyLength > OMA_MAX_INBOUND_FRAME_BYTES) {
                this.#refuseOversizedFrame(bodyLength, this.#buffer.subarray(bodyStart, Math.min(bodyStart + 4096, this.#buffer.length)).toString("utf8"));
                this.#buffer = this.#buffer.subarray(bodyStart);
                const skip = Math.min(this.#buffer.length, bodyLength);
                this.#buffer = this.#buffer.subarray(skip);
                this.#discardRemaining = bodyLength - skip;
                continue;
            }
            if (this.#buffer.length < bodyStart + bodyLength)
                return;
            const rawBody = this.#buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8");
            this.#buffer = this.#buffer.subarray(bodyStart + bodyLength);
            this.#handleMessage(JSON.parse(rawBody));
        }
    }
    #handleMessage(message) {
        if (Object.hasOwn(message, "id") && !message.method) {
            const pending = typeof message.id === "number" ? this.#pending.get(message.id) : undefined;
            if (!pending)
                return;
            clearTimeout(pending.timeout);
            this.#pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(`${this.#adapter.name} LSP error: ${message.error.message}`));
            }
            else {
                pending.resolve(message);
            }
            return;
        }
        if (message.method === "textDocument/publishDiagnostics") {
            const params = message.params;
            if (params?.uri) {
                // OMA divergence: pushed diagnostics are flagged-bounded,
                // never a server kill and never a silent drop. A
                // publication for a document past the tracked-URI bound
                // loses only its own data, counted and flagged into every
                // resolved list; the stored list itself is truncated with
                // markers where it is built below.
                const key = documentKey(params.uri);
                if (!this.#publishedDiagnostics.has(key) && this.#publishedDiagnostics.size >= OMA_MAX_DIAGNOSTIC_URIS) {
                    this.#droppedDiagnosticUris += 1;
                    return;
                }
                const previousVersion = this.#publishedDiagnostics.get(key)?.version ?? 0;
                const publication = {
                    version: previousVersion + 1,
                    diagnostics: omaFlaggedDiagnostics(params.diagnostics ?? []),
                };
                this.#publishedDiagnostics.set(key, publication);
                const waiters = this.#diagnosticWaiters.get(key);
                if (waiters) {
                    for (const waiter of [...waiters])
                        waiter.onPublish(publication);
                }
            }
            return;
        }
        if (Object.hasOwn(message, "id") && message.method) {
            this.#respondToServerRequest(message);
        }
    }
    #waitForPublishedDiagnostics(uri, fallback) {
        // See PUBLISHED_DIAGNOSTICS_SETTLE_MS. Bounded by #timeoutMs.
        const key = documentKey(uri);
        return new Promise((resolve, reject) => {
            let settleTimer;
            let fallbackTimer;
            let overallTimer;
            let sawNonEmptyPublication = false;
            const afterVersion = fallback?.afterVersion ?? 0;
            const dispose = () => {
                if (settleTimer)
                    clearTimeout(settleTimer);
                if (fallbackTimer)
                    clearTimeout(fallbackTimer);
                if (overallTimer)
                    clearTimeout(overallTimer);
                const set = this.#diagnosticWaiters.get(key);
                set?.delete(waiter);
                if (set && set.size === 0)
                    this.#diagnosticWaiters.delete(key);
            };
            const settleWith = (diagnostics) => {
                dispose();
                // OMA divergence: the URI-bound drop count is appended as
                // a visible marker rather than swallowed -- a resolved
                // list reports that pushed publications were lost.
                resolve(this.#withDroppedUriFlag(diagnostics));
            };
            const fail = (reason) => {
                dispose();
                reject(reason);
            };
            const onPublish = (publication) => {
                if (publication.version <= afterVersion)
                    return;
                if (fallback && publication.diagnostics.length === 0 && !sawNonEmptyPublication)
                    return;
                sawNonEmptyPublication ||= publication.diagnostics.length > 0;
                if (fallbackTimer)
                    clearTimeout(fallbackTimer);
                if (settleTimer)
                    clearTimeout(settleTimer);
                settleTimer = setTimeout(() => settleWith(this.#publishedDiagnostics.get(key)?.diagnostics ?? []), this.#adapter.diagnosticsSettleMs ?? PUBLISHED_DIAGNOSTICS_SETTLE_MS);
            };
            const waiter = { onPublish, reject: fail, dispose };
            const set = this.#diagnosticWaiters.get(key) ?? new Set();
            set.add(waiter);
            this.#diagnosticWaiters.set(key, set);
            if (fallback) {
                fallbackTimer = setTimeout(() => {
                    const latest = this.#publishedDiagnostics.get(key);
                    settleWith(latest && latest.version > afterVersion ? latest.diagnostics : fallback.diagnostics);
                }, Math.min(fallback.waitMs, this.#timeoutMs));
            }
            overallTimer = setTimeout(() => {
                const latest = this.#publishedDiagnostics.get(key);
                if (latest && latest.version > afterVersion) {
                    settleWith(latest.diagnostics);
                }
                else if (fallback) {
                    settleWith(fallback.diagnostics);
                }
                else {
                    // OMA divergence: the waiter timeout reports what
                    // the wire dropped while it waited -- the drop counts
                    // ride the failure instead of vanishing.
                    fail(new Error(`${this.#adapter.name} LSP did not return diagnostics for ${uri} before timeout.${this.#formatDropped()}`));
                }
            }, this.#timeoutMs);
            const existing = this.#publishedDiagnostics.get(key);
            if (existing)
                onPublish(existing);
        });
    }
    #respondToServerRequest(message) {
        if (message.method === "workspace/configuration") {
            const params = message.params;
            this.#send({
                jsonrpc: "2.0",
                id: message.id,
                result: (params?.items ?? []).map((item) => this.#configurationValue(item.section)),
            });
            return;
        }
        if (message.method === "workspace/workspaceFolders") {
            const rootUri = directoryUri(this.#cwd);
            this.#send({
                jsonrpc: "2.0",
                id: message.id,
                result: [{ uri: rootUri, name: path.basename(this.#cwd) || "workspace" }],
            });
            return;
        }
        if (message.method === "client/registerCapability" || message.method === "client/unregisterCapability") {
            this.#send({ jsonrpc: "2.0", id: message.id, result: null });
            return;
        }
        this.#send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: `Method not found: ${message.method ?? "unknown"}` },
        });
    }
    #configurationValue(section) {
        if (!section)
            return this.#adapter.initialization ?? {};
        return this.#adapter.initialization?.[section] ?? {};
    }
    // OMA divergence: refuse the request an oversized frame answers --
    // never the server, and never a guess: only a sniffed body id that
    // actually names a pending request refuses it. An unidentified frame
    // (a notification, or an id past the sniffed prefix) is dropped and
    // counted so the drop rides later error tails -- blaming the sole
    // pending request for a frame that was not answering it was a
    // misattributed kill.
    #refuseOversizedFrame(bodyLength, bodyPrefix) {
        const sniffed = /"id"\s*:\s*(\d+)/.exec(bodyPrefix)?.[1];
        const pendingId = sniffed === undefined ? undefined : Number(sniffed);
        const pending = pendingId === undefined ? undefined : this.#pending.get(pendingId);
        if (pending === undefined) {
            this.#droppedInboundFrames += 1;
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(pendingId);
        pending.reject(new Error(`${this.#adapter.name} LSP response frame declared ${bodyLength} bytes; OMA's bound is ${OMA_MAX_INBOUND_FRAME_BYTES} -- the request was refused and the frame dropped, the server stays up.`));
    }
    // OMA divergence: the URI-bound drop count resolves as a visible
    // marker diagnostic appended to every list -- the drop is named, not
    // silent.
    #withDroppedUriFlag(diagnostics) {
        return this.#droppedDiagnosticUris > 0
            ? [...diagnostics, omaMarkerDiagnostic(`${this.#droppedDiagnosticUris} pushed publication(s) were dropped at OMA's ${OMA_MAX_DIAGNOSTIC_URIS}-document bound`)]
            : diagnostics;
    }
    // OMA divergence: bounded-drop counts ride every error tail, so a
    // refused or timed-out request also reports what the wire dropped.
    #formatDropped() {
        const parts = [];
        if (this.#droppedInboundFrames > 0)
            parts.push(`${this.#droppedInboundFrames} oversized inbound frame(s) dropped`);
        if (this.#droppedDiagnosticUris > 0)
            parts.push(`${this.#droppedDiagnosticUris} pushed-diagnostic publication(s) dropped`);
        return parts.length > 0 ? `\noma bounds: ${parts.join(", ")}` : "";
    }
    #formatStderr() {
        const stderr = this.#stderr.trim();
        return (stderr ? `\nServer stderr:\n${stderr}` : "") + this.#formatDropped();
    }
}
function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function settlesWithin(promise, timeoutMs) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), timeoutMs);
        void promise.then(() => {
            clearTimeout(timeout);
            resolve(true);
        });
    });
}
