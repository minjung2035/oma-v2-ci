#!/usr/bin/env node
/** Vendored pi-lsp bundle maintenance — the only writer of
 * `src/extension/vendor/pi-lsp/runtime/` and `manifest.json`.
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
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(root, "src/extension/vendor/pi-lsp");
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
      "OMA bounds inside the wire path: stderr accumulation cap (tracked " +
      "by an explicit dropped flag so an exact landing followed by more " +
      "bytes still marks truncation), inbound frame buffer cap (incomplete " +
      "or oversized Content-Length), bounded pushed-diagnostic store " +
      "(count/message/tracked files), a code-action count cap so " +
      "resolveAction loops stay bounded, and permanent 'error' listeners " +
      "on the child and its stdio -- the child 'error' handler also kills " +
      "the process, so a post-start error can neither crash the engine " +
      "nor orphan the server.",
    edits: [
      {
        find: "const PROCESS_EXIT_GRACE_MS = 500;",
        replace: `const PROCESS_EXIT_GRACE_MS = 500;
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
    #stderrDropped = false;`,
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
        // OMA divergence: a frame that never completes -- or declares a
        // Content-Length past the ceiling -- must not grow this buffer
        // without bound. Fail the call and kill the server instead.
        if (this.#buffer.length > OMA_MAX_INBOUND_FRAME_BYTES) {
            this.#buffer = Buffer.alloc(0);
            this.#fail(\`\${this.#adapter.name} LSP server output exceeded OMA's \${OMA_MAX_INBOUND_FRAME_BYTES}-byte inbound bound.\${this.#formatStderr()}\`);
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
            // OMA divergence: refuse a declared oversized body up front rather
            // than buffering until the accumulation bound trips.
            if (bodyLength > OMA_MAX_INBOUND_FRAME_BYTES)
                throw new Error(\`declared Content-Length \${bodyLength} exceeds OMA's \${OMA_MAX_INBOUND_FRAME_BYTES}-byte bound\`);
            if (this.#buffer.length < bodyStart + bodyLength)
                return;`,
      },
      {
        find: `            if (params?.uri) {
                const key = documentKey(params.uri);`,
        replace: `            if (params?.uri) {
                // OMA divergence: pushed diagnostics are bounded -- per-file
                // count, per-message length, and the number of distinct
                // documents tracked. A flood fails the call rather than
                // growing the store without limit.
                const pushed = Array.isArray(params.diagnostics) ? params.diagnostics : [];
                if (pushed.length > OMA_MAX_DIAGNOSTICS_PER_FILE) {
                    this.#fail(\`\${this.#adapter.name} LSP pushed \${pushed.length} diagnostics for one file; OMA's bound is \${OMA_MAX_DIAGNOSTICS_PER_FILE}.\`);
                    return;
                }
                for (const diagnostic of pushed) {
                    if (typeof diagnostic?.message === "string" && diagnostic.message.length > OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS) {
                        this.#fail(\`\${this.#adapter.name} LSP pushed a \${diagnostic.message.length}-char diagnostic message; OMA's bound is \${OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS}.\`);
                        return;
                    }
                }
                const key = documentKey(params.uri);
                if (!this.#publishedDiagnostics.has(key) && this.#publishedDiagnostics.size >= OMA_MAX_DIAGNOSTIC_URIS) {
                    this.#fail(\`\${this.#adapter.name} LSP pushed diagnostics for more than \${OMA_MAX_DIAGNOSTIC_URIS} documents; OMA's bound was exceeded.\`);
                    return;
                }`,
      },
      {
        find: `    async resolveActions(actions) {
        // Only resolve when the server advertised resolveProvider; otherwise use the`,
        replace: `    async resolveActions(actions) {
        // OMA divergence: every unresolved action is a codeAction/resolve
        // round-trip, so an unbounded action list is an unbounded sequential
        // request loop. Refuse past the cap instead.
        if (actions.length > OMA_MAX_CODE_ACTIONS)
            throw new Error(\`\${this.#adapter.name} LSP returned \${actions.length} code actions; OMA's bound is \${OMA_MAX_CODE_ACTIONS}.\`);
        // Only resolve when the server advertised resolveProvider; otherwise use the`,
      },
    ],
  },
  "runner.js": {
    reason:
      "OMA bounds on the read and on what a pull response carries: the file " +
      "can grow between the admission stat and the read, and a pull " +
      "diagnostics array gets the same per-file count and per-message " +
      "bounds the client enforces on the push path. The accumulated " +
      "workspace-edit list across all selected actions is bounded in count " +
      "and newText bytes -- per-list bounds alone leave action-count " +
      "times the list bound.",
    edits: [
      {
        find: `import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits } from "./text-edits.js";`,
        replace: `import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits, OMA_MAX_WORKSPACE_EDITS, OMA_MAX_WORKSPACE_EDIT_BYTES } from "./text-edits.js";`,
      },
      {
        find: "export const DEFAULT_FILE_LIMIT = 50;",
        replace: `export const DEFAULT_FILE_LIMIT = 50;
// OMA divergences (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json): what was read is bounded a
// second time (the admission stat can be out of date), and a pull
// response's diagnostics get the same count/message bounds the client
// enforces on the push path.
const OMA_MAX_FILE_BYTES = 1024 * 1024;
const OMA_MAX_DIAGNOSTICS_PER_FILE = 1024;
const OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS = 8 * 1024;
function boundedDiagnostics(adapter, file, diagnostics) {
    if (diagnostics.length > OMA_MAX_DIAGNOSTICS_PER_FILE)
        throw new Error(\`\${adapter.name} LSP returned \${diagnostics.length} diagnostics for \${file}; OMA's bound is \${OMA_MAX_DIAGNOSTICS_PER_FILE}.\`);
    for (const diagnostic of diagnostics)
        if (typeof diagnostic?.message === "string" && diagnostic.message.length > OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS)
            throw new Error(\`\${adapter.name} LSP returned a \${diagnostic.message.length}-char diagnostic message for \${file}; OMA's bound is \${OMA_MAX_DIAGNOSTIC_MESSAGE_CHARS}.\`);
    return diagnostics;
}`,
      },
      {
        find: `                const uri = pathToFileURL(file).href;
                const text = readFileSync(file, "utf8");
                client.didOpen(uri, text, adapter.languageIdFor(file));`,
        replace: `                const uri = pathToFileURL(file).href;
                const text = readFileSync(file, "utf8");
                // OMA divergence: the file can grow between the admission
                // stat and this read; bound what was actually read.
                if (Buffer.byteLength(text, "utf8") > OMA_MAX_FILE_BYTES)
                    throw new Error(\`\${adapter.name} file exceeded OMA's \${OMA_MAX_FILE_BYTES}-byte bound when read: \${file}\`);
                client.didOpen(uri, text, adapter.languageIdFor(file));`,
      },
      {
        find: `        const uri = pathToFileURL(file).href;
        const text = readFileSync(file, "utf8");
        client.didOpen(uri, text, adapter.languageIdFor(file));`,
        replace: `        const uri = pathToFileURL(file).href;
        const text = readFileSync(file, "utf8");
        // OMA divergence: the file can grow between the admission stat and
        // this read; bound what was actually read.
        if (Buffer.byteLength(text, "utf8") > OMA_MAX_FILE_BYTES)
            throw new Error(\`\${adapter.name} file exceeded OMA's \${OMA_MAX_FILE_BYTES}-byte bound when read: \${file}\`);
        client.didOpen(uri, text, adapter.languageIdFor(file));`,
      },
      {
        find: `                diagnostics: await client.diagnostics(uri),`,
        replace: `                diagnostics: boundedDiagnostics(adapter, file, await client.diagnostics(uri)),`,
      },
      {
        find: `            const diagnostics = await client.diagnostics(uri);`,
        replace: `            const diagnostics = boundedDiagnostics(adapter, file, await client.diagnostics(uri));`,
      },
      {
        find: `            edits = selectedActions.flatMap((action) => collectWorkspaceEdits(action.edit, uri));`,
        replace: `            // OMA divergence: the accumulated list is bounded across ALL
            // selected actions, not only per action -- and it is counted as
            // it accumulates, so an over-bound action set fails before the
            // whole list is materialized.
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
      "OMA bound on workspace walk recursion depth: deeper trees are skipped " +
      "rather than recursed into without limit.",
    edits: [
      {
        find: `function collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, limit) {
    if (files.length >= limit || !existsSync(targetPath))
        return;`,
        replace: `// OMA divergence (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json): recursion depth is bounded.
const OMA_MAX_COLLECT_DEPTH = 256;
function collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, limit, depth = 0) {
    if (files.length >= limit || !existsSync(targetPath) || depth > OMA_MAX_COLLECT_DEPTH)
        return;`,
      },
      {
        find: `        collectPath(adapter, path.join(targetPath, entry.name), files, seen, visitedDirectories, realRoot, limit);`,
        replace: `        collectPath(adapter, path.join(targetPath, entry.name), files, seen, visitedDirectories, realRoot, limit, depth + 1);`,
      },
    ],
  },
  "text-edits.js": {
    reason:
      "OMA bounds on what a resolved code action may carry: collected " +
      "workspace edits are refused past a count bound and a newText byte " +
      "bound -- mid-collection, not after a flatMap materialized the whole " +
      "list. The overlap check is a sorted sweep instead of a synchronous " +
      "O(n^2) pair scan no AbortSignal could interrupt, and application is " +
      "one pass over the ordered edits instead of rebuilding the string " +
      "once per edit.",
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

const slash = value => value.split(sep).join("/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

/** Every bundle file except the manifest itself, sorted; the manifest is
 * the index over this set, never a member of it. */
function bundleFiles() {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const rel = slash(relative(BUNDLE_DIR, absolute));
        if (rel !== "manifest.json") out.push(rel);
      }
    }
  };
  walk(BUNDLE_DIR);
  return out.sort();
}

function bundleRecords() {
  return bundleFiles().map(path => {
    const bytes = readFileSync(join(BUNDLE_DIR, path));
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  });
}

/** The multi-file digest is over the sorted (path, sha256) pairs so the
 * set is bound as a whole, not per file. */
function bundleDigest(records) {
  const hash = createHash("sha256");
  for (const { path, sha256: digest } of records) hash.update(`${path}\0${digest}\n`);
  return hash.digest("hex");
}

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
  const emitted = bundleFilesUnder(outDir);
  const expected = RUNTIME_MODULES.flatMap(name => [`${name}.js`, `${name}.d.ts`]).sort();
  if (JSON.stringify(emitted) !== JSON.stringify(expected))
    throw new Error(`tsc emit mismatch: got [${emitted.join(", ")}]`);
  applyDivergences(outDir);
  return emitted;
}

/** Apply OMA's declared splices to an emitted runtime tree in place. Every
 * `find` anchor must occur exactly once in the emitted file: zero means the
 * upstream emit drifted and the splice lost its anchor; more than one means
 * the anchor was ambiguous. Both are regeneration failures, not silently
 * skipped edits. */
function applyDivergences(dir) {
  for (const [name, divergence] of Object.entries(OMA_DIVERGENCES)) {
    const target = join(dir, name);
    let text = readFileSync(target, "utf8");
    divergence.edits.forEach((edit, index) => {
      const occurrences = text.split(edit.find).length - 1;
      if (occurrences !== 1)
        throw new Error(`divergence ${name}#${index + 1}: anchor occurs ${occurrences} times in tsc emit; expected exactly 1`);
      text = text.replace(edit.find, edit.replace);
    });
    writeFileSync(target, text);
  }
}

function bundleFilesUnder(base) {
  const out = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) out.push(slash(relative(base, absolute)));
    }
  };
  walk(base);
  return out.sort();
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
  const problems = [];
  // Canonical JSON: key order is not a difference, content is.
  const canonical = value => JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v);
  const expectedDivergences = Object.fromEntries(
    Object.entries(OMA_DIVERGENCES).map(([file, { reason, edits }]) => [file, { reason, edits: edits.length }]));
  const declaredDivergences = manifest?.generated?.divergences;
  const shape = value => Object.keys(value ?? {}).sort();
  if (JSON.stringify(shape(declaredDivergences)) !== JSON.stringify(shape(expectedDivergences)))
    problems.push("manifest generated.divergences names a different divergent-file set than OMA_DIVERGENCES");
  else {
    for (const [file, expected] of Object.entries(expectedDivergences)) {
      const declared = declaredDivergences[file];
      if (declared?.reason !== expected.reason || declared?.edits !== expected.edits)
        problems.push(`manifest generated.divergences["${file}"] does not match OMA_DIVERGENCES`);
    }
  }
  const expectedPackage = packageMetadata();
  if (canonical(manifest?.package) !== canonical(expectedPackage))
    problems.push("manifest package does not match the pinned upstream identity");
  return problems;
}

function writeRuntime() {
  const scratch = mkdtempSync(join(tmpdir(), "oma-pi-lsp-emit-"));
  try {
    emitRuntime(scratch);
    // Deterministic write: delete the old tree only after the new emit is
    // complete, then move the files in sorted order.
    rmSync(RUNTIME_DIR, { recursive: true, force: true });
    mkdirSync(RUNTIME_DIR, { recursive: true });
    for (const name of bundleFilesUnder(scratch))
      copyFileSync(join(scratch, name), join(RUNTIME_DIR, name));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function writeManifest() {
  const records = bundleRecords();
  const manifest = {
    kind: "oma-vendored-bundle-v1",
    package: packageMetadata(),
    generated: {
      runtime: "tsc emit of upstream/src library modules with OMA divergence splices applied; entry files (index.ts, pi-lsp.ts) are vendored but never compiled or loaded",
      tool: "scripts/vendor-pi-lsp.mjs",
      divergences: Object.fromEntries(Object.entries(OMA_DIVERGENCES).map(([file, { reason, edits }]) => [file, { reason, edits: edits.length }])),
    },
    files: records,
    bundleSha256: bundleDigest(records),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const records = bundleRecords();
  const problems = [];
  const listed = new Map((manifest.files ?? []).map(entry => [entry.path, entry]));
  for (const { path, bytes, sha256: digest } of records) {
    const entry = listed.get(path);
    if (!entry) problems.push(`unlisted bundle file: ${path}`);
    else if (entry.bytes !== bytes || entry.sha256 !== digest) problems.push(`bundle file changed: ${path}`);
  }
  for (const path of listed.keys()) if (!records.some(record => record.path === path)) problems.push(`manifest names missing file: ${path}`);
  if (manifest.bundleSha256 !== bundleDigest(records)) problems.push("bundle digest does not cover current files");
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
    for (const name of emitRuntime(scratch)) {
      const emitted = readFileSync(join(scratch, name));
      const vendoredPath = join(RUNTIME_DIR, name);
      const vendored = lstatSync(vendoredPath, { throwIfNoEntry: false })?.isFile() ? readFileSync(vendoredPath) : null;
      if (vendored === null || sha256(vendored) !== sha256(emitted)) problems.push(`runtime/${name} differs from tsc emit of vendored upstream`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(`vendored pi-lsp bundle is inconsistent:\n${problems.map(p => `  - ${p}`).join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const write = process.argv.slice(2).includes("--write");
    if (write) { writeRuntime(); const manifest = writeManifest(); console.log(JSON.stringify({ status: "BUNDLE_WRITTEN", files: manifest.files.length, bundleSha256: manifest.bundleSha256 })); }
    else { check(); console.log(JSON.stringify({ status: "BUNDLE_CURRENT", files: bundleRecords().length })); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
