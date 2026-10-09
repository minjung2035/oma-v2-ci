import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { observedStorageBytes, StorageAdmission } from "../src/storage/quota.js";
import { createEngineSettings, prepareEngineInteractiveSettings } from "../src/pi-compat/settings.js";
import { runProcess } from "../src/process/async.js";
import { writePackageArchive } from "../src/platform/package-archive.js";
import { applyPackageArchive } from "../src/tui/packages-apply.js";
import { PACKAGE_STORE, pinPackageGeneration } from "../src/runtime/pi-packages.js";
import { spawnSync } from "node:child_process";
import { withOwnedSettingsLock } from "../src/runtime/locked-files.js";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { walkOwnedTree } from "../src/storage/directory.js";
import { RESOURCE_FIELDS } from "../src/domain/resources.js";
import { defaultHostConfig } from "../src/config/defaults.js";
import { validateConfig } from "../src/config.js";
import { assertSupportedIntegration, integrationPolicyFromConfig, snapshotIntegrationPolicy } from "../src/git/integration-policy.js";
import { lockSync } from "proper-lockfile";
import { removeTree } from "./fixtures/cleanup.js";

test("AV-01/P0-4: an inode-pin close failure releases the directory it opened", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-walk-fd-"));
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); });
  const before = fs.readdirSync("/proc/self/fd").length;
  const open = fs.openSync, close = fs.closeSync;
  let pin: number | undefined;
  t.mock.method(fs, "openSync", ((path: fs.PathLike, flags: number, mode?: number) => {
    const fd = open(path, flags, mode);
    if (typeof path === "string" && path.startsWith("/proc/self/fd/") && flags === (fs.constants.O_RDONLY | fs.constants.O_DIRECTORY))
      pin = Number(path.split("/").at(-1));
    return fd;
  }) as typeof fs.openSync);
  t.mock.method(fs, "closeSync", (fd: number) => {
    close(fd);
    if (fd === pin) { pin = undefined; throw new Error("pin close failed after kernel release"); }
  });
  syncBuiltinESMExports();
  assert.throws(() => [...walkOwnedTree(root)], /pin close failed/);
  assert.equal(fs.readdirSync("/proc/self/fd").length, before);
});

test("AV-06: saved deadlines remain executable and reject derived unsafe integers at validation", () => {
  const config = defaultHostConfig({ society: "repair", node: process.execPath, libdir: process.cwd(),
    rootfs: "/tmp/oma-repair-rootfs", deploymentDigest: "a".repeat(64) });
  const resources = config.agentProfiles.resident!.resources;
  const maximum = RESOURCE_FIELDS.checkTimeoutSeconds.maxInclusive;
  for (const checkTimeoutSeconds of [2147484, maximum]) {
    const value = structuredClone(config);
    value.integration.checks = [{ id: "long", argv: ["/bin/true"], env: {}, resources: { ...resources, checkTimeoutSeconds } }];
    validateConfig(value);
    assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicyFromConfig(value.integration)));
  }
  const invalid = structuredClone(config);
  invalid.integration.checks = [{ id: "unsafe", argv: ["/bin/true"], env: {}, resources: { ...resources, checkTimeoutSeconds: maximum + 1 } }];
  assert.throws(() => validateConfig(invalid), { code: "INVALID_REQUEST" });
});

test("AV-01/10: owned mode damage is repaired and concurrent reservations cannot overbook", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-quota-"));
  t.after(() => removeTree(root));
  mkdirSync(join(root, "opaque")); writeFileSync(join(root, "opaque", "file"), "owned");
  mkdirSync(join(root, "sealed"), { mode: 0o555 });
  const before = observedStorageBytes(root);
  chmodSync(join(root, "opaque"), 0);
  assert.equal(observedStorageBytes(root), before);
  assert.equal(statSync(join(root, "sealed")).mode & 0o777, 0o555,
    "a quota observation added write permission to sealed state");
  assert.equal(statSync(join(root, "opaque")).mode & 0o700, 0o500);
  assert.equal(await new StorageAdmission(root, before, 0).startupState(), "admitted");
  const owner = new StorageAdmission(root, before + 100, 0);
  const results = await Promise.allSettled([owner.reserve(60), owner.reserve(60)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  assert.equal(owner.outstanding, 0);
  for (const result of results) if (result.status === "fulfilled") result.value();
  assert.equal(owner.outstanding, 0);
  chmodSync(join(root, "opaque"), 0o700);
});

test("AV-10: a large tree scan allows unrelated broker work to run", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-yield-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 30_000; index++) writeFileSync(join(root, String(index)), "x");
  const owner = new StorageAdmission(root, Number.MAX_SAFE_INTEGER, 0);
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 0);
  try {
    const holds = await Promise.all([owner.admit("admit"), owner.admit("admit"), owner.admit("admit")]);
    assert.equal(timerRan, false, "admission unexpectedly walked the entire tree");
    for (const release of holds) release();
  } finally { clearTimeout(timer); }
});

test("AV-02: stale Pi managers merge through OMA's lock and preserve trusted project settings", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = join(root, "engine"), cwd = join(root, "project");
  mkdirSync(agent); mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ theme: "project-choice" }));
  const first = createEngineSettings(cwd, agent, { projectTrusted: false });
  const stale = createEngineSettings(cwd, agent, { projectTrusted: false });
  first.setDefaultModelAndProvider("fixture-provider", "fixture-model"); await first.flush();
  assert.deepEqual(first.drainErrors(), []);
  prepareEngineInteractiveSettings(agent);
  stale.setHideThinkingBlock(false); await stale.flush(); assert.deepEqual(stale.drainErrors(), []);
  const saved = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
  assert.equal(saved.defaultModel, "fixture-model"); assert.equal(saved.hideThinkingBlock, false);
  const trusted = createEngineSettings(cwd, agent, { projectTrusted: true });
  assert.equal(trusted.getTheme(), "project-choice");
  assert.notEqual(createEngineSettings(cwd, agent, { projectTrusted: false }).getTheme(), "project-choice");
  first.setEnableSkillCommands(false); await first.flush();
  prepareEngineInteractiveSettings(agent);
  assert.equal(JSON.parse(readFileSync(join(agent, "settings.json"), "utf8")).enableSkillCommands, false);
  const projectLock = lockSync(join(cwd, ".pi/settings.json"), { realpath: false });
  try {
    trusted.setProjectSkillPaths(["chosen-skills"]); await trusted.flush();
    assert.ok(trusted.drainErrors().length > 0, "the project writer bypassed Pi's lock");
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8")), { theme: "project-choice" });
  } finally { projectLock(); }
  trusted.setProjectSkillPaths(["chosen-skills"]); await trusted.flush();
  assert.deepEqual(trusted.drainErrors(), []);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi/settings.json"), "utf8")).skills, ["chosen-skills"]);
  const committed = readFileSync(join(cwd, ".pi/settings.json"), "utf8");
  const restarted = createEngineSettings(cwd, agent, { projectTrusted: true });
  assert.equal(restarted.getTheme(), "project-choice");
  restarted.setProjectSkillPaths(["chosen-skills"]); await restarted.flush();
  assert.deepEqual(restarted.drainErrors(), []);
  assert.equal(readFileSync(join(cwd, ".pi/settings.json"), "utf8"), committed,
    "retry after the project publication changed a committed choice");
});

test("AV-04/06: retained-output limits and long timer intervals do not kill a successful command", async () => {
  const result = await runProcess({ executable: process.execPath,
    argv: ["-e", "process.stdout.write(Buffer.alloc(1048577));process.stderr.write(Buffer.alloc(1048577));setTimeout(()=>process.exit(0),50)"],
    env: {}, timeoutMs: 0x80000000, stdoutBytes: 1024, stderrBytes: 1024,
    stdoutOverflow: "discard", stderrOverflow: "discard" });
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1024); assert.equal(result.stderr.length, 1024);
  assert.equal(result.stdoutTruncated, true); assert.equal(result.stderrTruncated, true);
});

test("AV-02: the bundled CLI preload uses the same interprocess settings lock", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-pi-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  prepareEngineInteractiveSettings(root);
  const before = readFileSync(join(root, "settings.json"), "utf8");
  const source = `import {SettingsManager} from '@earendil-works/pi-coding-agent';
const settings=SettingsManager.create(process.cwd(),process.argv[1],{projectTrusted:false});
settings.setDefaultModelAndProvider('fixture','cli-model');await settings.flush();
process.stdout.write(JSON.stringify({errors:settings.drainErrors().length}));`;
  const write = () => {
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("../src/pi-compat/settings-preload.js", import.meta.url)),
      "--input-type=module", "--eval", source, root], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { errors: number };
  };
  withOwnedSettingsLock(root, () => {
    assert.ok(write().errors > 0, "the CLI bypassed OMA's writer lock");
    assert.equal(readFileSync(join(root, "settings.json"), "utf8"), before);
  });
  assert.equal(write().errors, 0);
  assert.equal(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).defaultModel, "cli-model");
});

test("AV-03/13: old imported code survives replacements and corrupt replay state has no publication effects", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-packages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, "data"), store = join(root, "mac"), pkg = join(store, "npm/node_modules/reader");
  mkdirSync(data); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(store, "settings.json"), JSON.stringify({ packages: ["npm:reader"] }));
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "reader", version: "1.0.0", pi: { extensions: ["./extension.mjs"] } }));
  writeFileSync(join(pkg, "extension.mjs"), "import {readFileSync} from 'node:fs';export default function(){};export const asset=()=>readFileSync(new URL('./asset.txt',import.meta.url),'utf8');");
  const installation = fileURLToPath(new URL("../../", import.meta.url));
  let reader: { asset(): string } | undefined;
  for (let version = 1; version <= 3; version++) {
    writeFileSync(join(pkg, "asset.txt"), String(version));
    const archive = join(root, `archive-${version}`); await writePackageArchive(store, archive);
    await applyPackageArchive({ data, archive, libdir: installation });
    if (version === 1) {
      const generation = realpathSync(join(data, PACKAGE_STORE));
      pinPackageGeneration(generation); // The engine acquires this before loading extension code.
      reader = await import(pathToFileURL(join(generation, "npm/node_modules/reader/extension.mjs")).href);
    }
  }
  assert.equal(reader!.asset(), "1");
  const selected = realpathSync(join(data, PACKAGE_STORE));
  const archive = join(root, "damaged"); await writePackageArchive(store, archive);
  for (const before of [null, [{ source: "npm:reader", entries: ["packages:../escape.js"] }]]) {
    writeFileSync(`${archive}.before.json`, JSON.stringify({ before, previous: null }));
    const steps: string[] = [];
    await assert.rejects(applyPackageArchive({ data, archive, libdir: installation }, step => steps.push(step)), { code: "STORE_CORRUPT" });
    assert.deepEqual(steps, []); assert.equal(realpathSync(join(data, PACKAGE_STORE)), selected);
  }
});
