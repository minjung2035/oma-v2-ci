#!/usr/bin/env node
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(root, "tsconfig.build.json"), "utf8"));
if (config.compilerOptions?.rootDir !== "." || config.compilerOptions?.outDir !== "dist")
  throw new Error("deployment layout requires rootDir='.' and outDir='dist'; no implicit flattening");
const output = join(root, "dist");
if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("refuse to clean a symlinked outDir");
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");

// A no-change rebuild is pure cost: `tsc --listFilesOnly` resolves the exact
// file set the compile will read, so hashing every listed input (plus the
// configs, the compiler itself and the lockfile that can swap types under it)
// proves the outputs must be identical. The stamp holds the same proof for the
// output side: every file the build left in dist, recorded with its size and
// sha256, and every directory. A skipped build re-lists dist and re-hashes
// each recorded file, so appended, patched, truncated or swapped bytes (a
// symlink is not the regular file the compile wrote), missing outputs and
// extra files all fail the check and fall back to the full clean compile --
// a skip can never serve bytes the recorded compile did not produce. The
// stamp is a cache, not a signature: it detects drift, it cannot authenticate
// a hand-edited stamp.
const stampPath = join(output, ".build-stamp.json");
const slash = value => value.split(sep).join("/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
// Every regular file under dist except the stamp itself, plus every directory.
// Nonregular entries (symlinks, fifos, sockets) land in `files`, where the
// recorded-hash check rejects them.
const listDist = () => {
  const files = [], dirs = [];
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) { dirs.push(slash(relative(output, absolute))); walk(absolute); }
      else if (absolute !== stampPath) files.push(slash(relative(output, absolute)));
    }
  };
  walk(output);
  return { files: files.sort(), dirs: dirs.sort() };
};
const hash = createHash("sha256");
const listed = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json"), "--listFilesOnly"], {
  cwd: root, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL",
});
if (listed.error || listed.signal || listed.status !== 0) process.exit(listed.status ?? 1);
// Vendored bundled-extension payloads are excluded from tsc's file list (the
// tsconfigs exempt the tree) but are still build inputs: they are copied to
// dist verbatim below, so a vendored byte change must poison the skip stamp.
const vendoredInputs = [];
const collectVendored = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) collectVendored(absolute);
    else if (entry.isFile()) vendoredInputs.push(slash(relative(root, absolute)));
  }
};
const vendorSource = join(root, "src", "extension", "vendor");
if (lstatSync(vendorSource, { throwIfNoEntry: false })?.isDirectory()) collectVendored(vendorSource);
vendoredInputs.sort();
const extraInputs = ["tsconfig.json", "tsconfig.build.json", "package.json", "package-lock.json",
  join("node_modules", "typescript", "package.json"),
  // The build logic itself and the checker it drives are inputs too: an edit
  // to either changes what a build produces and must not ride a stale skip.
  join("scripts", "build.mjs"), join("scripts", "check-package.mjs"),
  ...vendoredInputs];
for (const name of [...listed.stdout.trim().split(/\r?\n/).sort(), ...extraInputs]) {
  const absolute = resolve(root, name);
  hash.update(relative(root, absolute).split(sep).join("/"));
  hash.update("\0");
  hash.update(readFileSync(absolute));
  hash.update("\0");
}
const digest = hash.digest("hex");
let prior = {};
try { prior = JSON.parse(readFileSync(stampPath, "utf8")); } catch { /* no stamp: full build */ }
let fresh = prior && typeof prior === "object" && prior.digest === digest &&
  prior.outputs && typeof prior.outputs === "object" &&
  prior.outputs.files && typeof prior.outputs.files === "object" && Array.isArray(prior.outputs.dirs);
if (fresh) try {
  const actual = listDist();
  const recorded = prior.outputs.files;
  fresh = JSON.stringify(actual.dirs) === JSON.stringify([...prior.outputs.dirs].sort()) &&
    JSON.stringify(actual.files) === JSON.stringify(Object.keys(recorded).sort()) &&
    actual.files.every(rel => {
      const absolute = join(output, rel);
      const entry = recorded[rel];
      const stat = lstatSync(absolute);
      return stat.isFile() && stat.size === entry.bytes && sha256(readFileSync(absolute)) === entry.sha256;
    });
} catch { fresh = false; }
// dist is this build's own product, not a state tree, so removal goes by
// path -- but the same lost-owner-bits failure shape applies: a directory a
// stray or a crashed tool left at mode-000 wedges a blind recursive rm on
// the listing itself, so each directory gets its owner read/write/search
// bits back before it is listed (added, never stripped: special bits keep),
// the repair the owned-tree primitives make. Links are unlinked, never
// followed.
const removeTree = path => {
  const observed = lstatSync(path, { throwIfNoEntry: false });
  if (observed === undefined) return;
  if (!observed.isDirectory()) { unlinkSync(path); return; }
  if ((observed.mode & 0o700) !== 0o700) chmodSync(path, (observed.mode & 0o7777) | 0o700);
  for (const name of readdirSync(path)) removeTree(join(path, name));
  rmdirSync(path);
};
if (!fresh) {
  removeTree(output);
  const compiled = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
    cwd: root, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL",
  });
  if (compiled.error || compiled.signal || compiled.status !== 0) process.exit(compiled.status ?? 1);
  // The vendored bundled-extension payloads are excluded from compilation
  // (tsconfig exclude), but they are deployed payload: the trusted
  // extension's adapter statically imports runtime/ and the deployment
  // digest's dist walk must cover every vendored byte. The copy is exact --
  // byte-identical, no rewrites -- so the source-side bundle digest
  // (manifest.json) also covers the deployed tree.
  if (lstatSync(vendorSource, { throwIfNoEntry: false })?.isDirectory()) {
    const copyTree = (from, to) => {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const sourceEntry = join(from, entry.name), targetEntry = join(to, entry.name);
        if (entry.isDirectory()) copyTree(sourceEntry, targetEntry);
        else if (entry.isFile()) writeFileSync(targetEntry, readFileSync(sourceEntry));
        else throw new Error(`nonregular vendored payload entry: ${slash(relative(root, sourceEntry))}`);
      }
    };
    copyTree(vendorSource, join(output, "src", "extension", "vendor"));
  }
}
// Rebuilding a linked package must preserve executable permissions for its commands.
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const commands = typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
for (const command of commands) chmodSync(join(root, command), 0o755);
// AV16, CLI-001: the sandbox's `oma` command, written from its one owner.
{
  const { DEPLOYMENT_LAYOUT } = await import(pathToFileURL(join(output, "src/domain/deployment.js")).href);
  const { modelCommandScript } = await import(pathToFileURL(join(output, "src/sandbox.js")).href);
  const command = join(root, DEPLOYMENT_LAYOUT.modelCommand);
  mkdirSync(dirname(command), { recursive: true });
  writeFileSync(command, modelCommandScript(), { mode: 0o755 });
  chmodSync(command, 0o755);
}
// The stamp is recorded only after every build-owned write -- the model
// command above lands inside dist -- so the recorded set is the whole tree.
if (!fresh) {
  const emitted = listDist();
  const files = {};
  for (const rel of emitted.files) {
    const absolute = join(output, rel);
    files[rel] = { bytes: lstatSync(absolute).size, sha256: sha256(readFileSync(absolute)) };
  }
  writeFileSync(stampPath, JSON.stringify({ digest, outputs: { files, dirs: emitted.dirs } }));
}
const checked = spawnSync(process.execPath, [join(root, "scripts/check-package.mjs"), "--root", root], {
  cwd: root, stdio: "inherit", timeout: 60000, killSignal: "SIGKILL",
});
if (checked.error || checked.signal || checked.status !== 0) process.exit(checked.status ?? 1);
