/** Build stamp: a skipped `npm run build` may only serve bytes the recorded
 * compile produced. The stamp once checked `existsSync && !isDirectory`, so
 * appended, same-size-patched, swapped (symlink) or extra dist files lived
 * forever. It now records size+sha256 for every file in dist plus the
 * directory set, and any drift falls back to rm+recompile.
 *
 * These tests drive the real scripts/build.mjs and scripts/check-package.mjs
 * inside a minimal repo-shaped fixture: the stamp logic only means anything
 * end to end, including the build-owned dist/libexec/oma write that lands
 * after tsc. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync, chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));

/** The smallest installation the real build/check-package contract accepts:
 * a tsconfig.build.json with rootDir "." and outDir "dist", the deployment
 * layout's compiled contract/schema/systemd/entry assets, and node_modules
 * (typescript, for tsc and check-package) linked from this repository. */
const FILES = {
  "package.json": JSON.stringify({
    name: "build-stamp-fixture", private: true, type: "module",
    bin: { oma: "dist/src/entry/oma.js" }, dependencies: {},
  }, null, 2),
  "package-lock.json": JSON.stringify({ name: "build-stamp-fixture", lockfileVersion: 3, packages: { "": {} } }, null, 2),
  // Only an input to the stamp hash; tsc reads the build config alone.
  "tsconfig.json": "{}\n",
  "tsconfig.build.json": JSON.stringify({
    compilerOptions: {
      rootDir: ".", outDir: "dist", module: "nodenext", moduleResolution: "nodenext",
      target: "es2022", strict: true, skipLibCheck: true, types: [],
    },
    include: ["src/**/*.ts", "implementation/contracts.ts"],
  }, null, 2),
  "implementation/schema-v3.sql": "SELECT 1;\n",
  "implementation/contracts.ts": "export const fixtureContract = 1;\n",
  "implementation/systemd/runner.service.in": "[Service]\nExecStart=@NODE@ @LIBDIR@/dist/src/entry/oma.js --serve\n",
  "src/domain/deployment.ts": `export const DEPLOYMENT_LAYOUT = Object.freeze({
    compiledRoot: "dist/src", contract: "dist/implementation/contracts.js",
    schema: "implementation/schema-v3.sql", systemd: "implementation/systemd",
    extension: "dist/src/pi-extension.js", modelCommand: "dist/libexec/oma",
    entries: Object.freeze({ tui: "dist/src/entry/oma.js" }),
    templateEntries: Object.freeze({ "runner.service.in": "tui" }),
    runtimeDependencies: Object.freeze([]),
  });`,
  "src/runtime/assets.ts": `import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
  export function runtimeAssets(root: string) {
    return Object.freeze({ root, schema: root + "/" + DEPLOYMENT_LAYOUT.schema, systemd: root + "/" + DEPLOYMENT_LAYOUT.systemd });
  }
  export function assertRuntimeAssets(assets: { schema: string; systemd: string },
      observed: { schema: string; systemd: string }): void {
    if (assets.schema !== observed.schema || assets.systemd !== observed.systemd) throw new Error("layout disagreement");
  }`,
  "src/sandbox.ts": `export function modelCommandScript(): string {
    return "#!/bin/sh\\nexec node dist/src/entry/oma.js \\"$@\\"\\n";
  }`,
  "src/entry/oma.ts": "#!/usr/bin/env node\nexport {};\n",
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-build-stamp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  mkdirSync(join(root, "scripts"));
  for (const script of ["build.mjs", "check-package.mjs"])
    writeFileSync(join(root, "scripts", script), readFileSync(join(repo, "scripts", script)));
  symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
  return root;
}

function build(root) {
  // NODE_TEST_CONTEXT* would make the fixture's node --test-aware children
  // believe they are nested tests; strip it like a real invocation's env.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_CONTEXT")));
  const run = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, env, encoding: "utf8", timeout: 120000 });
  assert.equal(run.status, 0, `fixture build failed:\n${run.stdout}\n${run.stderr}`);
  return run;
}

function assertRebuild(root, target, change, message) {
  // A deleted inode may be reused by the next compile. Keep the old output
  // alive until the assertion so inode identity proves replacement on disk
  // filesystems as well as tmpfs, including a removed or symlinked target.
  const held = openSync(target, "r");
  try {
    const before = fstatSync(held).ino;
    change();
    build(root);
    assert.notEqual(statSync(target).ino, before, message);
  } finally {
    closeSync(held);
  }
}

test("build stamp: a no-change build skips tsc instead of rewriting outputs", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/src/sandbox.js");
  const emitted = statSync(target).ino;
  build(root);
  assert.equal(statSync(target).ino, emitted, "the skip path rewrote a recorded output");
});

test("build stamp: appended, same-size-patched, swapped or removed outputs force a rebuild", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/src/domain/deployment.js");
  const pristine = readFileSync(target);
  assertRebuild(root, target, () => appendFileSync(target, "// CORRUPTED\n"),
    "appended bytes did not force a rebuild");
  assert.deepEqual(readFileSync(target), pristine, "the corrupted output was not restored");

  const patched = Buffer.from(pristine);
  patched[patched.length - 2] ^= 0x20;
  assertRebuild(root, target, () => writeFileSync(target, patched),
    "same-size patched bytes did not force a rebuild");
  assert.deepEqual(readFileSync(target), pristine, "the patched output was not restored");

  const swap = join(root, "swap-copy.js");
  writeFileSync(swap, pristine);
  assertRebuild(root, target, () => {
    rmSync(target);
    symlinkSync(swap, target);
  }, "a swapped-in symlink did not force a rebuild");
  assert.equal(lstatSync(target).isSymbolicLink(), false, "the swap left a symlink in dist");
  assert.deepEqual(readFileSync(target), pristine, "the swapped output was not restored");

  assertRebuild(root, target, () => rmSync(target), "a removed output did not force a rebuild");
  assert.deepEqual(readFileSync(target), pristine, "the removed output was not restored");
});

test("build stamp: extra files and directories in dist force a rebuild", t => {
  const root = fixture(t);
  build(root);
  const extra = join(root, "dist/src/junk-extra.js");
  writeFileSync(extra, "// junk\n");
  build(root);
  assert.equal(existsSync(extra), false, "an extra dist file survived the skip path");
  const stray = join(root, "dist/src/stray-dir");
  mkdirSync(stray);
  build(root);
  assert.equal(existsSync(stray), false, "an extra dist directory survived the skip path");
});

test("build stamp: a stamp without per-output hashes cannot skip", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/src/sandbox.js");
  const stamp = JSON.parse(readFileSync(join(root, "dist/.build-stamp.json"), "utf8"));
  // The retired format listed names only; its `existsSync` check is exactly
  // the hole, so a same-digest old-format stamp must still rebuild.
  assertRebuild(root, target, () => {
    writeFileSync(join(root, "dist/.build-stamp.json"), JSON.stringify({ digest: stamp.digest, outputs: ["src/sandbox.js"] }));
  }, "a name-only stamp skipped the compile");
});

test("build stamp: an edit to the build's own scripts is an input, not a free ride on the old stamp", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/src/sandbox.js");
  // The hashed input set once covered sources and configs but not the build
  // logic itself: a build.mjs or check-package.mjs edit changed what the
  // build produces while the stamp proved "inputs unchanged".
  for (const script of ["build.mjs", "check-package.mjs"]) {
    assertRebuild(root, target, () => appendFileSync(join(root, "scripts", script), `\n// a ${script} edit\n`),
      `an edit to scripts/${script} rode a stale skip`);
  }
});

test("build stamp: a mode-000 directory inside dist cannot wedge drift recovery", t => {
  const root = fixture(t);
  build(root);
  // The extra directory already fails the recorded-set check; rmSync's blind
  // listing then died EACCES on the mode-000 subdirectory and the build could
  // never recover. The drift removal repairs owner bits before listing.
  const locked = join(root, "dist/src/locked");
  mkdirSync(locked);
  writeFileSync(join(locked, "x.js"), "x\n");
  chmodSync(locked, 0o000);
  build(root);
  assert.equal(existsSync(locked), false, "the unreadable extra survived drift recovery");
});
