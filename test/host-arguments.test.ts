/** DR27 / CLI-001: no host effect before a whole, unambiguous command. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseOmaArguments, parseMacArguments } from "#oma-test/app/runtime/host-arguments";
import { packageCommand } from "#oma-test/app/runtime/packages/store";

const project = "00000000-0000-4000-8000-000000000001";
test("Personal project inheritance can be explicitly skipped only for a fresh Personal session", () => {
  for (const parse of [parseOmaArguments, parseMacArguments]) {
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

test("DR27: Mac commands reject missing, duplicate and ignored arguments before effects", () => {
  assert.deepEqual(parseMacArguments(["attach", "demo", "--takeover"]), { kind: "attach", society: "demo", takeover: true });
  assert.deepEqual(parseMacArguments(["bind", "demo"]), { kind: "bind", society: "demo" });
  for (const args of [["bind"], ["bind", "../escape"], ["bind", "demo", "extra"], ["bind", "demo", "--project", project]])
    assert.throws(() => parseMacArguments(args), { code: "INVALID_REQUEST" });
  assert.deepEqual(parseMacArguments(["open", "--project", project, "demo"]), { kind: "open", society: "demo", projectId: project });
  for (const command of ["status", "list", "stop"] as const) assert.deepEqual(parseMacArguments([command]), { kind: command });
  for (const mode of ["society", "personal"])
    assert.deepEqual(parseMacArguments(["--mode", mode]), { kind: "session", society: undefined, config: undefined, bindProject: false, mode });
  assert.deepEqual(parseMacArguments(["--resume", "/saved.jsonl", "--mode", "personal"]),
    { kind: "session", society: undefined, config: undefined, bindProject: false, mode: "personal", resume: "/saved.jsonl" });
  for (const args of [["--config", "ignored"], ["--bind-project"], ["--resume", "/saved.jsonl", "--config", "ignored"],
    ["status", "extra"], ["stop", "--takeover"], ["attach"], ["attach", "../escape"],
    ["attach", "demo", "--takeover", "--takeover"], ["open", "demo"], ["open", "demo", "--project"],
    ["open", "demo", "--project", "--help"], ["open", "demo", "--project", project, "--project", project],
    ["open", "demo", "--project", project, "--takeover"], ["list", "--help", "extra"]])
    assert.throws(() => parseMacArguments(args), { code: "INVALID_REQUEST" }, JSON.stringify(args));
});

test("DR27: package and Mac project selectors share one value-aware grammar without changing engine argv", () => {
  const decision = packageCommand(["update", "--project", project, "--extension", "npm:fixture"], true);
  assert.deepEqual(decision, { kind: "run", command: "update", args: ["update", "--extension", "npm:fixture"], projectId: project });
  assert.equal(packageCommand(["update", "--extension", "self"]).kind, "run", "explicit extension is not engine self-update");
  assert.equal(packageCommand(["install", "--help"]).kind, "run");
  for (const args of [["install", "npm:x", "--unknown"], ["list", "extra"], ["update", "--extension"],
    ["update", "--extension", "--project", project], ["install", "npm:x", "--project"],
    ["install", "npm:x", "--project", project, "--project", project], ["install", "npm:x", "--help", "--unknown"],
    ["update", "--extensions", "--extension", "npm:x"], ["update", "npm:x", "--extension", "npm:y"],
    ["update", "--extension", "npm:x", "--extension", "npm:y"], ["list", "--help", "-h"]])
    assert.equal(packageCommand(args, true).kind, "refused", JSON.stringify(args));
  assert.equal(packageCommand(["list", "--project", project]).kind, "refused", "Linux does not silently ignore a Mac selector");
});

test("DR28: Mac host-only package selection is explicit, closed and never forwarded to the engine", () => {
  assert.deepEqual(packageCommand(["install", "npm:fixture", "--host-only"], true),
    { kind: "run", command: "install", args: ["install", "npm:fixture"], hostOnly: true });
  for (const args of [["list", "--host-only"], ["update", "--host-only", "--extensions"], ["remove", "npm:fixture", "--host-only"]]) {
    const decision = packageCommand(args, true);
    assert.equal(decision.kind, "run");
    if (decision.kind === "run") { assert.equal(decision.hostOnly, true); assert.equal(decision.args.includes("--host-only"), false); }
  }
  for (const args of [["list", "--host-only", "--host-only"], ["install", "npm:fixture", "--host-only", "--project", project],
    ["install", "npm:fixture", "--project", project, "--host-only"], ["list", "--host-only=true"], ["install", "npm:fixture", "--host-only", "false"]])
    assert.equal(packageCommand(args, true).kind, "refused", JSON.stringify(args));
  assert.equal(packageCommand(["install", "npm:fixture", "--host-only"]).kind, "refused", "Linux must not ignore the Mac selector");
});

test("DR27: actual Mac entry validates before trying to read a host token or creating a package store", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mac-arguments-"));
  try {
    const home = join(root, "absent");
    const entry = join(import.meta.dirname, "../../apps/oma/dist/entry/oma-mac.js");
    for (const args of [["status", "extra"], ["open", "demo", "--project"], ["pi", "install", "npm:x", "--unknown"],
      ["pi", "update", "--extension", "--project", project], ["pi", "install", "npm:x", "--host-only", "--project", project],
      ["pi", "list", "--host-only", "--host-only"]]) {
      const result = spawnSync(process.execPath, [entry, ...args], { env: { ...process.env, HOME: root, OMA_HOST_HOME: home }, encoding: "utf8", timeout: 5000 });
      assert.equal(result.status, 2, result.stderr);
      assert.doesNotMatch(result.stderr, /Open the OMA app/);
      assert.equal(existsSync(home), false);
    }
    const help = spawnSync(process.execPath, [entry, "--help"], { env: { ...process.env, HOME: root, OMA_HOST_HOME: home }, encoding: "utf8", timeout: 5000 });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stderr, /usage: oma \[--mode society\|personal\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("NB-25/CLI-003: the Mac CLI exits by error class -- 2 a refusal, 3 an unknown outcome, never a flat 1", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mac-exit-"));
  try {
    const home = join(root, "host"), run = join(home, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "token"), "fixture-token\n");
    const entry = join(import.meta.dirname, "../../apps/oma/dist/entry/oma-mac.js");
    const env = { ...process.env, HOME: root, OMA_HOST_HOME: home };
    // The service is gone but its token remains: the outcome is unknown.
    const status = spawnSync(process.execPath, [entry, "status"], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(status.status, 3, status.stderr);
    // A settled refusal keeps its own code.
    const refused = spawnSync(process.execPath, [entry, "status", "extra"], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(refused.status, 2, refused.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
