/** Evidence bookkeeping tests do not manufacture Darwin kernel observations. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, openSync, closeSync, writeFileSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARWIN_PROGRAMS, darwinCasePlan, validateDarwinObservation, validateDarwinCaseSet } from "../scripts/darwin-cases.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Record grammar only: these are parser inputs, never kernel observations.
const descriptorRecord = () => ({ platform: "darwin",
  devFd: { attempted: true, openReturn: -1, openErrno: 13, sameInode: null, closeOnExec: null,
    accessMode: null, sourceBefore: null, sourceAfter: null, duplicateBefore: null, duplicateAfter: null },
  fileport: { available: false, makeportReturn: null, makeportErrno: null,
    duplicate: { attempted: false, openReturn: null, openErrno: null, sameInode: null, closeOnExec: null,
      accessMode: null, sourceBefore: null, sourceAfter: null, duplicateBefore: null, duplicateAfter: null } },
  namespace: { heldAfterSwap: true, namedIsReplacement: true, heldAfterUnlink: true },
  exec: { direct: { execErrno: null, exitCode: 0, signal: null, reply: "original" },
    fdBeforeSwap: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" },
    namedAfterSwap: { execErrno: null, exitCode: 0, signal: null, reply: "replacement" },
    fdAfterSwap: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" },
    fdAfterUnlink: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" } } });
const keptDescriptorRecord = () => ({ exactChannelsRetained: true, stdinTransportRetainedSameChannels: true,
  extraCanaryDetectedInControl: true, malformedPolicyRefused: true, directChildrenClosed: true,
  samePidAfterExec: true, loweredHardLimitPruned: true, stdioCloexecRetained: true,
  emptyKeepListPruned: true, missingChannelRefused: true, missingTargetRefused: true,
  actorSha256: "a".repeat(64), pruneControlSha256: "b".repeat(64) });
const signalRecord = () => ({ inherited: { returnCode: 0, errno: 0, delivered: true },
  fresh: { returnCode: -1, errno: 1, delivered: false },
  nestedApplyReturnCode: -1, nestedApplyErrno: 1, afterNested: { returnCode: 0, errno: 0, delivered: true },
  unreapedPidControl: true, ownedChildrenJoined: true });
const launchdRecord = name => ({ fixtureOnly: true, controlledGenerationsExited: true,
  jobRegistrationsRemoved: true, cleanupFaults: [], actorSourceSha256: "c".repeat(64),
  ...(name === "launchd-image" ? { matchingA: { variant: 1 }, matchingB: { variant: 2 },
    cdhashes: ["a".repeat(40), "b".repeat(40)], replacedImage: { markerAfterTwoSeconds: false } }
    : { scope: { afterBootout: { otherAcknowledged: true } } }) });
const personalRecord = () => ({ actualTerminal: true, cleanExit: true, terminalRestored: true,
  noSocietyProvisioned: true, societyRefusedBeforeState: true, birthMode: "personal", birthCwd: "/owned/project",
  input: "ctrl-d", credentialFixture: false });
const suspendedRecord = () => {
  const attempt = variant => ({ stopped: true, stopSignal: 17, beforeRelease: {
    constructor: false, main: false, stdoutBytes: 0, stderrBytes: 0 },
    copyStatus: 0, primary: { parseStatus: 0, validationStatus: 0 }, alternate: null,
    released: true, childReaped: true, supervisorJoined: true, exitCode: 0, signal: null,
    constructor: variant ? { variant, pid: 100 + variant } : null,
    main: variant ? { variant, pid: 100 + variant } : null, targetStdout: "" });
  const refused = () => ({ ...attempt(), primary: { parseStatus: 0, validationStatus: -1 },
    alternate: { parseStatus: 0, validationStatus: 0 }, released: false, exitCode: null, signal: 9 });
  const signature = hash => ({ sha256: "d".repeat(64), cdhashes: [hash.repeat(40)] });
  return { fixtureOnly: true, scope: "main-image-only", unreapedPidControl: true, ownedChildrenJoined: true,
    scriptRequirementNamesInterpreter: true, sourceSha256: { controller: "c".repeat(64), target: "d".repeat(64) },
    images: { a: signature("a"), b: signature("b") },
    tools: Object.fromEntries(["node", "git", "compiler", "shell"].map(key => [key, signature("c")])),
    positive: { a: attempt(1), b: attempt(2), node: { ...attempt(), main: { kind: "node" } },
      git: { ...attempt(), targetStdout: "git version fixture" }, compiler: { ...attempt(), targetStdout: "clang version fixture" },
      script: { ...attempt(), main: { kind: "script" } } }, mismatch: refused(), restoredPath: refused() };
};
const rows = () => darwinCasePlan().map(({ observation, ...planned }) => ({ ...planned,
  execution: "EXECUTED", status: "OBSERVED", exitCode: 0, signal: null, cleanup: "returned",
  observations: { [observation]: planned.name === "file-descriptors" ? descriptorRecord() :
    planned.name === "seatbelt-kept-fds" ? keptDescriptorRecord() :
      planned.name === "seatbelt-signals" ? signalRecord() :
        ["launchd-scope", "launchd-image"].includes(planned.name) ? launchdRecord(planned.name) :
          planned.name === "personal-entry" ? personalRecord() :
            planned.name === "suspended-image" ? suspendedRecord() : { fixtureAssertionReturned: true } } }));

test("NATIVE-DARWIN: descriptor inheritance records require PID, hard-limit, stdio and refusal controls", () => {
  const good = keptDescriptorRecord();
  assert.doesNotThrow(() => validateDarwinObservation("seatbelt-kept-fds", { seatbeltFault: good }));
  for (const key of Object.keys(good)) {
    for (const value of [undefined, null, false, "unobserved"]) {
      const bad = { ...good, [key]: value };
      if (value === undefined) delete bad[key];
      assert.throws(() => validateDarwinObservation("seatbelt-kept-fds", { seatbeltFault: bad }), `${key}: ${value}`);
    }
  }
});

test("NATIVE-DARWIN: signal observations refuse missing PID, delivery and inherited positive controls", () => {
  const good = signalRecord();
  for (const bad of [
    { ...good, unreapedPidControl: false },
    { ...good, ownedChildrenJoined: false },
    { ...good, inherited: { returnCode: -1, errno: 1, delivered: false } },
    { ...good, fresh: { returnCode: 0, errno: 0, delivered: false } },
    { ...good, afterNested: { returnCode: -1, errno: 0, delivered: false } },
    { ...good, nestedApplyReturnCode: "unknown" },
  ]) assert.throws(() => validateDarwinObservation("seatbelt-signals", { seatbeltSignals: bad }));
});

test("NATIVE-DARWIN: launchd observations reject missing image controls, cleanup and live independent jobs", () => {
  const good = launchdRecord("launchd-image");
  for (const bad of [
    { ...good, fixtureOnly: false },
    { ...good, controlledGenerationsExited: false },
    { ...good, jobRegistrationsRemoved: false },
    { ...good, cleanupFaults: ["unknown child"] },
    { ...good, matchingB: { variant: 1 } },
    { ...good, cdhashes: [good.cdhashes[0], good.cdhashes[0]] },
    { ...good, replacedImage: {} },
  ]) assert.throws(() => validateDarwinObservation("launchd-image", { launchdImage: bad }));
  assert.throws(() => validateDarwinObservation("launchd-scope",
    { launchdScope: { ...launchdRecord("launchd-scope"), scope: { afterBootout: { otherAcknowledged: false } } } }));
});

test("NATIVE-DARWIN: Personal startup cannot hide a Society gate bypass or a changed saved mode", () => {
  const good = personalRecord();
  for (const bad of [
    { ...good, societyRefusedBeforeState: false }, { ...good, noSocietyProvisioned: false },
    { ...good, terminalRestored: false }, { ...good, birthMode: "society" }, { ...good, credentialFixture: true },
  ]) assert.throws(() => validateDarwinObservation("personal-entry", { personal: bad }));
});

test("NATIVE-DARWIN: suspended image observations require real positive contexts and coherent pre-release validation", () => {
  const good = suspendedRecord();
  assert.doesNotThrow(() => validateDarwinObservation("suspended-image", { suspendedImage: good }));
  // START_SUSPENDED is a kernel task stop, not delivery of a particular signal.
  const initialStop = structuredClone(good); initialStop.positive.a.stopSignal = 0;
  validateDarwinObservation("suspended-image", { suspendedImage: initialStop });
  for (const change of [
    value => { value.ownedChildrenJoined = false; },
    value => { delete value.sourceSha256.controller; },
    value => { value.images.b = value.images.a; },
    value => { value.positive.a.beforeRelease.constructor = true; },
    value => { value.positive.a.stopSignal = -1; },
    value => { value.positive.node.primary.validationStatus = -1; },
    value => { value.positive.compiler.targetStdout = ""; },
    value => { value.mismatch.released = true; },
    value => { value.restoredPath.alternate = null; },
    value => { value.restoredPath.constructor = { variant: 2, pid: 102 }; },
  ]) {
    const bad = structuredClone(good); change(bad);
    assert.throws(() => validateDarwinObservation("suspended-image", { suspendedImage: bad }));
  }
  // A real counterexample is an observation, not a product PASS. Preserve
  // evidence that a wrong image actually ran when validation let it through.
  const counterexample = structuredClone(good);
  counterexample.restoredPath = { ...structuredClone(good.positive.b), alternate: { parseStatus: 0, validationStatus: -1 } };
  assert.doesNotThrow(() => validateDarwinObservation("suspended-image", { suspendedImage: counterexample }));
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
  for (const value of [null, [], "completed", true, 0, {}])
    assert.throws(() => validateDarwinObservation("process", { process: value }));
  assert.throws(() => validateDarwinObservation("unknown", { process: { returned: true } }));
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
    assert.equal(result.summary.observed, 0); assert.equal(result.summary.executed, 0);
    assert.equal(result.summary.productQualification, "BLOCKED");
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
    for (const malformed of ["-1", "+1", "1x", "", "184468040737095516160"]) {
      const child = spawnSync(binary, [malformed, args[1]], { encoding: "utf8", timeout: 10000 });
      assert.equal(child.status, 2); assert.match(child.stderr, /invalid FD oracle identity/);
    }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(out, { recursive: true, force: true }); }
});

if (process.platform === "linux") test("NATIVE-DARWIN: Worker fixture refuses the actual Linux kernel before creating state", () => {
  const work = mkdtempSync(join(tmpdir(), "oma-worker-refusal-"));
  try {
    const child = spawnSync(process.execPath, [join(root, "test/fixtures/darwin-worker.mjs"), "worker-bootstrap"],
      { cwd: work, encoding: "utf8", timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 1);
    assert.match(child.stderr, /Worker observations require the actual Darwin kernel/);
    assert.deepEqual(readdirSync(work), []);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

