/** DR27 / CLI-001: no host effect before a whole, unambiguous command. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOmaArguments } from "#oma-test/app/runtime/host-arguments";
import { packageCommand } from "#oma-test/app/runtime/packages/store";

const project = "00000000-0000-4000-8000-000000000001";
test("Personal project inheritance can be explicitly skipped only for a fresh Personal session", () => {
  for (const parse of [parseOmaArguments]) {
    assert.deepEqual(parse(["--mode", "personal", "--no-project-extensions"]),
      { kind: "session", society: undefined, config: undefined, bindProject: false, mode: "personal", noProjectExtensions: true });
    for (const args of [["--no-project-extensions"], ["--mode", "society", "--no-project-extensions"],
      ["--mode", "personal", "--no-project-extensions", "--resume", "/saved"]])
      assert.throws(() => parse(args), { code: "INVALID_REQUEST" });
  }
});
test("DR27: Linux host values cannot become options; package tails retain their own grammar", () => {
  assert.deepEqual(parseOmaArguments(["--config", "--help", "--society", "demo", "--bind-project"]),
    { kind: "session", config: "--help", society: "demo", bindProject: true });
  assert.deepEqual(parseOmaArguments(["pi", "install", "--help"]), { kind: "pi", args: ["install", "--help"] });
  assert.deepEqual(parseOmaArguments(["login"]), { kind: "login" });
  assert.deepEqual(parseOmaArguments(["--help"]), { kind: "help" });
  for (const args of [["--other"], ["--config"], ["--config", ""], ["--config", "x\0y"],
    ["--society", "a", "--society", "b"], ["--bind-project", "--bind-project"], ["--help", "-h"],
    ["--society", "../escape"], ["--society", "--help"], ["--config", "--society", "demo"],
    ["login", "--config", "ignored"], ["login", "--bind-project"], ["unknown"], ["--", "--help"]])
    assert.throws(() => parseOmaArguments(args), { code: "INVALID_REQUEST" }, JSON.stringify(args));
});

test("session modes: only an explicit birth choice changes the default", () => {
  const ordinary = parseOmaArguments([]);
  assert.deepEqual(ordinary, { kind: "session", society: undefined, config: undefined, bindProject: false });
  for (const mode of ["society", "personal"])
    assert.deepEqual(parseOmaArguments(["--mode", mode]), { ...ordinary, mode });
  for (const args of [["--mode"], ["--mode", ""], ["--mode", "Personal"], ["--mode", "other"],
    ["--mode", "society", "--mode", "personal"], ["--mode", "personal", "--society", "demo"],
    ["--mode", "personal", "--config", "settings.json"], ["--mode", "personal", "--bind-project"],
    ["login", "--mode", "personal"]])
    assert.throws(() => parseOmaArguments(args), { code: "INVALID_REQUEST" }, JSON.stringify(args));
});

test("Personal resume refuses a non-OMA history before preparing any state", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-personal-invalid-resume-"));
  try {
    const data = join(root, "data"), home = join(root, "home"), run = join(root, "run");
    const result = spawnSync(process.execPath, [join(import.meta.dirname, "../../apps/oma/dist/entry/oma.js"), "--mode", "personal", "--resume", join(root, "outside.jsonl")], {
      env: { ...process.env, HOME: home, XDG_DATA_HOME: data, XDG_RUNTIME_DIR: run }, encoding: "utf8", timeout: 5000,
    });
    assert.notEqual(result.status, 0, result.stderr); assert.match(result.stderr, /not an OMA session history/);
    assert.equal(existsSync(data), false); assert.equal(existsSync(home), false); assert.equal(existsSync(run), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
