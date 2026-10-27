/** Consume actual host results. The disposable native fault controls invoke
 * this same consumer; no caller can select a different OS for its verdict. */
import assert from "node:assert/strict";
import { validateDescriptorCapabilityObservation } from "../../scripts/descriptor-capability-observation.mjs";
export function assertActualDescriptorOracle(value) {
  assert.equal(value.platform, process.platform);
  validateDescriptorCapabilityObservation(value);
  assert.equal(value.devFd.attempted, true);
  assert.deepEqual(value.namespace, { heldAfterSwap: true, namedIsReplacement: true, heldAfterUnlink: true });
  assert.deepEqual(value.exec.direct, { execErrno: null, exitCode: 0, signal: null, reply: "original" });
  assert.deepEqual(value.exec.namedAfterSwap, { execErrno: null, exitCode: 0, signal: null, reply: "replacement" });
  if (process.platform === "linux") {
    assert.equal(value.devFd.sameInode, true);
    assert.equal(value.devFd.sourceBefore, 2); assert.equal(value.devFd.sourceAfter, 2);
    assert.equal(value.devFd.duplicateBefore, 0); assert.equal(value.devFd.duplicateAfter, 1);
    assert.equal(value.devFd.closeOnExec, true); assert.equal(value.devFd.accessMode, 0);
    assert.equal(value.fileport.available, false);
    assert.equal(value.fileport.makeportReturn, null); assert.equal(value.fileport.duplicate.attempted, false);
    assert.equal(value.exec.fdBeforeSwap.reply, "original");
    assert.equal(value.exec.fdAfterSwap.reply, "original"); assert.equal(value.exec.fdAfterUnlink.reply, "original");
  }
}
