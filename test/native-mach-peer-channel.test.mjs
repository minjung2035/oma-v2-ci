/** Real launch + Seatbelt + inherited expected peer, independent of product
 * Actor admission and durable scope ownership. Linux checks only refusal. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pinInheritedDarwinPeer, reacquireChangedDarwinProcess, retainDarwinProcessPin, darwinProcessStopHint } from "@oma/native/audit-session";
import { createMachBrokerTransport } from "@oma/platform-mac/mach-transport";
import { inheritedMachPeerEndpoint } from "@oma/native/mach-message";

test("000. Caller-shaped process facts cannot request a changed-watch replacement", () => {
  let called = false;
  assert.throws(() => reacquireChangedDarwinProcess({ pid: process.pid, token: [], identity: {},
    state() { called = true; return "changed"; }, close() {} }), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.equal(called, false);
  assert.throws(() => retainDarwinProcessPin({ pid: process.pid, token: [], identity: {},
    state() { called = true; return "live"; }, close() {} }), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.equal(called, false);
});
test("000. Readiness observes the actual caller without providing process authority", () => {
  if (process.platform !== "darwin") return assert.throws(() => darwinProcessStopHint(process.pid), { code: "UNSUPPORTED_PROFILE" });
  assert.equal(darwinProcessStopHint(process.pid), "running");
  assert.throws(() => darwinProcessStopHint(0), TypeError);
});

test("000. Reserving an endpoint never falls back to a pathname socket", () => {
  if (process.platform !== "darwin")
    assert.throws(() => createMachBrokerTransport(1).reservePeer("/oma-reservation-refusal"), { code: "UNSUPPORTED_PROFILE" });
});

for (const name of ["mach-stream-roundtrip", "mach-stream-wrong-peer", "mach-stream-descendant", "mach-stream-reserved"])
  test(`001. Actual inherited peer channel: ${name}`, { timeout: 90000 }, t => {
    if (process.platform !== "darwin") {
      assert.throws(pinInheritedDarwinPeer, { code: "UNSUPPORTED_PROFILE" });
      assert.throws(inheritedMachPeerEndpoint, { code: "UNSUPPORTED_PROFILE" }); return;
    }
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/darwin-mach-stream.mjs", import.meta.url)), name],
      { encoding: "utf8", timeout: 80000, maxBuffer: 65536 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout); assert.equal(value.case, name);
    if (name !== "mach-stream-wrong-peer") {
      assert.equal(value.machStream.inheritedPeer, true); assert.equal(value.machStream.noSourceRefused, true);
      assert.equal(value.machStream.authenticatedEof, true); assert.equal(value.machStream.resourcesReturned, true);
      if (name === "mach-stream-descendant" || name === "mach-stream-reserved") {
        assert.equal(value.machStream.descendant.sameCoalition, true); assert.equal(value.machStream.descendant.originalPeer, true);
        assert.equal(value.machStream.descendant.workerPid, value.machStream.sender);
        assert.notEqual(value.machStream.descendant.runnerPid, value.machStream.sender);
      }
      if (name === "mach-stream-reserved") {
        assert.equal(value.machStream.reservedEndpoint, true); assert.equal(value.machStream.wrongPurposeRefused, true);
        assert.equal(value.machStream.listenerRevoked, true);
      }
      assert.equal(value.machStream.sentBytes, 393217); assert.equal(value.machStream.receivedBytes, 393217);
    } else assert.equal(value.expectedPeer.clientRefused, true);
    t.diagnostic(JSON.stringify(value));
  });
