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
// generated.divergences in manifest.json). Over a bound the call fails
// cleanly -- nothing is silently truncated and a flooding server cannot
// grow buffers without limit.
const OMA_MAX_STDERR_CHARS = 64 * 1024;
const OMA_MAX_INBOUND_FRAME_BYTES = 4 * 1024 * 1024;
const OMA_MAX_DIAGNOSTICS_PER_FILE = 1024;
const OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS = 8 * 1024;
const OMA_MAX_DIAGNOSTIC_URIS = 4096;
const OMA_MAX_CODE_ACTIONS = 256;
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
        this.notify("textDocument/didOpen", {
            textDocument: { uri, languageId, version: 1, text },
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
            return diagnostics;
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
        // OMA divergence: every unresolved action is a codeAction/resolve
        // round-trip, so an unbounded action list is an unbounded sequential
        // request loop. Refuse past the cap instead.
        if (actions.length > OMA_MAX_CODE_ACTIONS)
            throw new Error(`${this.#adapter.name} LSP returned ${actions.length} code actions; OMA's bound is ${OMA_MAX_CODE_ACTIONS}.`);
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
        if (this.#child === child) {
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
        this.#send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
    }
    #send(message) {
        if (!this.#child)
            throw new Error(`${this.#adapter.name} LSP server is not running.`);
        const body = JSON.stringify(message);
        try {
            this.#child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        }
        catch (error) {
            const errorMessage = `${this.#adapter.name} LSP stdin write failed: ${formatErrorMessage(error)}.` + this.#formatStderr();
            this.#fail(errorMessage);
            throw new Error(errorMessage);
        }
    }
    #onData(chunk) {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        // OMA divergence: a frame that never completes -- or declares a
        // Content-Length past the ceiling -- must not grow this buffer
        // without bound. Fail the call and kill the server instead.
        if (this.#buffer.length > OMA_MAX_INBOUND_FRAME_BYTES) {
            this.#buffer = Buffer.alloc(0);
            this.#fail(`${this.#adapter.name} LSP server output exceeded OMA's ${OMA_MAX_INBOUND_FRAME_BYTES}-byte inbound bound.${this.#formatStderr()}`);
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
            // OMA divergence: refuse a declared oversized body up front rather
            // than buffering until the accumulation bound trips.
            if (bodyLength > OMA_MAX_INBOUND_FRAME_BYTES)
                throw new Error(`declared Content-Length ${bodyLength} exceeds OMA's ${OMA_MAX_INBOUND_FRAME_BYTES}-byte bound`);
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
                // OMA divergence: pushed diagnostics are bounded -- per-file
                // count, per-message length, and the number of distinct
                // documents tracked. A flood fails the call rather than
                // growing the store without limit.
                const pushed = Array.isArray(params.diagnostics) ? params.diagnostics : [];
                if (pushed.length > OMA_MAX_DIAGNOSTICS_PER_FILE) {
                    this.#fail(`${this.#adapter.name} LSP pushed ${pushed.length} diagnostics for one file; OMA's bound is ${OMA_MAX_DIAGNOSTICS_PER_FILE}.`);
                    return;
                }
                for (const diagnostic of pushed) {
                    if (typeof diagnostic?.message === "string" && diagnostic.message.length > OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS) {
                        this.#fail(`${this.#adapter.name} LSP pushed a ${diagnostic.message.length}-char diagnostic message; OMA's bound is ${OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS}.`);
                        return;
                    }
                }
                const key = documentKey(params.uri);
                if (!this.#publishedDiagnostics.has(key) && this.#publishedDiagnostics.size >= OMA_MAX_DIAGNOSTIC_URIS) {
                    this.#fail(`${this.#adapter.name} LSP pushed diagnostics for more than ${OMA_MAX_DIAGNOSTIC_URIS} documents; OMA's bound was exceeded.`);
                    return;
                }
                const previousVersion = this.#publishedDiagnostics.get(key)?.version ?? 0;
                const publication = {
                    version: previousVersion + 1,
                    diagnostics: params.diagnostics ?? [],
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
                resolve(diagnostics);
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
                    fail(new Error(`${this.#adapter.name} LSP did not return diagnostics for ${uri} before timeout.`));
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
    #formatStderr() {
        const stderr = this.#stderr.trim();
        return stderr ? `\nServer stderr:\n${stderr}` : "";
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
