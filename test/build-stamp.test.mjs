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
    bin: { oma: "apps/oma/dist/entry/oma.js" }, dependencies: { "@oma/contracts": "0.1.0", "@oma/domain": "0.1.0" },
  }, null, 2),
  "package-lock.json": JSON.stringify({ name: "build-stamp-fixture", lockfileVersion: 3, packages: { "": {} } }, null, 2),
  // Only an input to the stamp hash; tsc reads the build config alone.
  "tsconfig.json": "{}\n",
  "tsconfig.build.json": JSON.stringify({
    compilerOptions: {
      rootDir: ".", outDir: "dist", module: "nodenext", moduleResolution: "nodenext",
      target: "es2022", strict: true, skipLibCheck: true, types: [],
    },
    include: ["test/**/*.ts"],
  }, null, 2),
  "packages/domain/src/schema.sql": "SELECT 1;\n",
  "packages/contracts/src/index.ts": "export const fixtureContract = 1;\n",
  ...Object.fromEntries(["contracts", "domain"].flatMap(name => [
    [`packages/${name}/package.json`, JSON.stringify({ name: `@oma/${name}`, version: "0.1.0", type: "module", exports: {
      [name === "contracts" ? "." : "./deployment"]: {
        types: `./dist/${name === "contracts" ? "index" : "deployment"}.d.ts`,
        default: `./dist/${name === "contracts" ? "index" : "deployment"}.js`,
      },
    }, ...(name === "domain" ? { oma: { assets: ["schema.sql"] } } : {}) })],
    [`packages/${name}/tsconfig.json`, JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist", module: "nodenext",
      moduleResolution: "nodenext", target: "es2022", strict: true, skipLibCheck: true, types: [], composite: true,
      declaration: true, tsBuildInfoFile: ".tsbuildinfo" }, include: ["src/**/*.ts"] })],
  ])),
  "apps/oma/src/test-native/probe.txt": "native build asset\n",
  "packages/domain/src/deployment.ts": `export const DEPLOYMENT_LAYOUT = Object.freeze({
    workspaces: [{ name: "@oma/contracts", root: "packages/contracts" }, { name: "@oma/domain", root: "packages/domain" }, { name: "@oma/app", root: "apps/oma" }],
    compiledRoot: "apps/oma/dist", contract: "packages/contracts/dist/index.js",
    schema: "packages/domain/dist/schema.sql", extension: "packages/extension/dist/index.js",
    modelCommand: "apps/oma/dist/libexec/oma", modelCommandBuilder: "packages/domain/dist/resident-paths.js",
    entries: Object.freeze({ tui: "apps/oma/dist/entry/oma.js" }), runtimeDependencies: Object.freeze([]),
  });`,
  "apps/oma/src/runtime/assets.ts": `import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
  export function runtimeAssets(root: string) {
    return Object.freeze({ root, schema: root + "/" + DEPLOYMENT_LAYOUT.schema });
  }
  export function assertRuntimeAssets(assets: { schema: string }, observed: { schema: string }): void {
    if (assets.schema !== observed.schema) throw new Error("layout disagreement");
  }`,
  "test/probe.ts": "export const fixture = 1;\n",
  "apps/oma/package.json": JSON.stringify({ name: "@oma/app", version: "0.1.0", private: true, type: "module",
    dependencies: {"@oma/domain":"0.1.0", "@oma/contracts":"0.1.0"}, bin:{oma:"dist/entry/oma.js"},
    exports:{"./runtime/assets":{types:"./dist/runtime/assets.d.ts",default:"./dist/runtime/assets.js"}},
    oma:{assets:["test-native"],modelCommand:"libexec/oma"} }),
  "apps/oma/tsconfig.json": JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist",module:"nodenext",moduleResolution:"nodenext",
    target:"es2022",strict:true,skipLibCheck:true,types:[],composite:true,declaration:true,tsBuildInfoFile:".tsbuildinfo"},
    include:["src/**/*.ts"],references:[{path:"../../packages/contracts"},{path:"../../packages/domain"}] }),
  "packages/domain/src/resident-paths.ts": `export function modelCommandScript(): string {
    return "#!/bin/sh\\nexec node apps/oma/dist/entry/oma.js \\"$@\\"\\n";
  }`,
  "apps/oma/src/entry/oma.ts": "#!/usr/bin/env node\nexport {};\n",
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-build-stamp-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  mkdirSync(join(root, "scripts"));
  for (const script of ["build.mjs", "check-package.mjs", "build-workspaces.mjs", "check-modules.mjs", "workspace-assets.mjs", "workspace-executables.mjs", "workspace-build-cache.mjs"])
    writeFileSync(join(root, "scripts", script), readFileSync(join(repo, "scripts", script)));
  mkdirSync(join(root, "node_modules/@oma"), { recursive: true });
  symlinkSync(join(repo, "node_modules/typescript"), join(root, "node_modules/typescript"), "dir");
  for (const name of ["contracts", "domain"])
    symlinkSync(join(root, "packages", name), join(root, "node_modules/@oma", name), "dir");
  symlinkSync(join(root, "apps/oma"), join(root, "node_modules/@oma/app"), "dir");
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

test("DR44: discovery, compile and package launch failures cannot certify a build with status zero", t => {
  for (const [phase, signal] of [[1, false], [2, false], [3, false], [4, false], [1, true]]) {
    const root = fixture(t);
    writeFileSync(join(root, "inject-child.mjs"), `
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = cp.spawnSync;
let calls = 0;
cp.spawnSync = (...args) => ++calls === ${phase}
  ? { status: 0, signal: ${signal ? '"SIGTERM"' : 'null'}, error: ${signal ? 'undefined' : 'Object.assign(new Error("injected EPERM"), { code: "EPERM" })'} }
  : spawn(...args);
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ["--import", "./inject-child.mjs", "scripts/build.mjs"],
      { cwd: root, encoding: "utf8", timeout: 120_000 });
    assert.equal(result.status, 1, `phase ${phase} was reported successful: ${result.stderr}`);
    assert.match(result.stderr, signal ? /SIGTERM/ : /injected EPERM/);
  }
});

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

test("build stamp: a no-change root test compile preserves its recorded outputs", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/test/probe.js");
  const emitted = statSync(target).ino;
  build(root);
  assert.equal(statSync(target).ino, emitted, "the skip path rewrote a recorded output");
});

test("build stamp: appended, same-size-patched, swapped or removed outputs force a rebuild", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/test/probe.js");
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
  const extra = join(root, "dist/test/junk-extra.js");
  writeFileSync(extra, "// junk\n");
  build(root);
  assert.equal(existsSync(extra), false, "an extra dist file survived the skip path");
  const stray = join(root, "dist/test/stray-dir");
  mkdirSync(stray);
  build(root);
  assert.equal(existsSync(stray), false, "an extra dist directory survived the skip path");
});

test("build stamp: a stamp without per-output hashes cannot skip", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/test/probe.js");
  const stamp = JSON.parse(readFileSync(join(root, "dist/.build-stamp.json"), "utf8"));
  // The retired format listed names only; its `existsSync` check is exactly
  // the hole, so a same-digest old-format stamp must still rebuild.
  assertRebuild(root, target, () => {
    writeFileSync(join(root, "dist/.build-stamp.json"), JSON.stringify({ digest: stamp.digest, outputs: ["test/probe.js"] }));
  }, "a name-only stamp skipped the compile");
});

test("build stamp: an edit to the build's own scripts is an input, not a free ride on the old stamp", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "dist/test/probe.js");
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
  const locked = join(root, "apps/oma/dist/locked");
  mkdirSync(locked);
  writeFileSync(join(locked, "x.js"), "x\n");
  chmodSync(locked, 0o000);
  build(root);
  assert.equal(existsSync(locked), false, "the unreadable extra survived drift recovery");
});

test("workspace cache: unchanged packages retain outputs; damaged outputs, modes and compiler state are restored", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "apps/oma/dist/entry/oma.js");
  const unrelated = join(root, "packages/contracts/dist/index.js");
  const original = readFileSync(target), inode = statSync(target).ino, unrelatedInode = statSync(unrelated).ino;
  const warm = build(root);
  assert.match(warm.stdout, /Workspace build: 0\/3 recompiled/);
  assert.equal(statSync(target).ino, inode);
  for (const change of [
    () => { const patched = Buffer.from(original); patched[patched.length - 2] ^= 0x20; writeFileSync(target, patched); },
    () => rmSync(target),
    () => { rmSync(target); symlinkSync(unrelated, target); },
    () => chmodSync(target, 0o644),
    () => writeFileSync(join(root, "apps/oma/.tsbuildinfo"), "untrusted compiler cache"),
    () => { mkdirSync(join(root, "apps/oma/dist/extra")); },
  ]) {
    assertRebuild(root, target, change, "workspace drift survived a cached build");
    assert.deepEqual(readFileSync(target), original);
    assert.equal(lstatSync(target).isSymbolicLink(), false);
    assert.equal(statSync(target).mode & 0o777, 0o755);
    assert.equal(existsSync(join(root, "apps/oma/dist/extra")), false);
    assert.equal(statSync(unrelated).ino, unrelatedInode, "an unrelated package was recompiled");
  }
});

test("workspace cache: dependency changes, added sources, config inheritance and asset edits invalidate their consumers", t => {
  const root = fixture(t);
  build(root);
  const target = join(root, "apps/oma/dist/entry/oma.js");
  assertRebuild(root, target, () => writeFileSync(join(root, "packages/contracts/src/index.ts"), "export const fixtureContract = 2;\n"),
    "a changed dependency did not rebuild its consumer");
  assert.match(readFileSync(join(root, "packages/contracts/dist/index.js"), "utf8"), /fixtureContract = 2/);
  writeFileSync(join(root, "packages/contracts/src/added.ts"), "export const added = true;\n");
  build(root);
  assert.equal(existsSync(join(root, "packages/contracts/dist/added.js")), true, "a new compiler input was missed");
  writeFileSync(join(root, "packages/contracts/compiler-options.json"), JSON.stringify({ compilerOptions: { removeComments: true } }));
  const configPath = join(root, "packages/contracts/tsconfig.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.extends = "./compiler-options.json";
  writeFileSync(configPath, JSON.stringify(config));
  build(root);
  assertRebuild(root, target, () => writeFileSync(join(root, "packages/contracts/compiler-options.json"), JSON.stringify({ compilerOptions: { removeComments: false } })),
    "an inherited compiler option did not invalidate its consumers");
  writeFileSync(join(root, "packages/domain/src/schema.sql"), "SELECT 2;\n");
  build(root);
  assert.equal(readFileSync(join(root, "packages/domain/dist/schema.sql"), "utf8"), "SELECT 2;\n");
});

test("workspace cache: changed external types and newly resolvable declarations cannot reuse old code", t => {
  const root = fixture(t);
  mkdirSync(join(root, "node_modules/fixture-types"));
  writeFileSync(join(root, "node_modules/fixture-types/package.json"), JSON.stringify({ name: "fixture-types", types: "index.d.ts" }));
  const external = join(root, "node_modules/fixture-types/index.d.ts");
  writeFileSync(external, "export type Value = number;\n");
  writeFileSync(join(root, "packages/contracts/src/index.ts"), 'import type { Value } from "fixture-types";\nexport const fixtureContract: Value = 1;\n');
  build(root);
  writeFileSync(external, "export type Value = string;\n");
  let run = spawnSync(process.execPath, ["scripts/build-workspaces.mjs"], { cwd: root, encoding: "utf8", timeout: 120000 });
  assert.notEqual(run.status, 0, "changed external types reused an old successful compile");
  assert.match(run.stdout + run.stderr, /not assignable/);
  writeFileSync(external, "export type Value = number;\n");
  writeFileSync(join(root, "packages/contracts/src/index.ts"), 'import type { Value } from "./shape.js";\nexport const fixtureContract: Value = 1;\n');
  writeFileSync(join(root, "packages/contracts/src/shape.d.ts"), "export type Value = number;\n");
  build(root);
  // shape.ts now wins over the old shape.d.ts, despite every previously read
  // declaration remaining byte-for-byte identical.
  writeFileSync(join(root, "packages/contracts/src/shape.ts"), "export type Value = string;\n");
  run = spawnSync(process.execPath, ["scripts/build-workspaces.mjs"], { cwd: root, encoding: "utf8", timeout: 120000 });
  assert.notEqual(run.status, 0, "newly resolvable input reused old code");
  assert.match(run.stdout + run.stderr, /not assignable/);
});

test("workspace cache: inputs changed after the compiler read cannot certify stale outputs", t => {
  for (const [file, next] of [
    ["packages/contracts/src/index.ts", "export const fixtureContract = 2;\n"],
    ["packages/contracts/tsconfig.json", JSON.stringify({ ...JSON.parse(FILES["packages/contracts/tsconfig.json"]),
      compilerOptions: { ...JSON.parse(FILES["packages/contracts/tsconfig.json"]).compilerOptions, removeComments: true } })],
    ["packages/domain/src/schema.sql", "SELECT 2;\n"],
  ]) {
    const root = fixture(t);
    writeFileSync(join(root, "edit-after-compile.mjs"), `
import cp from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const spawn = cp.spawnSync;
cp.spawnSync = (...args) => {
  const result = spawn(...args);
  if (args[1]?.includes("-b")) writeFileSync(${JSON.stringify(join(root, file))}, ${JSON.stringify(next)});
  return result;
};
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ["--import", "./edit-after-compile.mjs", "scripts/build-workspaces.mjs"],
      { cwd: root, encoding: "utf8", timeout: 120000 });
    assert.notEqual(result.status, 0, `${file}: a stale compile was recorded as current`);
    assert.match(result.stdout + result.stderr, /inputs changed during workspace build/);
    build(root);
    if (file.endsWith("index.ts")) assert.match(readFileSync(join(root, "packages/contracts/dist/index.js"), "utf8"), /fixtureContract = 2/);
    if (file.endsWith("schema.sql")) assert.equal(readFileSync(join(root, "packages/domain/dist/schema.sql"), "utf8"), next);
    assert.match(build(root).stdout, /Workspace build: 0\/3 recompiled/);
  }
});

test("workspace build: dependency declaration assets precede consumers and cannot occupy compiler outputs", t => {
  const root = fixture(t), manifestPath = join(root, "packages/contracts/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.oma = { assets: ["vendor"] };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  mkdirSync(join(root, "packages/contracts/src/vendor"));
  writeFileSync(join(root, "packages/contracts/src/vendor/api.d.ts"), "export type AssetType = 42;\n");
  writeFileSync(join(root, "packages/contracts/src/index.ts"), 'export type { AssetType } from "./vendor/api.js";\n');
  writeFileSync(join(root, "apps/oma/src/type-probe.ts"), 'import type { AssetType } from "@oma/contracts";\nexport const value: AssetType = "wrong";\n');
  let run = spawnSync(process.execPath, ["scripts/build-workspaces.mjs"], { cwd: root, encoding: "utf8", timeout: 120000 });
  assert.notEqual(run.status, 0, "a consumer compiled against a missing declaration asset");
  assert.match(run.stdout + run.stderr, /not assignable to type '42'/);
  writeFileSync(join(root, "apps/oma/src/type-probe.ts"), 'import type { AssetType } from "@oma/contracts";\nexport const value: AssetType = 42;\n');
  build(root);
  assert.match(build(root).stdout, /Workspace build: 0\/3 recompiled/);
  manifest.oma.assets = ["index.js"];
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(join(root, "packages/contracts/src/index.js"), "compiler output must never replace this asset\n");
  run = spawnSync(process.execPath, ["scripts/build-workspaces.mjs"], { cwd: root, encoding: "utf8", timeout: 120000 });
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /asset overlaps compiler output/);
});

test("workspace cache: source asset permission changes update the installed mode", t => {
  const root = fixture(t);
  build(root);
  chmodSync(join(root, "packages/domain/src/schema.sql"), 0o700);
  build(root);
  assert.equal(statSync(join(root, "packages/domain/dist/schema.sql")).mode & 0o7777, 0o700);
  assert.match(build(root).stdout, /Workspace build: 0\/3 recompiled/);
});
