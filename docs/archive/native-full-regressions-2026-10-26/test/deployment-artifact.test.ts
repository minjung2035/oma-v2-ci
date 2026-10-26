/** V31A/V31B (WP31): the installation, alone. The declared deployment is a built
 * tree used as `installation.libdir` (DEPLOYMENT_LAYOUT; `check:package` checks
 * it). The closure -- compiled code, schema, unit templates, manifests and the
 * lockfile's production dependencies -- is copied to a fresh prefix and run with
 * every module resolution and file read that reaches back into the source tree
 * refused. The engine used is the one the prefix ships; an installation without
 * one is refused rather than handed another installation's. The package check
 * names a missing asset, a stale entry and a dependency that is not the locked one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const source = fileURLToPath(new URL("../../", import.meta.url));
const CHECK = pathToFileURL(join(source, "scripts/check-package.mjs")).href;
const ENGINE = "@earendil-works/pi-coding-agent";
import { copyInstalledProduct, productionModulePaths } from "./fixtures/installation.js";

function install(prefix: string, options: { engine?: boolean } = {}): void {
  copyInstalledProduct(source, prefix, options);
}

/** Runs `script` with node, refusing any module resolution or file read into the source tree. */
function guarded(work: string, script: string, env: Record<string, string> = {}) {
  const guard = join(work, "guard.mjs");
  writeFileSync(guard, `import { register, syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
const forbidden = ${JSON.stringify(source)};
const url = ${JSON.stringify(pathToFileURL(source).href)};
register("data:text/javascript," + encodeURIComponent(\`export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (result.url.startsWith(\${JSON.stringify(url)})) throw new Error("resolved into the source tree: " + result.url);
  return result;
}\`));
for (const name of ["readFileSync", "openSync", "statSync", "lstatSync", "existsSync", "readdirSync", "realpathSync"]) {
  const original = fs[name];
  fs[name] = function (path, ...rest) {
    const target = typeof path === "string" ? path : path instanceof URL ? path.pathname : "";
    if (target.startsWith(forbidden)) throw new Error("read the source tree: " + target);
    return original.call(this, path, ...rest);
  };
}
syncBuiltinESMExports();
`);
  const file = join(work, "probe.mjs");
  writeFileSync(file, script);
  return spawnSync(process.execPath, ["--import", guard, file], { cwd: work, encoding: "utf8", timeout: 60_000,
    env: { PATH: "/usr/bin:/bin", HOME: work, ...env } });
}

test("V31A: the installation alone resolves its entries, schema, templates and its own engine", { timeout: 120_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), "oma-v31a-"));
  try {
    const prefix = join(work, "install");
    install(prefix);
    const { checkPackage } = await import(CHECK) as { checkPackage(root: string): Promise<unknown> };
    await checkPackage(prefix);
    const run = guarded(work, `
import { spawnSync } from "node:child_process";
const prefix = ${JSON.stringify(prefix)};
const { resolvePiRuntime } = await import(prefix + "/packages/engine/dist/pi-runtime.js");
const { runtimeAssets, assertRuntimeAssets } = await import(prefix + "/apps/oma/dist/runtime/assets.js");
const { DEPLOYMENT_LAYOUT } = await import(prefix + "/packages/domain/dist/deployment.js");
const assets = runtimeAssets(prefix);
assertRuntimeAssets(assets, { schema: prefix + "/" + DEPLOYMENT_LAYOUT.schema, systemd: prefix + "/" + DEPLOYMENT_LAYOUT.systemd });
const runtime = resolvePiRuntime({ stateRoot: ${JSON.stringify(join(work, "state"))}, libdir: prefix });
const version = spawnSync(runtime.executable, [...runtime.args, "--version"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: ${JSON.stringify(work)} } });
const entries = {};
for (const [name, path] of Object.entries(DEPLOYMENT_LAYOUT.entries)) {
  if (name === "tui" || name === "personalHost") continue;
  const loaded = spawnSync(process.execPath, [prefix + "/" + path, ...(name === "society" ? ["--help"] : [])], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: ${JSON.stringify(work)} } });
  entries[name] = { status: loaded.status, stderr: loaded.stderr.slice(0, 300) };
}
const cli = spawnSync(process.execPath, [prefix + "/" + DEPLOYMENT_LAYOUT.cli], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: ${JSON.stringify(work)} } });
console.log(JSON.stringify({ bundle: runtime.bundle, version: version.stdout.trim(), versionStatus: version.status, entries,
  cli: { status: cli.status, stderr: cli.stderr.slice(0, 200) } }));
`);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim().split("\n").at(-1)!);
    assert.ok(result.bundle.startsWith(`${prefix}/node_modules/${ENGINE}/`), `the engine came from elsewhere: ${result.bundle}`);
    assert.equal(result.versionStatus, 0);
    assert.equal(result.version, JSON.parse(readFileSync(join(prefix, "node_modules", ENGINE, "package.json"), "utf8")).version);
    // Each unit entry loads its whole module graph from the prefix and stops at
    // its own usage check; none reached into the source tree.
    for (const [name, loaded] of Object.entries(result.entries as Record<string, { status: number; stderr: string }>)) {
      if (name === "society") assert.equal(loaded.status, 0, loaded.stderr);
      else assert.notEqual(loaded.status, 0, `${name} started without arguments`);
      assert.doesNotMatch(loaded.stderr, /source tree|Cannot find module|ERR_MODULE_NOT_FOUND/, `${name}: ${loaded.stderr}`);
    }
    assert.equal(result.cli.status, 2, result.cli.stderr);
    assert.match(result.cli.stderr, /usage:/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("V31A: an installation without its engine is refused, not handed another installation's", { timeout: 120_000 }, () => {
  const work = mkdtempSync(join(tmpdir(), "oma-v31a-"));
  try {
    const prefix = join(work, "install");
    install(prefix, { engine: false });
    // Another installation's engine, where directory-walking resolution would
    // find it. 1.0.1 does not vendor its dependencies inside the package, so a
    // real foreign installation is the whole production closure, not the engine
    // directory alone.
    for (const module of productionModulePaths(source))
        cpSync(join(source, module), join(work, module), { recursive: true, verbatimSymlinks: true });
    const run = guarded(work, `
const { resolvePiRuntime } = await import(${JSON.stringify(prefix)} + "/packages/engine/dist/pi-runtime.js");
try { const runtime = resolvePiRuntime({ stateRoot: ${JSON.stringify(join(work, "state"))}, libdir: ${JSON.stringify(prefix)} }); console.log(JSON.stringify({ bundle: runtime.bundle })); }
catch (error) { console.log(JSON.stringify({ code: error.code, message: error.message })); }
`);
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout.trim().split("\n").at(-1)!);
    assert.equal(result.bundle, undefined, `another installation's engine was used: ${result.bundle}`);
    assert.equal(result.code, "UNSUPPORTED_PROFILE");
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test("V31B: the package check names a missing asset, a stale entry and a dependency that is not the locked one", { timeout: 120_000 }, async () => {
  const { checkPackage } = await import(CHECK) as { checkPackage(root: string): Promise<unknown> };
  for (const [name, damage, expected] of [
    ["missing unit template", (prefix: string) => rmSync(join(prefix, "packages/platform-linux/dist/systemd/resident.service.in")), /resident\.service\.in|missing|asset/i],
    ["stale entry", (prefix: string) => rmSync(join(prefix, "apps/oma/dist/entry/runner.js")), /runner\.js|missing/i],
    ["missing Personal engine", (prefix: string) => rmSync(join(prefix, "apps/oma/dist/entry/pi-personal.js")), /pi-personal\.js|missing/i],
    ["missing Personal host", (prefix: string) => rmSync(join(prefix, "apps/oma/dist/entry/personal-host.js")), /personal-host\.js|missing/i],
    ["unlocked dependency", (prefix: string) => {
      const manifest = join(prefix, "node_modules/nodemailer/package.json");
      const value = JSON.parse(readFileSync(manifest, "utf8"));
      writeFileSync(manifest, JSON.stringify({ ...value, version: "0.0.1" }));
    }, /nodemailer|version/i],
  ] as const) {
    const work = mkdtempSync(join(tmpdir(), "oma-v31b-"));
    try {
      const prefix = join(work, "install");
      mkdirSync(dirname(prefix), { recursive: true });
      install(prefix);
      damage(prefix);
      await assert.rejects(() => checkPackage(prefix), expected, `${name} passed the package check`);
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
});
