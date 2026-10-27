#!/usr/bin/env node
/** Vendored pi-lsp bundle maintenance — the only writer of
 * `packages/tool-lsp/src/vendor/pi-lsp/runtime/` and `manifest.json`.
 *
 * `upstream/` is the exact npm tarball snapshot of @narumitw/pi-lsp and is
 * never touched here. `runtime/` is tsc's emit of the upstream library
 * modules (the extension-entry files index.ts/pi-lsp.ts are vendored but
 * never compiled or loaded — OMA's adapter owns registration) with OMA's
 * declared divergence splices applied on top. `--write` rebuilds runtime/
 * and rewrites manifest.json; the default `--check` verifies both against
 * the tree so a hand-edited or partially copied bundle fails instead of
 * silently drifting.
 *
 * OMA_DIVERGENCES is the only sanctioned difference between tsc emit and
 * runtime/: each splice is an exact-once anchor replacement over the emitted
 * bytes, so a drifted upstream emit fails loudly rather than skipping a
 * bound. The manifest records every divergent file and its reason under
 * `generated.divergences`.
 *
 * This script never reaches the network: npm integrity/shasum/commit are
 * recorded metadata, verified once at vendoring time.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  applyDivergences, bundleDigest, bundleRecordProblems, bundleRecords, canonical,
  divergenceMetadata, divergenceProblems, emittedRuntimeProblems, filesUnder, writeRuntimeTree,
} from "./vendor-bundle-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(root, "packages/tool-lsp/src/vendor/pi-lsp");
const UPSTREAM_DIR = join(BUNDLE_DIR, "upstream");
const RUNTIME_DIR = join(BUNDLE_DIR, "runtime");
const MANIFEST_PATH = join(BUNDLE_DIR, "manifest.json");

/** Upstream modules OMA's adapter loads. The extension entry (index.ts,
 * pi-lsp.ts) is deliberately absent: it registers upstream's own tools and
 * command surface, which OMA does not expose. */
const RUNTIME_MODULES = Object.freeze([
  "adapters", "command", "files", "lsp-client", "routes", "runner",
  "session-lifecycle", "text-edits", "types",
]);

const EXPECTED_PACKAGE = Object.freeze({
  name: "@narumitw/pi-lsp",
  version: "0.49.9",
  commit: "55d784704cdec1ec1534b59f78f07f139539119e",
  npmIntegrity: "sha512-YQ49sPiz3sDq5+l9YuPsOcn7YC2kdRbzQr/5pBpsUi0giUqIymHEHB+G0bKx6PmOjhvStCzCSHJxU/qfTLj/yA==",
  npmShasum: "6643cec0b716bc5dc1834bdf836285b3c7569dce",
});

/** The bounds OMA's adapter needs inside the vendored client, written as
 * exact-once text splices over tsc emit. upstream/ stays the byte-exact npm
 * snapshot; runtime/ carries these and only these edits. Anchors quote the
 * emitted source verbatim: each `find` must occur exactly once or the
 * regeneration fails instead of emitting a partially patched runtime.
 *
 * Divergence policy: bounds and failure-posture fixes only — never a
 * behavioral rewrite of what the server sees below the bound. (The
 * command.js splice is a failure-posture fix: the inherited-env union
 * cannot express deny-by-default, so the boundary had to move into the
 * seam.) */
const OMA_DIVERGENCES = Object.freeze({
  "command.js": {
    reason:
      "OMA deny-by-default child environment: mergeEnvironment no longer " +
      "seeds the result from process.env -- the overrides map IS the " +
      "language-server child's whole environment. The inherited union meant " +
      "every name the adapter did not override reached the child, and the " +
      "denylist that emptied names could never converge (emptying is also " +
      "not stripping: loaders read an empty path-list element as the " +
      "current directory). OMA's hardenedAdapter writes the complete " +
      "allowlisted map; nothing else survives.",
    edits: [
      {
        find: `export function mergeEnvironment(overrides, platform = process.platform) {
    const environment = { ...process.env };`,
        replace: `export function mergeEnvironment(overrides, platform = process.platform) {
    // OMA divergence: deny-by-default -- the overrides ARE the child's
    // whole environment; nothing is inherited from process.env. OMA's
    // adapter writes the complete map (allowlisted inherited names, the
    // adapter's declared extras through the same allowlist, the per-call
    // scratch redirects), so an injection channel OMA never named cannot
    // reach the child through the union this line used to seed -- and an
    // emptied tombstone cannot fake stripping either, since loaders read
    // an empty path-list element as the current directory.
    const environment = {};`,
      },
    ],
  },
  "lsp-client.js": {
    reason:
      "OMA bounds inside the wire path, all honest degradation now: stderr " +
      "accumulation cap (truncation-only, with the marker tracked by an " +
      "explicit dropped flag); the inbound frame bound -- a declared " +
      "oversized body refuses only the request its sniffed id actually " +
      "names (an unidentifiable frame is dropped and counted, never " +
      "blamed on the sole pending request) and is discarded in bounded " +
      "memory so the wire realigns and the server survives; accumulation " +
      "with no frame boundary at all is stream garbage that refuses the " +
      "pending requests and clears the buffer, again without killing the " +
      "server. Pushed diagnostics are truncated with visible markers and " +
      "counts (per-file count, per-message length, a tracked-document " +
      "bound whose drops are flagged into resolved lists on every " +
      "return path, waiter timeouts included) -- never a #fail. Every " +
      "inbound frame chunk is reported to registered sinks so the " +
      "caller's stall window resets on progress instead of a fixed " +
      "deadline, permanent 'error' listeners on the child and its stdio " +
      "keep a post-start error from crashing the engine or orphaning the " +
      "server, and didOpen reports stdin backpressure through the " +
      "write's own return value so the open loop awaits a bounded " +
      "didDrain() instead of materializing the corpus in memory.",
    edits: [
      {
        find: "const PROCESS_EXIT_GRACE_MS = 500;",
        replace: `const PROCESS_EXIT_GRACE_MS = 500;
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
        severity, source: "oma", code, message: \`[oma: \${text}]\` };
}
export function omaIsMarker(diagnostic) {
    return diagnostic?.source === "oma" && typeof diagnostic?.code === "string" && diagnostic.code.startsWith("oma/");
}
// A message an earlier pass already cut ends with this tail -- cutting it
// again would slice the marker off and re-report the truncated length as
// the original, lying about both the text kept and the total dropped.
const OMA_MESSAGE_TRUNCATION_TAIL = / \\[truncated at OMA's \\d+-char bound; \\d+ chars total\\]$/;
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
            omaMarkerDiagnostic(\`\${realCount - bound} more diagnostic(s) for this file were dropped at OMA's \${bound}-diagnostic bound\`),
            ...flagged.slice(realCount)];
    return flagged.map(diagnostic => typeof diagnostic?.message === "string" && diagnostic.message.length > OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS
        && !OMA_MESSAGE_TRUNCATION_TAIL.test(diagnostic.message)
        ? { ...diagnostic, message: \`\${diagnostic.message.slice(0, OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS)} [truncated at OMA's \${OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS}-char bound; \${diagnostic.message.length} chars total]\` }
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
        return { sample: \`\${state.sample}\\n[stderr truncated at OMA's \${OMA_MAX_STDERR_CHARS}-char bound]\`, dropped: true };
    const next = state.sample + text;
    if (next.length <= OMA_MAX_STDERR_CHARS)
        return { sample: next, dropped: false };
    return { sample: \`\${next.slice(0, OMA_MAX_STDERR_CHARS)}\\n[stderr truncated at OMA's \${OMA_MAX_STDERR_CHARS}-char bound]\`, dropped: true };
}`,
      },
      {
        find: `    #stderr = "";`,
        replace: `    #stderr = "";
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
    #droppedDiagnosticUris = 0;`,
      },
      {
        find: `        child.stderr.on("data", (chunk) => {
            this.#stderr += chunk.toString();
        });`,
        replace: `        child.stderr.on("data", (chunk) => {
            // OMA divergence: stderr is a bounded sample, not an accumulator.
            const next = appendStderrSample({ sample: this.#stderr, dropped: this.#stderrDropped }, chunk.toString());
            this.#stderr = next.sample;
            this.#stderrDropped = next.dropped;
        });`,
      },
      {
        find: `        await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", (error) => {
                const message = \`\${this.#adapter.name} LSP process failed to start: \${error.message}.\${this.#formatStderr()}\`;
                this.#rejectPending(message);
                if (this.#child === child)
                    this.#child = undefined;
                if (this.#process === child)
                    this.#process = undefined;
                reject(new Error(message));
            });
        });`,
        replace: `        // OMA divergence: the child and its stdio keep 'error' listeners
        // for the process's whole life. Upstream's startup once("error")
        // only covered the first failure and the stdio streams had none at
        // all, so a post-start error escaped as an unhandled 'error' event
        // and crashed the engine. The permanent handler below keeps the
        // same cleanup; the startup promise keeps its spawn-failure reject.
        // An 'error' event does not by itself stop the child -- clearing
        // the refs alone made shutdown() return early and orphaned the
        // process, so the handler kills before it clears.
        child.on("error", (error) => {
            const message = \`\${this.#adapter.name} LSP server process error: \${error.message}.\${this.#formatStderr()}\`;
            this.#rejectPending(message);
            if (!child.killed)
                child.kill("SIGKILL");
            if (this.#child === child)
                this.#child = undefined;
            if (this.#process === child)
                this.#process = undefined;
        });
        child.stdout.on("error", () => this.#fail(\`\${this.#adapter.name} LSP stdout failed.\${this.#formatStderr()}\`));
        child.stderr.on("error", () => this.#fail(\`\${this.#adapter.name} LSP stderr failed.\${this.#formatStderr()}\`));
        await new Promise((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", (error) => {
                reject(new Error(\`\${this.#adapter.name} LSP process failed to start: \${error.message}.\${this.#formatStderr()}\`));
            });
        });`,
      },
      {
        find: `    #onData(chunk) {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        while (true) {`,
        replace: `    #onData(chunk) {
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
        if (this.#discardRemaining === 0 && this.#buffer.indexOf("\\r\\n\\r\\n") < 0 && this.#buffer.length > OMA_MAX_INBOUND_FRAME_BYTES) {
            this.#buffer = Buffer.alloc(0);
            this.#droppedInboundFrames += 1;
            this.#rejectPending(\`\${this.#adapter.name} LSP server output exceeded OMA's \${OMA_MAX_INBOUND_FRAME_BYTES}-byte inbound bound without completing a frame; the data was dropped, the server stays up.\${this.#formatStderr()}\`);
            return;
        }
        while (true) {`,
      },
      {
        find: `            const bodyStart = separator + 4;
            const bodyLength = Number(contentLength);
            if (this.#buffer.length < bodyStart + bodyLength)
                return;`,
        replace: `            const bodyStart = separator + 4;
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
                return;`,
      },
      {
        find: `            if (params?.uri) {
                const key = documentKey(params.uri);`,
        replace: `            if (params?.uri) {
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
                }`,
      },
      {
        find: `                    diagnostics: params.diagnostics ?? [],`,
        replace: `                    diagnostics: omaFlaggedDiagnostics(params.diagnostics ?? []),`,
      },
      {
        find: `    didOpen(uri, text, languageId) {
        this.notify("textDocument/didOpen", {
            textDocument: { uri, languageId, version: 1, text },
        });
    }`,
        replace: `    didOpen(uri, text, languageId) {
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
            return Promise.reject(new Error(\`\${this.#adapter.name} LSP server is not running.\`));
        if (stdin.destroyed || stdin.closed)
            return Promise.reject(new Error(\`\${this.#adapter.name} LSP stdin is closed -- the server process is gone.\${this.#formatStderr()}\`));
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
            const onError = (error) => finish(new Error(\`\${this.#adapter.name} LSP stdin failed while awaiting drain: \${formatErrorMessage(error)}.\${this.#formatStderr()}\`));
            const onClose = () => finish(new Error(\`\${this.#adapter.name} LSP stdin closed before buffered writes drained.\${this.#formatStderr()}\`));
            const timer = setTimeout(() => finish(new Error(\`\${this.#adapter.name} LSP stdin did not drain within \${this.#timeoutMs}ms -- the server is not reading.\${this.#formatStderr()}\`)), this.#timeoutMs);
            stdin.once("drain", onDrain);
            stdin.once("error", onError);
            stdin.once("close", onClose);
            if (stdin.destroyed || stdin.closed)
                onClose();
            else if (stdin.writableLength === 0 && !stdin.writableNeedDrain)
                onDrain();
        });
    }`,
      },
      {
        find: `    notify(method, params) {
        this.#send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
    }`,
        replace: `    notify(method, params) {
        // OMA divergence: expose the write's backpressure signal -- the
        // didOpen loop is the caller that needs it.
        return this.#send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
    }`,
      },
      {
        find: `            this.#child.stdin.write(\`Content-Length: \${Buffer.byteLength(body)}\\r\\n\\r\\n\${body}\`);`,
        replace: `            // OMA divergence: the write's backpressure signal is
            // returned so the didOpen loop waits for 'drain' instead of
            // buffering the corpus.
            return this.#child.stdin.write(\`Content-Length: \${Buffer.byteLength(body)}\\r\\n\\r\\n\${body}\`);`,
      },
      {
        find: `        if (diagnostics.length > 0 || !this.#adapter.pullDiagnosticsGraceMs)
            return diagnostics;`,
        replace: `        if (diagnostics.length > 0 || !this.#adapter.pullDiagnosticsGraceMs)
            // OMA divergence: the pull path's early return carries the
            // same URI-bound drop marker the settle path appends -- a
            // non-empty answer never hides dropped pushed publications.
            return this.#withDroppedUriFlag(diagnostics);`,
      },
      {
        find: `                    fail(new Error(\`\${this.#adapter.name} LSP did not return diagnostics for \${uri} before timeout.\`));`,
        replace: `                    // OMA divergence: the waiter timeout reports what
                    // the wire dropped while it waited -- the drop counts
                    // ride the failure instead of vanishing.
                    fail(new Error(\`\${this.#adapter.name} LSP did not return diagnostics for \${uri} before timeout.\${this.#formatDropped()}\`));`,
      },
      {
        find: `            const settleWith = (diagnostics) => {
                dispose();
                resolve(diagnostics);
            };`,
        replace: `            const settleWith = (diagnostics) => {
                dispose();
                // OMA divergence: the URI-bound drop count is appended as
                // a visible marker rather than swallowed -- a resolved
                // list reports that pushed publications were lost.
                resolve(this.#withDroppedUriFlag(diagnostics));
            };`,
      },
      {
        find: `        if (this.#child === child) {
            try {
                await this.request("shutdown", null);`,
        replace: `        // OMA divergence: while an oversized frame's body is still owed
        // to the discarder the wire cannot carry a trustworthy handshake --
        // skip it and close. A completed discard leaves framing intact and
        // the handshake proceeds as upstream's does.
        if (this.#child === child && this.#discardRemaining === 0) {
            try {
                await this.request("shutdown", null);`,
      },
      {
        find: `    #formatStderr() {
        const stderr = this.#stderr.trim();
        return stderr ? \`\\nServer stderr:\\n\${stderr}\` : "";
    }`,
        replace: `    // OMA divergence: refuse the request an oversized frame answers --
    // never the server, and never a guess: only a sniffed body id that
    // actually names a pending request refuses it. An unidentified frame
    // (a notification, or an id past the sniffed prefix) is dropped and
    // counted so the drop rides later error tails -- blaming the sole
    // pending request for a frame that was not answering it was a
    // misattributed kill.
    #refuseOversizedFrame(bodyLength, bodyPrefix) {
        const sniffed = /"id"\\s*:\\s*(\\d+)/.exec(bodyPrefix)?.[1];
        const pendingId = sniffed === undefined ? undefined : Number(sniffed);
        const pending = pendingId === undefined ? undefined : this.#pending.get(pendingId);
        if (pending === undefined) {
            this.#droppedInboundFrames += 1;
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(pendingId);
        pending.reject(new Error(\`\${this.#adapter.name} LSP response frame declared \${bodyLength} bytes; OMA's bound is \${OMA_MAX_INBOUND_FRAME_BYTES} -- the request was refused and the frame dropped, the server stays up.\`));
    }
    // OMA divergence: the URI-bound drop count resolves as a visible
    // marker diagnostic appended to every list -- the drop is named, not
    // silent.
    #withDroppedUriFlag(diagnostics) {
        return this.#droppedDiagnosticUris > 0
            ? [...diagnostics, omaMarkerDiagnostic(\`\${this.#droppedDiagnosticUris} pushed publication(s) were dropped at OMA's \${OMA_MAX_DIAGNOSTIC_URIS}-document bound\`)]
            : diagnostics;
    }
    // OMA divergence: bounded-drop counts ride every error tail, so a
    // refused or timed-out request also reports what the wire dropped.
    #formatDropped() {
        const parts = [];
        if (this.#droppedInboundFrames > 0)
            parts.push(\`\${this.#droppedInboundFrames} oversized inbound frame(s) dropped\`);
        if (this.#droppedDiagnosticUris > 0)
            parts.push(\`\${this.#droppedDiagnosticUris} pushed-diagnostic publication(s) dropped\`);
        return parts.length > 0 ? \`\\noma bounds: \${parts.join(", ")}\` : "";
    }
    #formatStderr() {
        const stderr = this.#stderr.trim();
        return (stderr ? \`\\nServer stderr:\\n\${stderr}\` : "") + this.#formatDropped();
    }`,
      },
    ],
  },
  "lsp-client.d.ts": {
    reason:
      "OMA divergence: the emitted declaration mirrors the spliced " +
      "runtime surface -- didOpen returns stdin's backpressure signal, " +
      "didDrain settles a backpressured write, and the marker helpers " +
      "are declared.",
    edits: [
      {
        find: `    didOpen(uri: string, text: string, languageId: string): void;`,
        replace: `    /** OMA divergence: false means the write buffered -- await didDrain(). */
    didOpen(uri: string, text: string, languageId: string): boolean;
    /** OMA divergence: settles a backpressured write -- resolves on
     * 'drain', rejects on stdin error/close or the request budget. */
    didDrain(): Promise<void>;`,
      },
      {
        find: `export declare class LspClient {`,
        replace: `/** OMA divergence: the marker constructors and predicates the spliced
 * runtime exports -- a flagged diagnostic is a real LSP diagnostic. */
export declare function omaMarkerDiagnostic(text: string, code?: string, severity?: number): LspDiagnostic;
export declare function omaIsMarker(diagnostic: LspDiagnostic): boolean;
export declare class LspClient {`,
      },
    ],
  },
  "runner.js": {
    reason:
      "OMA policy on what a pull response carries: a pull diagnostics " +
      "array is truncated with the same visible markers and counts the " +
      "client applies on the push path -- never a thrown call for size " +
      "alone, and no read-time byte bound (didOpen carries the whole text " +
      "either way, so a file size cap only blocks a real fix). The open " +
      "loop honors stdin backpressure -- a buffered write awaits the " +
      "client's bounded didDrain() so a large corpus never materializes " +
      "in this process's memory while the server reads slowly. The " +
      "diagnostics fan-out settles per file: one file's timeout or " +
      "failure degrades its own entry to a named error marker and the " +
      "completed files keep their results, while the caller's abort " +
      "still refuses the call. The accumulated workspace-edit list " +
      "across all selected actions stays " +
      "bounded in count and newText bytes -- it refuses that one request " +
      "mid-collection because a truncated edit list would fabricate a " +
      "corrupt fix, which is worse than a clean refusal, and an unbounded " +
      "materialization is a memory bound whose failure mode (engine OOM) " +
      "is worse than the refusal. The resolve loop itself is unbounded: " +
      "each codeAction/resolve round-trip is already bounded by the " +
      "request timeout and the call's stall window resets on every " +
      "answered frame, so a large legitimate action set completes.",
    edits: [
      {
        find: `import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits } from "./text-edits.js";`,
        replace: `import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits, OMA_MAX_WORKSPACE_EDITS, OMA_MAX_WORKSPACE_EDIT_BYTES } from "./text-edits.js";
// OMA divergence: pull-path diagnostics are flagged-truncated by the same
// helper the pushed store uses (lsp-client.js) -- a flood answers with a
// visibly cut list, not a thrown call. omaIsMarker keeps OMA's own
// annotations out of the codeAction context the server sees; the error
// marker names a file whose own request failed.
import { omaFlaggedDiagnostics, omaIsMarker, omaMarkerDiagnostic } from "./lsp-client.js";`,
      },
      {
        find: `            for (const file of files) {
                throwIfAborted(signal, adapter);
                const uri = pathToFileURL(file).href;
                const text = readFileSync(file, "utf8");
                client.didOpen(uri, text, adapter.languageIdFor(file));
                openedFiles.push({ file, uri });
            }`,
        replace: `            for (const file of files) {
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
            }`,
      },
      {
        find: `            const entries = await Promise.all(openedFiles.map(async ({ file, uri }) => ({
                path: path.relative(root, file) || file,
                uri,
                diagnostics: await client.diagnostics(uri),
            })));`,
        replace: `            // OMA divergence: every file's request settles independently
            // -- one slow or failed file degrades to a per-file error
            // marker and the completed files keep their real diagnostics.
            // The call is refused only by the caller's abort
            // (throwIfAborted below), never by one file's timeout alone.
            const settled = await Promise.allSettled(openedFiles.map(({ uri }) => client.diagnostics(uri)));
            const entries = settled.map((outcome, index) => {
                const { file, uri } = openedFiles[index];
                const diagnostics = outcome.status === "fulfilled"
                    ? omaFlaggedDiagnostics(outcome.value)
                    : [omaMarkerDiagnostic(\`diagnostics failed for this file: \${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}\`, "oma/error", 1)];
                return { path: path.relative(root, file) || file, uri, diagnostics };
            });`,
      },
      {
        find: `            const diagnostics = await client.diagnostics(uri);`,
        replace: `            const diagnostics = omaFlaggedDiagnostics(await client.diagnostics(uri));`,
      },
      {
        find: `            const actions = await client.codeActions(uri, text, diagnostics, actionKind);`,
        replace: `            // OMA divergence: every oma/ prefixed marker is OMA's own
            // annotation -- truncation flags AND per-file error markers --
            // and none are ever sent to the server inside the codeAction
            // context.
            const actions = await client.codeActions(uri, text, diagnostics.filter((entry) => !omaIsMarker(entry)), actionKind);`,
      },
      {
        find: `            edits = selectedActions.flatMap((action) => collectWorkspaceEdits(action.edit, uri));`,
        replace: `            // OMA divergence: the accumulated list is bounded across ALL
            // selected actions, not only per action -- and it is counted as
            // it accumulates, so an over-bound action set fails that one
            // request before the whole list is materialized. Refusal, not
            // truncation: a cut edit list would fabricate a corrupt fix.
            edits = [];
            let editBytes = 0;
            for (const action of selectedActions) {
                const collected = collectWorkspaceEdits(action.edit, uri);
                if (edits.length + collected.length > OMA_MAX_WORKSPACE_EDITS)
                    throw new Error(\`\${adapter.name} LSP returned \${edits.length + collected.length} accumulated workspace edits; OMA's bound is \${OMA_MAX_WORKSPACE_EDITS}.\`);
                for (const edit of collected) {
                    editBytes += typeof edit?.newText === "string" ? edit.newText.length : 0;
                    if (editBytes > OMA_MAX_WORKSPACE_EDIT_BYTES)
                        throw new Error(\`\${adapter.name} LSP returned more than \${OMA_MAX_WORKSPACE_EDIT_BYTES} accumulated workspace edit bytes; OMA's bound was exceeded.\`);
                }
                edits.push(...collected);
            }`,
      },
    ],
  },
  "files.js": {
    reason:
      "OMA conversion of the workspace walk: the recursion became an " +
      "explicit stack, so a deep tree is collected whole -- never dropped " +
      "for depth (the old OMA_MAX_COLLECT_DEPTH silently stopped) and " +
      "never recursed into a stack overflow. Children are pushed in " +
      "reverse sorted order so pops visit them in the recursion's own " +
      "depth-first order; the collected list is identical.",
    edits: [
      {
        find: `function collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, limit) {
    if (files.length >= limit || !existsSync(targetPath))
        return;
    if (!isInsidePath(realRoot, realpathSync(targetPath)))
        return;
    const stats = statSync(targetPath);
    if (stats.isFile()) {
        if (adapter.isSupportedFile(targetPath) && !seen.has(targetPath)) {
            seen.add(targetPath);
            files.push(targetPath);
        }
        return;
    }
    if (!stats.isDirectory())
        return;
    const directoryKey = realpathSync(targetPath);
    if (visitedDirectories.has(directoryKey))
        return;
    visitedDirectories.add(directoryKey);
    const entries = readdirSync(targetPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        if (files.length >= limit)
            break;
        if ((entry.isDirectory() || entry.isSymbolicLink()) && adapter.skipDirectories.has(entry.name))
            continue;
        collectPath(adapter, path.join(targetPath, entry.name), files, seen, visitedDirectories, realRoot, limit);
    }
}`,
        replace: `// OMA divergence (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json): the recursion became an
// explicit stack -- a deep tree is collected whole, never dropped for
// depth and never recursed into a stack overflow. Children are pushed
// in reverse sorted order so pops visit them in the recursion's own
// depth-first order; the collected list is identical.
function collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, limit) {
    const pending = [targetPath];
    while (pending.length > 0 && files.length < limit) {
        const current = pending.pop();
        if (!existsSync(current))
            continue;
        if (!isInsidePath(realRoot, realpathSync(current)))
            continue;
        const stats = statSync(current);
        if (stats.isFile()) {
            if (adapter.isSupportedFile(current) && !seen.has(current)) {
                seen.add(current);
                files.push(current);
            }
            continue;
        }
        if (!stats.isDirectory())
            continue;
        const directoryKey = realpathSync(current);
        if (visitedDirectories.has(directoryKey))
            continue;
        visitedDirectories.add(directoryKey);
        const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            if ((entry.isDirectory() || entry.isSymbolicLink()) && adapter.skipDirectories.has(entry.name))
                continue;
            pending.push(path.join(current, entry.name));
        }
    }
}`,
      },
    ],
  },
  "text-edits.js": {
    reason:
      "OMA bounds on what a resolved code action may carry: collected " +
      "workspace edits are refused past a count bound and a newText byte " +
      "bound -- mid-collection, not after a flatMap materialized the whole " +
      "list, and refusing only that one request (the server survives and " +
      "the shutdown handshake still completes). Refusal, not truncation: " +
      "a cut edit list would fabricate a corrupt fix, and an unbounded " +
      "materialization is a memory bound whose failure mode is engine " +
      "OOM -- both worse than a clean error. The overlap check is a " +
      "sorted sweep instead of a synchronous O(n^2) pair scan no " +
      "AbortSignal could interrupt, and application is one pass over the " +
      "ordered edits instead of rebuilding the string once per edit.",
    edits: [
      {
        find: `export function positionAt(text, offset) {`,
        replace: `// OMA divergences (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json). Resolved workspace edits are
// bounded in count and replacement bytes; overlap checking is a sorted
// sweep, not a quadratic scan; application is a single ordered pass.
export const OMA_MAX_WORKSPACE_EDITS = 2048;
export const OMA_MAX_WORKSPACE_EDIT_BYTES = 4 * 1024 * 1024;
export function positionAt(text, offset) {`,
      },
      {
        find: `export function applyTextEdits(text, edits) {
    let output = text;
    const sortedEdits = positionTextEdits(text, edits).sort((left, right) => {
        if (left.start !== right.start)
            return right.start - left.start;
        if (left.end !== right.end)
            return right.end - left.end;
        return right.index - left.index;
    });
    for (const { edit, start, end } of sortedEdits) {
        output = \`\${output.slice(0, start)}\${edit.newText}\${output.slice(end)}\`;
    }
    return output;
}`,
        replace: `export function applyTextEdits(text, edits) {
    // OMA divergence: one pass over the edits ordered by position instead
    // of splicing the whole string once per edit. The output is identical
    // for non-overlapping edits (overlap is refused upstream of this);
    // same-position inserts keep list order -- the reverse-sorted
    // application landed earlier-indexed text first and so does this.
    const orderedEdits = positionTextEdits(text, edits).sort((left, right) => {
        if (left.start !== right.start)
            return left.start - right.start;
        if (left.end !== right.end)
            return left.end - right.end;
        return left.index - right.index;
    });
    let output = "";
    let cursor = 0;
    for (const { edit, start, end } of orderedEdits) {
        output += text.slice(cursor, start) + edit.newText;
        cursor = end;
    }
    return output + text.slice(cursor);
}`,
      },
      {
        find: `export function hasOverlappingTextEdits(text, edits) {
    const positionedEdits = positionTextEdits(text, edits);
    for (let leftIndex = 0; leftIndex < positionedEdits.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < positionedEdits.length; rightIndex += 1) {
            if (textEditRangesConflict(positionedEdits[leftIndex], positionedEdits[rightIndex])) {
                return true;
            }
        }
    }
    return false;
}`,
        replace: `export function hasOverlappingTextEdits(text, edits) {
    // OMA divergence: a sorted sweep replaces the quadratic pair scan --
    // synchronous O(n^2) CPU on a hostile edit list could not be
    // interrupted by the request timeout or AbortSignal. Edits are
    // grouped by start offset; a non-empty range conflicts with an
    // earlier-starting range still open at its start or with a sibling
    // starting at the same offset, and an insert conflicts only strictly
    // inside an earlier range -- exactly the pair scan's verdicts.
    const positionedEdits = positionTextEdits(text, edits).sort((left, right) => left.start - right.start);
    let index = 0;
    let openEnd = -1;
    while (index < positionedEdits.length) {
        const start = positionedEdits[index].start;
        let siblingHasRange = false;
        let siblingEnd = -1;
        while (index < positionedEdits.length && positionedEdits[index].start === start) {
            const positioned = positionedEdits[index];
            if (positioned.start === positioned.end) {
                if (openEnd > start)
                    return true;
            }
            else {
                if (openEnd > start || siblingHasRange)
                    return true;
                siblingHasRange = true;
                if (positioned.end > siblingEnd)
                    siblingEnd = positioned.end;
            }
            index += 1;
        }
        if (siblingEnd > openEnd)
            openEnd = siblingEnd;
    }
    return false;
}`,
      },
      {
        find: `export function collectWorkspaceEdits(edit, uri) {
    if (!edit)
        return [];
    if (edit.documentChanges) {
        return edit.documentChanges.flatMap((change) => (change.textDocument?.uri === uri ? (change.edits ?? []) : []));
    }
    return edit.changes?.[uri] ?? [];
}`,
        replace: `export function collectWorkspaceEdits(edit, uri) {
    // OMA divergence: the collected list is bounded while it builds -- an
    // over-bound documentChanges array is refused mid-collection, not
    // after a flatMap materialized every element.
    if (!edit)
        return [];
    const collected = [];
    let bytes = 0;
    const take = (list) => {
        for (const entry of list ?? []) {
            collected.push(entry);
            if (collected.length > OMA_MAX_WORKSPACE_EDITS)
                throw new Error(\`workspace edits exceeded OMA's \${OMA_MAX_WORKSPACE_EDITS}-edit bound\`);
            bytes += typeof entry?.newText === "string" ? entry.newText.length : 0;
            if (bytes > OMA_MAX_WORKSPACE_EDIT_BYTES)
                throw new Error(\`workspace edits exceeded OMA's \${OMA_MAX_WORKSPACE_EDIT_BYTES}-byte bound\`);
        }
    };
    if (edit.documentChanges) {
        for (const change of edit.documentChanges)
            if (change.textDocument?.uri === uri)
                take(change.edits);
        return collected;
    }
    take(edit.changes?.[uri]);
    return collected;
}`,
      },
    ],
  },
});

/** Compile the vendored library modules with the repository's own tsc.
 * Upstream's own compiler options (strict, ES2022, NodeNext) plus
 * declaration emit; OMA's extra strictness flags do not apply to vendored
 * source, which is excluded from the main tsconfigs instead. */
function emitRuntime(outDir) {
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const args = [
    ...RUNTIME_MODULES.map(name => join(UPSTREAM_DIR, "src", `${name}.ts`)),
    "--outDir", outDir, "--rootDir", join(UPSTREAM_DIR, "src"),
    "--declaration", "--target", "es2022", "--module", "nodenext",
    "--moduleResolution", "nodenext", "--strict", "--skipLibCheck",
    "--types", "node", "--noEmitOnError",
  ];
  execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "pipe", timeout: 120000, killSignal: "SIGKILL" });
  const emitted = filesUnder(outDir);
  const expected = RUNTIME_MODULES.flatMap(name => [`${name}.js`, `${name}.d.ts`]).sort();
  if (JSON.stringify(emitted) !== JSON.stringify(expected))
    throw new Error(`tsc emit mismatch: got [${emitted.join(", ")}]`);
  applyDivergences(outDir, OMA_DIVERGENCES);
  return emitted;
}

function packageMetadata() {
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (pkg.name !== EXPECTED_PACKAGE.name || pkg.version !== EXPECTED_PACKAGE.version ||
      pkg.repository?.directory !== "packages/pi-lsp")
    throw new Error(`upstream/package.json is not ${EXPECTED_PACKAGE.name}@${EXPECTED_PACKAGE.version}`);
  return {
    name: EXPECTED_PACKAGE.name,
    version: EXPECTED_PACKAGE.version,
    license: pkg.license ?? "MIT",
    repository: pkg.repository?.url ?? "https://github.com/narumiruna/pi-extensions",
    directory: "packages/pi-lsp",
    commit: EXPECTED_PACKAGE.commit,
    npm: {
      tarball: `https://registry.npmjs.org/${EXPECTED_PACKAGE.name}/-/pi-lsp-${EXPECTED_PACKAGE.version}.tgz`,
      integrity: EXPECTED_PACKAGE.npmIntegrity,
      shasum: EXPECTED_PACKAGE.npmShasum,
    },
  };
}

/** The manifest's own words, compared against what this script would
 * declare today: the divergence table must equal OMA_DIVERGENCES
 * (reason text and edit count, not just file names) and package.* must
 * equal the pinned upstream identity. A regenerated or hand-edited
 * manifest that drifted from the declared pins fails --check even when
 * every file record and the bundle digest still match. Exported so the
 * regression test can drive the same function the check runs. */
export function manifestMetadataProblems(manifest) {
  const problems = divergenceProblems(manifest, OMA_DIVERGENCES);
  const expectedPackage = packageMetadata();
  if (canonical(manifest?.package) !== canonical(expectedPackage))
    problems.push("manifest package does not match the pinned upstream identity");
  return problems;
}

function writeRuntime() {
  writeRuntimeTree(RUNTIME_DIR, emitRuntime, "oma-pi-lsp-emit-");
}

function writeManifest() {
  const records = bundleRecords(BUNDLE_DIR);
  const manifest = {
    kind: "oma-vendored-bundle-v1",
    package: packageMetadata(),
    generated: {
      runtime: "tsc emit of upstream/src library modules with OMA divergence splices applied; entry files (index.ts, pi-lsp.ts) are vendored but never compiled or loaded",
      tool: "scripts/vendor-pi-lsp.mjs",
      divergences: divergenceMetadata(OMA_DIVERGENCES),
    },
    files: records,
    bundleSha256: bundleDigest(records),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const problems = bundleRecordProblems(manifest, BUNDLE_DIR);
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (manifest.package?.name !== pkg.name || manifest.package?.version !== pkg.version)
    problems.push("manifest package identity does not match upstream/package.json");
  // The manifest's own metadata is verified too: the divergence table must
  // equal this script's OMA_DIVERGENCES and package.* the pinned identity,
  // so a regenerated manifest cannot launder a drifted splice set.
  problems.push(...manifestMetadataProblems(manifest));
  // The emitted runtime must be exactly what tsc produces from the vendored
  // sources plus the declared OMA divergence splices -- a hand-edited
  // runtime/ file fails here even if someone regenerated the manifest to
  // match it, and so does a runtime missing a declared splice.
  const scratch = mkdtempSync(join(tmpdir(), "oma-pi-lsp-check-"));
  try {
    problems.push(...emittedRuntimeProblems(scratch, emitRuntime(scratch), RUNTIME_DIR));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(`vendored pi-lsp bundle is inconsistent:\n${problems.map(p => `  - ${p}`).join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const write = process.argv.slice(2).includes("--write");
    if (write) { writeRuntime(); const manifest = writeManifest(); console.log(JSON.stringify({ status: "BUNDLE_WRITTEN", files: manifest.files.length, bundleSha256: manifest.bundleSha256 })); }
    else { check(); console.log(JSON.stringify({ status: "BUNDLE_CURRENT", files: bundleRecords(BUNDLE_DIR).length })); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
