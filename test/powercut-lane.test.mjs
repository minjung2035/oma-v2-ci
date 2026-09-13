// P9: the power-cut lane must refuse to run anywhere but a disposable VM, and it
// must stay a separate failure model from the SIGKILL crash lane.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { powercutGuards } from "../scripts/powercut-lane.mjs";

const script = new URL("../scripts/powercut-lane.mjs", import.meta.url).pathname;
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 60_000 });

test("P9 power-cut lane: every guard refuses an unguarded power-off", () => {
  const base = { stateRoot: "/srv/oma/demo", society: "demo", out: "/srv/evidence" };
  const only = (files, ...expected) => {
    const failures = powercutGuards({ ...base, ...files });
    for (const fragment of expected) assert.ok(failures.some(item => item.includes(fragment)), `${fragment} :: ${JSON.stringify(failures)}`);
    return failures;
  };
  assert.deepEqual(only({ env: {}, isRoot: true, markerExists: true }), ["OMA_POWERCUT_ACK must be set to disposable-vm"]);
  assert.deepEqual(only({ env: { OMA_POWERCUT_ACK: "disposable-vm" }, isRoot: true, markerExists: false }),
    ["/etc/oma-powercut-vm must exist (disposable VM marker)"]);
  only({ env: { OMA_POWERCUT_ACK: "disposable-vm" }, isRoot: false, markerExists: true }, "requires root");
  only({ stateRoot: "relative", out: "relative", society: "Bad Name",
    env: { OMA_POWERCUT_ACK: "disposable-vm" }, isRoot: true, markerExists: true }, "absolute path", "society name");
  // A fully guarded call reports at most the platform sysrq availability.
  const guarded = powercutGuards({ ...base, env: { OMA_POWERCUT_ACK: "disposable-vm" }, isRoot: true, markerExists: true });
  assert.ok(guarded.every(item => item.includes("sysrq-trigger")), JSON.stringify(guarded));
});

test("P9 power-cut lane: the command refuses to run outside a disposable VM", () => {
  const result = run(["--phase", "prepare", "--state", "/tmp/oma-powercut-probe", "--society", "demo", "--out", "/tmp/oma-powercut-evidence"]);
  assert.equal(result.status, 4);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, "UNSUPPORTED_PROFILE");
  assert.equal(payload.lane, "powercut");
  assert.equal(payload.powerLossProven, false);
  assert.ok(payload.failures.length >= 3, JSON.stringify(payload.failures));
  // An unsupported environment is not a power-loss PASS and not a failure either.
  assert.doesNotMatch(result.stdout, /powerLossProven":true/);
});

test("P9 power-cut lane: an invalid phase is rejected before any guard evaluation", () => {
  const result = run(["--phase", "recover", "--state", "/tmp/x", "--society", "demo", "--out", "/tmp/y"]);
  assert.equal(result.status, 4);
  assert.match(result.stdout, /--phase must be prepare or verify/);
});

test("P9 failure models stay separate: the lane never claims to replace the SIGKILL crash lane", () => {
  // The crash lane keeps its own harness and evidence; the power-cut lane adds
  // the physical power-off comparison instead of reusing SIGKILL results.
  const source = readFileSync(new URL("../scripts/powercut-lane.mjs", import.meta.url), "utf8");
  assert.match(source, /sigkillLaneReplaced: false/);
  assert.match(source, /separate failure model/i);
  assert.match(source, /SIGKILL results are never reused as power-loss proof/);
});
