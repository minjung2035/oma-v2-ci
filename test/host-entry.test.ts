import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

const entry = (name: "broker" | "runner") => join(import.meta.dirname, "../..", DEPLOYMENT_LAYOUT.entries[name]);

test("ID-001: entrypoints reject traversal before filesystem or socket effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-entry-name-"));
  try {
    for (const name of ["broker", "runner"] as const) {
      const args = name === "runner" ? ["--agent", "a"] : [];
      const result = spawnSync(process.execPath, [entry(name), ...args, "--society", "../escape"], {
        env: { ...process.env, XDG_DATA_HOME: dir, XDG_RUNTIME_DIR: dir }, encoding: "utf8", timeout: 3000,
      });
      assert.equal(result.status, 4, `${name}: ${result.stderr}`);
      assert.equal(existsSync(join(dir, "escape")), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D03: a runner without the whole explicit location is refused, not pointed at the environment's", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-runner-root-"));
  try {
    const state = join(dir, "data", "oma", "probe");
    mkdirSync(state, { recursive: true });
    const full = ["--config", join(state, "config.json"), "--state-root", state, "--run-root", join(dir, "run", "oma", "probe")];
    for (const drop of ["--config", "--state-root", "--run-root"]) {
      const at = full.indexOf(drop);
      const args = [...full.slice(0, at), ...full.slice(at + 2)];
      const result = spawnSync(process.execPath, [entry("runner"), "--society", "probe", "--agent", "a", "--execution", "19f7eb77-6c27-46ce-a60b-6acd2fa9a094", ...args], {
        env: { ...process.env, XDG_DATA_HOME: join(dir, "data"), XDG_RUNTIME_DIR: join(dir, "run") }, encoding: "utf8", timeout: 3000,
      });
      assert.equal(result.status, 4, `${drop}: ${result.stderr}`);
      assert.match(result.stderr, new RegExp(`launch location ${drop}`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runner execution identity cannot be missing, repeated or supplied by ambient state", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-runner-identity-"));
  const execution = "19f7eb77-6c27-46ce-a60b-6acd2fa9a094";
  try {
    for (const args of [[], ["--execution", ""], ["--execution", "not-an-execution"],
      ["--execution", execution.replaceAll("-", "")], ["--execution", execution, "--execution", execution]]) {
      const result = spawnSync(process.execPath, [entry("runner"), "--society", "probe", "--agent", "a", ...args], {
        cwd: dir, env: { ...process.env, XDG_DATA_HOME: dir, XDG_RUNTIME_DIR: dir,
          SYSTEMD_INVOCATION_ID: execution.replaceAll("-", ""), OMA_INVOCATION_ID: execution.replaceAll("-", "") },
        encoding: "utf8", timeout: 3000,
      });
      assert.equal(result.status, 4, result.stderr); assert.match(result.stderr, /usage: runner.js.*--execution/);
      assert.equal(existsSync(join(dir, "oma")), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
