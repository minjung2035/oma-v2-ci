import { createMailModule } from "#oma-test/app/broker/mail-composition";
// P9: the power-cut lane must refuse to run anywhere but a disposable VM, and it
// must stay a separate failure model from the SIGKILL crash lane.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { powercutGuards, prepareCheckpoint, verifyCheckpoint, observe, runRecovery } from "../scripts/powercut-lane.mjs";
import { physicalLedger } from "./helpers/physical-ledger.mjs";
import { MailModule } from "@oma/mail";

const script = new URL("../scripts/powercut-lane.mjs", import.meta.url).pathname;
// Even on a disposable VM, ordinary tests must never authorize a host restart.
const run = (args) => spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8", timeout: 60_000, env: { ...process.env, OMA_POWERCUT_ACK: "" },
});

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
  assert.ok(payload.failures.includes("OMA_POWERCUT_ACK must be set to disposable-vm"), JSON.stringify(payload.failures));
  // An unsupported environment is not a power-loss PASS and not a failure either.
  assert.doesNotMatch(result.stdout, /powerLossProven":true/);
});

test("P9 power-cut lane: an invalid phase is rejected before any guard evaluation", () => {
  const result = run(["--phase", "recover", "--state", "/tmp/x", "--society", "demo", "--out", "/tmp/y"]);
  assert.equal(result.status, 4);
  assert.match(result.stdout, /--phase must be prepare or verify/);
});

test("P9 failure models stay separate: the lane never claims to replace the SIGKILL crash lane", () => {
  // The crash lane keeps its own harness and evidence; a guest restart or
  // simulation must not be relabeled as physical power loss.
  const source = readFileSync(new URL("../scripts/powercut-lane.mjs", import.meta.url), "utf8");
  assert.match(source, /sigkillLaneReplaced: false/);
  assert.match(source, /separate failure model/i);
  assert.match(source, /SIGKILL results are never reused as power-loss proof/);
});

const recovered = () => ({ ok: true, started: true, exitCode: 0, signal: null, timedOut: false, forced: false, error: null });
function dummy(t) {
  const fixture = physicalLedger(t);
  const context = { stateRoot: fixture.root, society: "fixture", failureModel: "simulation" };
  let boot = randomUUID(), cuts = 0, checkpoint;
  const mail = () => createMailModule(fixture.context, fixture.store, 64, 24, { frameBytes: 256 * 1024, batchMaxMessages: 24 });
  const ports = {
    bootId: () => boot,
    observe: () => observe(fixture.root, "fixture"),
    persist: value => { writeFileSync(join(fixture.root, "dummy-checkpoint.json"), JSON.stringify(value), { flag: "wx" }); checkpoint = value; },
    // No host power API: only this fixture's connection and simulated boot end.
    cut: () => { fixture.reopen(); boot = randomUUID(); cuts += 1; },
    recover: async () => { await mail().reconcilePending(); return recovered(); },
  };
  return { fixture, context, ports, mail, get cuts() { return cuts; }, get checkpoint() { return checkpoint; } };
}

test("P9 simulation: real accepted mail survives checkpoint, dummy restart and repeated same-key recovery", async t => {
  const d = dummy(t), f = d.fixture;
  const accepted = f.store.getOperationById(f.id);
  const checkpoint = await prepareCheckpoint(d.context, d.ports);
  assert.equal(d.cuts, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, "dummy-checkpoint.json"))), checkpoint);
  const first = await verifyCheckpoint(d.context, checkpoint, d.ports);
  assert.equal(first.status, "PASS", JSON.stringify(first));
  assert.equal(first.simulationPassed, true);
  assert.equal(first.powerLossProven, false);
  assert.equal(first.guestRestartProven, false);
  assert.equal(first.sigkillLaneReplaced, false);
  const settled = f.store.getOperationById(f.id);
  assert.equal(settled.state, "succeeded");
  assert.equal(settled.requestHash, accepted.requestHash);
  assert.equal(settled.planJson, accepted.planJson);
  assert.deepEqual(readFileSync(f.archive), f.bytes);
  assert.deepEqual(readFileSync(f.inbox()), f.bytes);
  const replay = await d.mail().send({ actor: "alice", capabilities: ["mail.send"] }, accepted.requestKey, JSON.parse(accepted.payloadJson));
  assert.equal(replay.state, "succeeded");
  const second = await verifyCheckpoint(d.context, checkpoint, d.ports);
  assert.equal(second.status, "PASS");
  assert.deepEqual(f.store.getOperationById(f.id), settled);
  assert.equal(readdirSync(dirname(f.inbox())).length, 1);
});

test("P9 simulation: missing immutable bytes are a real diagnostic failure, not successful recovery", async t => {
  const d = dummy(t);
  const checkpoint = await prepareCheckpoint(d.context, d.ports);
  rmSync(d.fixture.object);
  const result = await verifyCheckpoint(d.context, checkpoint, { ...d.ports, recover: async () => recovered() });
  assert.equal(result.afterReboot.report.status, "FAIL");
  assert.equal(result.status, "FAIL");
  assert.equal(result.simulationPassed, false);
  assert.equal(result.powerLossProven, false);
});

test("P9 simulation: checkpoint failure never calls cut or leaves successful evidence", async t => {
  const d = dummy(t);
  for (const observed of [{ exitCode: 2, report: { status: "UNKNOWN" } }, { exitCode: 1, report: { status: "PASS" } }]) {
    await assert.rejects(prepareCheckpoint(d.context, { ...d.ports, observe: () => observed }), /integrity check/);
  }
  await assert.rejects(prepareCheckpoint(d.context, { ...d.ports, persist: () => { throw new Error("ENOSPC"); } }), /ENOSPC/);
  assert.equal(d.cuts, 0);
  assert.equal(d.checkpoint, undefined);
});

test("P9 simulation: UNKNOWN, failed recovery and foreign or unchanged boot evidence never pass", async t => {
  const d = dummy(t), checkpoint = await prepareCheckpoint(d.context, d.ports);
  for (const recovery of [{ ...recovered(), ok: false }, { ...recovered(), started: false },
    { ...recovered(), timedOut: true }, { ...recovered(), exitCode: 1 }, { ...recovered(), forced: true }]) {
    const result = await verifyCheckpoint(d.context, checkpoint, { ...d.ports, recover: () => recovery });
    assert.equal(result.status, "FAIL");
    assert.equal(result.powerLossProven, false);
  }
  let calls = 0;
  const result = await verifyCheckpoint(d.context, checkpoint, { ...d.ports,
    observe: () => ++calls === 1 ? { exitCode: 2, report: { status: "UNKNOWN" } } : d.ports.observe() });
  assert.equal(result.status, "FAIL", "later PASS cannot erase an unknown initial observation");
  for (const bad of [null, { ...checkpoint, stateRoot: "/other" }, { ...checkpoint, society: "other" },
    { ...checkpoint, schema: 1 }, { ...checkpoint, failureModel: "guest-reset" },
    { ...checkpoint, before: { exitCode: 1, report: { status: "FAIL" } } }]) {
    await assert.rejects(verifyCheckpoint(d.context, bad, d.ports), /checkpoint evidence/);
  }
  await assert.rejects(verifyCheckpoint(d.context, checkpoint, { ...d.ports, bootId: () => checkpoint.bootId }), /no new boot/);
  await assert.rejects(verifyCheckpoint(d.context, checkpoint, { ...d.ports, recover: () => { throw new Error("recovery failed"); } }), /recovery failed/);
});

test("P9 simulation: recovery child readiness, early exit, spawn error and timeout are observed asynchronously", async () => {
  const run = code => runRecovery(process.execPath, ["-e", code], { timeoutMs: 500, stopMs: 100 });
  const ready = await run("process.on('SIGTERM',()=>process.exit(0)); process.stderr.write('broker listening'); setInterval(()=>{},1000)");
  assert.equal(ready.ok, true, JSON.stringify(ready));
  const early = await run("process.exit(2)");
  assert.equal(early.ok, false); assert.equal(early.exitCode, 2);
  const timeout = await run("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)");
  assert.equal(timeout.ok, false); assert.equal(timeout.timedOut, true); assert.equal(timeout.forced, true);
  assert.equal(timeout.signal, "SIGKILL");
  const absent = await runRecovery("/nonexistent/oma-recovery-fixture", [], { timeoutMs: 500 });
  assert.equal(absent.ok, false); assert.match(absent.error, /ENOENT/);
});
