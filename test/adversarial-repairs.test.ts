import { engineSettingsFiles } from "#oma-test/app/engine/settings-files";
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureStorageBytes } from "./fixtures/storage-usage.js";
import { createEngineSettings, prepareEngineInteractiveSettings } from "@oma/engine/pi-compat/settings";
import { runProcess } from "@oma/process/async";
import { PACKAGE_STORE } from "#oma-test/app/runtime/packages/store";
import { spawnSync } from "node:child_process";
import { withOwnedSettingsLock } from "#oma-test/app/runtime/locked-files";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { walkOwnedTree } from "@oma/storage/directory";

import { defaultHostConfig } from "@oma/config/defaults";
import { validateConfig } from "@oma/config";
import { assertSupportedIntegration, integrationPolicyFromConfig, snapshotIntegrationPolicy } from "@oma/domain/integration-policy";
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



test("AV-01/10: owned observations repair read/search bits without unsealing state", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-quota-"));
  t.after(() => removeTree(root));
  mkdirSync(join(root, "opaque")); writeFileSync(join(root, "opaque", "file"), "owned");
  mkdirSync(join(root, "sealed"), { mode: 0o555 });
  const before = fixtureStorageBytes(root);
  chmodSync(join(root, "opaque"), 0);
  assert.equal(fixtureStorageBytes(root), before);
  assert.equal(statSync(join(root, "sealed")).mode & 0o777, 0o555,
    "an owned observation added write permission to sealed state");
  assert.equal(statSync(join(root, "opaque")).mode & 0o700, 0o500);
  chmodSync(join(root, "opaque"), 0o700);
});

test("AV-02: stale Pi managers merge through OMA's lock and preserve trusted project settings", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-repair-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = join(root, "engine"), cwd = join(root, "project");
  mkdirSync(agent); mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ theme: "project-choice" }));
  const first = createEngineSettings(engineSettingsFiles, cwd, agent, { projectTrusted: false });
  const stale = createEngineSettings(engineSettingsFiles, cwd, agent, { projectTrusted: false });
  first.setDefaultModelAndProvider("fixture-provider", "fixture-model"); await first.flush();
  assert.deepEqual(first.drainErrors(), []);
  prepareEngineInteractiveSettings(engineSettingsFiles, agent);
  stale.setHideThinkingBlock(false); await stale.flush(); assert.deepEqual(stale.drainErrors(), []);
  const saved = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
  assert.equal(saved.defaultModel, "fixture-model"); assert.equal(saved.hideThinkingBlock, false);
  const trusted = createEngineSettings(engineSettingsFiles, cwd, agent, { projectTrusted: true });
  assert.equal(trusted.getTheme(), "project-choice");
  assert.notEqual(createEngineSettings(engineSettingsFiles, cwd, agent, { projectTrusted: false }).getTheme(), "project-choice");
  first.setEnableSkillCommands(false); await first.flush();
  prepareEngineInteractiveSettings(engineSettingsFiles, agent);
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
  const restarted = createEngineSettings(engineSettingsFiles, cwd, agent, { projectTrusted: true });
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
  prepareEngineInteractiveSettings(engineSettingsFiles, root);
  const before = readFileSync(join(root, "settings.json"), "utf8");
  const source = `import {SettingsManager} from '@earendil-works/pi-coding-agent';
const settings=SettingsManager.create(process.cwd(),process.argv[1],{projectTrusted:false});
settings.setDefaultModelAndProvider('fixture','cli-model');await settings.flush();
process.stdout.write(JSON.stringify({errors:settings.drainErrors().length}));`;
  const write = () => {
    const result = spawnSync(process.execPath, ["--import", fileURLToPath(new URL("../../apps/oma/dist/entry/pi-settings-preload.js", import.meta.url)),
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
