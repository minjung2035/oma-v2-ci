/** Evidence bookkeeping tests do not manufacture Darwin kernel observations. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, openSync, closeSync, writeFileSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARWIN_PROGRAMS, DARWIN_CASE_REPETITIONS, DARWIN_PROCESS_TIMEOUT_MS,
  darwinCasePlan, darwinDriverBudgetSeconds, validateDarwinObservation, validateDarwinCaseSet } from "../scripts/darwin-cases.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const rows = () => darwinCasePlan().map(({ observation, ...planned }) => ({ ...planned,
  execution: "EXECUTED", status: "OBSERVED", exitCode: 0, signal: null, cleanup: "returned",
  observations: { [observation]: { fixtureAssertionReturned: true } } }));

test("NATIVE-DARWIN: required independent cases keep three attempts and explicit ownership", () => {
  assert.equal(DARWIN_CASE_REPETITIONS, 3);
  assert.equal(DARWIN_PROCESS_TIMEOUT_MS, 120000);
  const required = ["process", "files", "auth", "socket-transfer", "queued-transfer", "mach-self", "mach-rendezvous-live",
    "mach-rendezvous-exit", "mach-stream-roundtrip", "mach-stream-stale", "mach-stream-handoff", "mach-audit-async",
    "seatbelt-files", "seatbelt-profile-stream", "seatbelt-profile-header", "seatbelt-profile-magic", "seatbelt-profile-overflow",
    "seatbelt-profile-truncated", "seatbelt-profile-trailing", "seatbelt-profile-nul", "seatbelt-profile-empty",
    "seatbelt-profile-syntax", "seatbelt-argv-env", "seatbelt-fd-close", "seatbelt-ipc-denial"];
  const plan = darwinCasePlan();
  assert.equal(plan.length, 75);
  assert.deepEqual([...new Set(plan.map(row => row.name))].sort(), required.sort());
  assert.equal(new Set(plan.map(row => `${row.name}:${row.iteration}`)).size, plan.length);
  for (const name of required) assert.deepEqual(plan.filter(row => row.name === name).map(row => row.iteration), [0, 1, 2]);
  for (const program of DARWIN_PROGRAMS) {
    assert.ok(Object.isFrozen(program)); assert.ok(Object.isFrozen(program.names));
    for (const name of program.names) assert.ok(plan.some(row => row.name === name && row.program === program.name));
  }
  assert.doesNotThrow(() => validateDarwinCaseSet(rows()));
});

for (const [name, change] of [
  ["omitted attempt", list => list.pop()],
  ["extra attempt", list => list.push(structuredClone(list[0]))],
  ["duplicate hiding another attempt", list => { list[1] = structuredClone(list[0]); }],
  ["wrong program", list => { list[0].program = "another-program"; }],
  ["invented case", list => { list[0].name = "not-required"; }],
  ["out-of-range iteration", list => { list[0].iteration = 3; }],
  ["string iteration", list => { list[0].iteration = "0"; }],
  ["missing row", list => { list[0] = null; }],
  ["PASS relabel", list => { list[0].status = "PASS"; }],
  ["unexecuted observation", list => { list[0].execution = "NOT_RUN"; }],
  ["nonzero exit", list => { list[0].exitCode = 125; }],
  ["missing exit", list => { delete list[0].exitCode; }],
  ["signal", list => { list[0].signal = "SIGKILL"; }],
  ["missing signal observation", list => { delete list[0].signal; }],
  ["spawn failure", list => { list[0].error = "ENOENT"; }],
  ["cleanup not returned", list => { delete list[0].cleanup; }],
  ["cleanup failure", list => { list[0].cleanupError = "return unknown"; }],
  ["artifact write failure", list => { list[0].artifactError = "ENOSPC"; }],
  ["wrong observation owner", list => { list[0].observations = { files: { returned: true } }; }],
  ["empty observation", list => { list[0].observations = { process: {} }; }],
  ["extra observation", list => { list[0].observations.files = { returned: true }; }],
]) test(`NATIVE-DARWIN: evidence refuses ${name}`, () => {
  const list = rows(); change(list); assert.throws(() => validateDarwinCaseSet(list));
});

test("NATIVE-DARWIN: failed attempts remain explicit failures, never observations", () => {
  const list = rows(); list[0] = { ...darwinCasePlan()[0], execution: "NOT_RUN", status: "SETUP_FAILED", error: "SDK unavailable" };
  assert.doesNotThrow(() => validateDarwinCaseSet(list));
  assert.equal(list.filter(row => row.status === "OBSERVED").length, 74);
  for (const value of [null, [], "completed", true, 0, {}])
    assert.throws(() => validateDarwinObservation("process", { process: value }));
  assert.throws(() => validateDarwinObservation("unknown", { process: { returned: true } }));
});

test("NATIVE-DARWIN: CI gives every bounded attempt time and preserves failures", () => {
  const workflow = readFileSync(join(root, ".github/workflows/native-runtime.yml"), "utf8");
  const gates = workflow.slice(workflow.indexOf("\n  darwin-gates:\n"));
  const minutes = Number(/timeout-minutes: (\d+)/.exec(gates)?.[1]);
  const extraSeconds = [...gates.matchAll(/^ {8}timeout-minutes: (\d+)$/gm)].reduce((sum, row) => sum + Number(row[1]) * 60, 0);
  assert.ok(minutes * 60 > darwinDriverBudgetSeconds() + extraSeconds,
    "the job must outlive all attempts, SDK commands, bounded setup, credential compile and upload");
  assert.match(gates, /os: \[macos-26, macos-15\]/);
  assert.match(gates, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_darwin \}\}/);
  assert.match(workflow, /run_darwin:\n\s+description:[^\n]*\n\s+type: boolean\n\s+required: false\n\s+default: false/);
  assert.match(workflow, /os: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.run_darwin && fromJSON\('\["ubuntu-24\.04", "macos-26", "macos-15"\]'\) \|\| fromJSON\('\["ubuntu-24\.04"\]'\) \}\}/);
  assert.match(gates, /fail-fast: false/);
  assert.match(gates, /if: \$\{\{ !cancelled\(\) \}\}[\s\S]*node scripts\/verify-native\.mjs/);
  assert.match(gates, /Preserve raw observations, including blocked gates\n\s+if: always\(\)/);
  assert.match(gates, /if-no-files-found: error/);
  assert.doesNotMatch(gates, /continue-on-error|verify-native[^\n]*(?:\|\| true|exit 0)/);
  assert.match(workflow, /node --test [^\n]*test\/darwin-evidence\.test\.mjs/);
  assert.match(workflow, /node --test [^\n]*test\/runtime-artifact-digest\.test\.mjs/);
  assert.match(workflow, /node --test [^\n]*packages\/tool-hashline\/test\/bundle\.test\.mjs/);
});

if (process.platform === "linux") test("NATIVE-DARWIN: actual Linux driver refuses Darwin and records every NOT_RUN", () => {
  const out = mkdtempSync(join(tmpdir(), "oma-darwin-refusal-"));
  try {
    const child = spawnSync(process.execPath, [join(root, "scripts/verify-native.mjs"), out],
      { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 2, child.stderr);
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.equal(result.provenance.platform, "linux"); assert.equal(result.status, "SETUP_FAILED");
    assert.match(result.error, /require a real Darwin kernel/);
    assert.deepEqual(result.summary, { required: 75, observed: 0, executed: 0, notRun: 75, productQualification: "BLOCKED" });
    assert.equal(result.compilations.length, DARWIN_PROGRAMS.length);
    assert.ok(result.compilations.every(row => row.status === "NOT_RUN"));
    validateDarwinCaseSet(result.cases);
    for (const row of result.cases) {
      assert.equal(row.status, "SETUP_FAILED"); assert.equal(row.execution, "NOT_RUN");
      assert.equal(row.observations, undefined);
      const retained = JSON.parse(readFileSync(join(out, "cases", `${row.name}-${row.iteration}`, "result.json"), "utf8"));
      assert.deepEqual(retained, row);
    }
    assert.deepEqual(Object.keys(result.gates).sort(), ["G-AUTH", "G-FILES", "G-PROCESS"]);
    assert.ok(Object.values(result.gates).every(row => row.status === "OPEN"));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("NATIVE-DARWIN: real FD oracle distinguishes an inherited canary from a returned descriptor", () => {
  const out = mkdtempSync(join(tmpdir(), "oma-fd-oracle-")); let fd;
  try {
    const binary = join(out, "observer"), source = join(root, "test/fixtures/darwin-fd-observer.c");
    const compiler = process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc";
    const argv = [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", source, "-o", binary];
    const compiled = spawnSync(compiler, argv, { encoding: "utf8", timeout: 30000 });
    assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
    const canary = join(out, "canary"); writeFileSync(canary, "actual fixture-owned inode"); fd = openSync(canary, "r");
    const info = fstatSync(fd, { bigint: true }), args = [String(info.dev), String(info.ino)];
    for (const inherited of [true, false]) {
      const child = spawnSync(binary, args, { encoding: "utf8", timeout: 30000,
        stdio: ["ignore", "pipe", "pipe", ...(inherited ? [fd] : [])] });
      assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, inherited ? 3 : 0, child.stderr);
      const observed = JSON.parse(child.stdout); assert.equal(observed.leaked, inherited); assert.ok(observed.checkedTo > 3);
    }
    for (const malformed of ["-1", "+1", "1x", "", "184467440737095516160"]) {
      const child = spawnSync(binary, [malformed, args[1]], { encoding: "utf8", timeout: 10000 });
      assert.equal(child.status, 2); assert.match(child.stderr, /invalid FD oracle identity/);
    }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(out, { recursive: true, force: true }); }
});
