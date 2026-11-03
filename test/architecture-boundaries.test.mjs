import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
