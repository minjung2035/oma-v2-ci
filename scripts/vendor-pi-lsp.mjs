#!/usr/bin/env node
/** Vendored pi-lsp bundle maintenance — the only writer of
 * `src/extension/vendor/pi-lsp/runtime/` and `manifest.json`.
 *
 * `upstream/` is the exact npm tarball snapshot of @narumitw/pi-lsp and is
 * never touched here. `runtime/` is tsc's emit of the upstream library
 * modules (the extension-entry files index.ts/pi-lsp.ts are vendored but
 * never compiled or loaded — OMA's adapter owns registration). `--write`
 * rebuilds runtime/ and rewrites manifest.json; the default `--check`
 * verifies both against the tree so a hand-edited or partially copied
 * bundle fails instead of silently drifting.
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
  return emitted;
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
      runtime: "tsc emit of upstream/src library modules; entry files (index.ts, pi-lsp.ts) are vendored but never compiled or loaded",
      tool: "scripts/vendor-pi-lsp.mjs",
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
  // sources -- a hand-edited runtime/ file fails here even if someone
  // regenerated the manifest to match it.
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
