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
 * behavioral rewrite of what the server sees below the bound. */
const OMA_DIVERGENCES = Object.freeze({
  "lsp-client.js": {
    reason:
      "OMA bounds inside the wire path: stderr accumulation cap, inbound " +
      "frame buffer cap (incomplete or oversized Content-Length), bounded " +
      "pushed-diagnostic store (count/message/tracked files), a code-action " +
      "count cap so resolveAction loops stay bounded, and permanent 'error' " +
      "listeners on the child and its stdio so a post-start error can never " +
      "escape unhandled and crash the engine.",
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
const OMA_MAX_CODE_ACTIONS = 256;`,
      },
      {
        find: `        child.stderr.on("data", (chunk) => {
            this.#stderr += chunk.toString();
        });`,
        replace: `        child.stderr.on("data", (chunk) => {
            // OMA divergence: stderr is a bounded sample, not an accumulator.
            if (this.#stderr.length < OMA_MAX_STDERR_CHARS) {
                this.#stderr += chunk.toString();
                if (this.#stderr.length > OMA_MAX_STDERR_CHARS)
                    this.#stderr = \`\${this.#stderr.slice(0, OMA_MAX_STDERR_CHARS)}\\n[stderr truncated at OMA's \${OMA_MAX_STDERR_CHARS}-char bound]\`;
            }
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
        child.on("error", (error) => {
            const message = \`\${this.#adapter.name} LSP server process error: \${error.message}.\${this.#formatStderr()}\`;
            this.#rejectPending(message);
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
      "bounds the client enforces on the push path.",
    edits: [
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
