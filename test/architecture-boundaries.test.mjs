import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PipelineRecorder } from "#oma-test/app/runtime/pipeline-recorder";

test("001. Pipeline recorder: receipt publication ENOSPC retains started evidence and cannot report success", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-pipeline-boundary-"));
  const pipeline = { version: 2, setupSteps: [], checkSteps: [], env: {}, toolchainDigest: "a".repeat(64), cachePolicy: { kind: "off" } };
  const original = fs.fsyncSync;
  try {
    const recorder = new PipelineRecorder(root, "b".repeat(40), pipeline, "attempt-one");
    const started = fs.readFileSync(join(recorder.directory, "started.json"));
    let injected = false;
    fs.fsyncSync = fd => {
      const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (path.includes("receipt.json") && !injected) { injected = true; throw Object.assign(new Error("injected receipt failure"), { code: "ENOSPC" }); }
      return original(fd);
    };
    syncBuiltinESMExports();
    assert.throws(() => recorder.finish(false, "RUN_TERMINATION_UNKNOWN"));
    assert.equal(injected, true);
    fs.fsyncSync = original; syncBuiltinESMExports();
    assert.deepEqual(fs.readFileSync(join(recorder.directory, "started.json")), started);
    assert.equal(fs.existsSync(join(recorder.directory, "receipt.json")), false);
    recorder.finish(false, "RUN_TERMINATION_UNKNOWN");
    const receipt = fs.readFileSync(join(recorder.directory, "receipt.json"));
    assert.equal(JSON.parse(receipt).status, "unknown");
    assert.equal(JSON.parse(receipt).scopeConfirmedDead, false);
    const next = new PipelineRecorder(root, "b".repeat(40), pipeline, "attempt-two");
    next.finish(true, "CHECK_FAILED");
    assert.notEqual(next.directory, recorder.directory);
    assert.deepEqual(fs.readFileSync(join(recorder.directory, "receipt.json")), receipt);
    assert.deepEqual(fs.readFileSync(join(recorder.directory, "started.json")), started);
  } finally { fs.fsyncSync = original; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true }); }
});

function heldOutputs(directory) {
  return fs.readdirSync("/proc/self/fd").filter(fd => {
    try { return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(`${directory}/`); }
    catch { return false; }
  });
}
const oneStep = { version: 2, setupSteps: [], checkSteps: [{ id: "check" }], env: {}, toolchainDigest: "a".repeat(64), cachePolicy: { kind: "off" } };
const startStep = { kind: "step-start", id: "check", index: 0, phase: "check", startedAt: "2026-11-09T00:00:00.000Z" };

test("002. Pipeline recorder returns the first output when acquiring the second fails", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-pipeline-acquire-"));
  const original = crypto.randomUUID;
  try {
    const recorder = new PipelineRecorder(root, "b".repeat(40), oneStep, "attempt");
    crypto.randomUUID = () => "11111111-1111-4111-8111-111111111111";
    syncBuiltinESMExports();
    assert.throws(() => recorder.frame(startStep));
    assert.deepEqual(heldOutputs(recorder.directory), []);
  } finally {
    crypto.randomUUID = original; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [index, phase] of ["step-end", "finish"].entries()) test(`${String(index + 3).padStart(3, "0")}. Pipeline recorder closes all outputs when the first ${phase} flush fails`, () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-pipeline-flush-"));
  const original = fs.fsyncSync;
  try {
    const recorder = new PipelineRecorder(root, "b".repeat(40), oneStep, "attempt");
    recorder.frame(startStep);
    let injected = false;
    fs.fsyncSync = fd => {
      if (!injected && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith(".result")) {
        injected = true; throw Object.assign(new Error("injected output failure"), { code: "EIO" });
      }
      return original(fd);
    };
    syncBuiltinESMExports();
    assert.throws(() => phase === "finish" ? recorder.finish(false, "CHECK_FAILED") :
      recorder.frame({ kind: "step-end", index: 0, elapsedMs: 1, exitCode: 1, signal: null, outcome: "exited" }));
    assert.equal(injected, true);
    assert.deepEqual(heldOutputs(recorder.directory), []);
    assert.equal(fs.existsSync(join(recorder.directory, "receipt.json")), false);
  } finally {
    fs.fsyncSync = original; syncBuiltinESMExports(); fs.rmSync(root, { recursive: true, force: true });
  }
});
