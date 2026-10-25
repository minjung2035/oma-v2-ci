import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BrokerLifetime, settleWithin } from "@oma/broker/lifetime";
import { HOST_LOSS_SIGNALS } from "@oma/process/host-loss";
import { ProcessLock } from "@oma/native/process-lock";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { StoreError } from "@oma/domain/errors";
import { Store } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation } from "./fixtures/valid.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("R17: listener readiness precedes notification and permitted activation", async () => {
  const events: string[] = [];
  const listening = deferred();
  const lifetime = new BrokerLifetime({ close() { events.push("lock-close"); } }, () => 1);
  lifetime.attach({ closeAdmission() { events.push("admission-close"); }, async drainAndClose() { events.push("store-close"); } });
  const starting = lifetime.start({
    async recover() { events.push("recovery"); },
    async listen() { events.push("listen-start"); await listening.promise; events.push("listen-ready"); },
    notify() { events.push("READY"); },
    async activate() { assert.equal(lifetime.permitsActivation, true); events.push("activate"); },
  });
  await Promise.resolve();
  assert.deepEqual(events, ["recovery", "listen-start"]);
  assert.equal(lifetime.permitsActivation, false);
  listening.resolve(); await starting;
  assert.deepEqual(events, ["recovery", "listen-start", "listen-ready", "READY", "activate"]);
  await lifetime.shutdown(); await lifetime.shutdown();
  assert.deepEqual(events.slice(-3), ["admission-close", "store-close", "lock-close"]);
  assert.equal(lifetime.phase, "closed");
});

for (const failed of ["recovery", "listen", "notify"] as const) {
  test(`R17: ${failed} failure cannot produce activation or release a lock before Store close`, async () => {
    const events: string[] = [];
    const lifetime = new BrokerLifetime({ close() { events.push("lock"); } }, () => 1);
    lifetime.attach({ closeAdmission() { events.push("admission"); }, async drainAndClose() { events.push("store"); } });
    const step = (name: string) => { events.push(name); if (name === failed) throw new Error("phase failed"); };
    await assert.rejects(lifetime.start({ async recover() { step("recovery"); }, async listen() { step("listen"); }, notify() { step("notify"); }, async activate() { step("activate"); } }), /phase failed/);
    assert.equal(events.includes("activate"), false);
    await lifetime.shutdown();
    assert.deepEqual(events.slice(-3), ["admission", "store", "lock"]);
  });
}

test("R17: shutdown during recovery blocks every later startup phase", async () => {
  const recover = deferred(); const events: string[] = [];
  const lifetime = new BrokerLifetime({ close() { events.push("lock"); } }, () => 1);
  lifetime.attach({ closeAdmission() { events.push("admission"); }, async drainAndClose() { events.push("store"); } });
  const starting = lifetime.start({ recover: () => recover.promise, async listen() { events.push("listen"); }, notify() { events.push("notify"); }, async activate() { events.push("activate"); } });
  const rejected = assert.rejects(starting, { code: "BROKER_UNAVAILABLE" });
  const closing = lifetime.shutdown();
  assert.deepEqual(events, ["admission"]);
  recover.resolve(); await rejected; await closing;
  assert.deepEqual(events, ["admission", "store", "lock"]);
});

test("R17: expired durable handoff is a failure, not permission to release a live writer", async () => {
  const task = deferred();
  await assert.rejects(settleWithin([task.promise], 0.01), { code: "DEADLINE_EXCEEDED" });
  task.resolve(); await settleWithin([task.promise], 1);
});

test("R17: one process lock excludes a second token and rejects a different society path", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r17-lock-"));
  const path = join(root, "broker.lock"); const lock = ProcessLock.acquire(path);
  try {
    lock.assertHeld(path);
    assert.throws(() => ProcessLock.acquire(path), { code: "BROKER_UNAVAILABLE" });
    assert.throws(() => lock.assertHeld(join(root, "other.lock")), { code: "BROKER_UNAVAILABLE" });
  } finally { lock.close(); lock.close(); rmSync(root, { recursive: true, force: true }); }
});

test("R17: draining rejects new intent inside T while preserving accepted settlement", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r17-store-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const gate = new AdmissionGate(); bindAdmissionGate(store, gate);
  try {
    store.transaction(tx => tx.insertAgent(makeValidAgent()));
    const accepted = makeValidOperation({ stateRoot: root, requestKey: "accepted" });
    store.transaction(tx => tx.insertOperation(accepted));
    gate.close();
    const refused = makeValidOperation({ stateRoot: root, requestKey: "refused" });
    assert.throws(() => store.transaction(tx => tx.insertOperation(refused)), { code: "BROKER_UNAVAILABLE" });
    assert.equal(store.getOperationById(refused.id), null);
    store.transaction(tx => tx.setOperationUnknown(accepted.id));
    assert.equal(store.getOperationById(accepted.id)!.state, "unknown");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("R17: only Store corruption latches the global gate; run and repository uncertainty keep their scope", () => {
  const gate = new AdmissionGate();
  for (const code of ["REF_STATE_UNKNOWN", "RUN_TERMINATION_UNKNOWN", "DB_BUSY"] as const) {
    gate.observe(new StoreError(code, "scoped fault")); gate.assertAdmission();
  }
  gate.observe(new StoreError("STORE_CORRUPT", "bad durable row"));
  assert.throws(() => gate.assertAdmission(), { code: "STORE_CORRUPT" });
  gate.close(); assert.throws(() => gate.assertAdmission(), { code: "STORE_CORRUPT" });
});

/** AV31 -- D03, LIFE-006: the twelfth functional run quit the product's `oma`
 * while two Residents were inside a 90 s tool call. `oma` was the terminal
 * session's leader; its exit hung up the terminal, and the broker -- in its
 * process group, handling SIGTERM and SIGINT only -- died of SIGHUP in the
 * middle of its drain. The Residents ran on with no broker, and when their
 * turns ended their runners failed until systemd's start limit stopped them. */
test("AV31 / D03, LIFE-006: a hung-up terminal ends the broker through its drain, like any other host loss", { timeout: 20_000 }, async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const hostLoss = fileURLToPath(new URL(import.meta.resolve("@oma/process/host-loss")));
  const root = mkdtempSync(join(tmpdir(), "oma-av31-"));
  try {
    for (const signal of HOST_LOSS_SIGNALS) {
      const marker = join(root, signal);
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        const { stopOnHostLoss } = await import(${JSON.stringify(hostLoss)});
        const { writeFileSync } = await import("node:fs");
        stopOnHostLoss(() => { setTimeout(() => { writeFileSync(${JSON.stringify(marker)}, "drained"); process.exit(0); }, 200); });
        process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
      await new Promise<void>(resolve => { child.stdout.once("data", () => { resolve(); }); });
      child.kill(signal);
      const code = await new Promise<number | null>(resolve => { child.once("exit", resolved => { resolve(resolved); }); });
      assert.equal(code, 0, `${signal} ended the broker without its drain`);
      assert.equal(readFileSync(marker, "utf8"), "drained");
    }
    assert.deepEqual([...HOST_LOSS_SIGNALS].sort(), ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
