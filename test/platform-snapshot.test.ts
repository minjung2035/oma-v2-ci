/** macos-platform §8.4 (REC-005, MAC-619..622, MAC-661, MV-32): snapshots
 * only at a quiescent point, and no copy whose consistency is not proven. */
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GuestLink } from "../src/platform/host/guest-link.js";
import { pruneSnapshots, snapshotRunning, snapshotStopped } from "../src/platform/host/snapshot.js";
import type { SessionLauncher } from "../src/platform/guest/host.js";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "../src/protocol/host-guest.js";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";

async function world(t: import("node:test").TestContext, stopResult: "stopped" | "unknown" = "stopped") {
  const dir = mkdtempSync(join(tmpdir(), "oma-snapshot-"));
  const societiesDir = join(dir, "data", "oma");
  mkdirSync(join(societiesDir, "demo", "state"), { recursive: true });
  const holderPath = join(dir, "demo.sock");
  let holder = await listenSilently(holderPath);
  const stops: string[] = [];
  const launcher: SessionLauncher = { socketPath: () => holderPath, start: async () => {},
    stop: async society => { stops.push(society); if (stopResult === "stopped") await new Promise(r => holder.close(r)); return stopResult; } };
  const instance = randomUUID();
  const driver = new LocalDriver(dir, { dir: societiesDir, launcher }, instance);
  await driver.start();
  const link = new GuestLink(driver, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: instance, expectImage: "2026.09.1",
    protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } }, { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 5000 });
  const snapshots = join(dir, "snapshots"); mkdirSync(snapshots);
  const statePath = join(dir, "state.img"); writeFileSync(statePath, "the state disk");
  t.after(async () => { await driver.dispose(); await new Promise(r => holder.close(() => r(null))); rmSync(dir, { recursive: true, force: true }); });
  return { driver, link, snapshots, statePath, stops };
}
const copy = (from: string, to: string): void => { copyFileSync(from, to); };

test("REC-005/MAC-620: a running VM's snapshot stops every society, freezes for the clone, and keeps it only after a thaw that found the freeze", async t => {
  const { driver, link, snapshots, statePath, stops } = await world(t);
  const made = await snapshotRunning({ dir: snapshots, statePath, clone: copy }, link, "s1");
  assert.equal(made.path, join(snapshots, "s1.img"));
  assert.deepEqual(made.stopped, ["demo"]);
  assert.deepEqual(stops, ["demo"]);
  assert.equal(readFileSync(made.path, "utf8"), "the state disk");
  assert.deepEqual(driver.calls.filter(call => call !== "time.set:true"),
    ["maintenance.begin", "society.list", "society.close", "maintenance.end"], "the societies were stopped before the clone, and opening was barred throughout");
});

test("MAC-622: when the deadline thawed before the host did, the copy is discarded", async t => {
  const { link, snapshots, statePath } = await world(t);
  // A clone slower than the freeze's deadline: the guest thaws by itself first.
  const slow = (from: string, to: string): void => { copyFileSync(from, to); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); };
  await assert.rejects(snapshotRunning({ dir: snapshots, statePath, clone: slow, freezeMs: 50 }, link, "s2"), /could not be made/);
  assert.deepEqual(readdirSync(snapshots), [], "no snapshot, and no partial copy left behind");
});

test("P0-5: a society whose stop is not seen to end means no snapshot, and opening is allowed again", async t => {
  const { driver, link, snapshots, statePath } = await world(t, "unknown");
  await assert.rejects(snapshotRunning({ dir: snapshots, statePath, clone: copy }, link, "s3"), /did not stop/);
  assert.deepEqual(readdirSync(snapshots), []);
  assert.ok(driver.calls.includes("maintenance.end"));
});

test("§8.4/MAC-661: a stopped VM is cloned as it is; old snapshots go oldest first, an update's own is kept", async t => {
  const { snapshots, statePath } = await world(t);
  for (const [index, id] of ["a", "b", "c", "d", "e"].entries()) {
    await snapshotStopped({ dir: snapshots, statePath, clone: copy }, id);
    utimesSync(join(snapshots, `${id}.img`), 1000 + index, 1000 + index);
  }
  assert.deepEqual(pruneSnapshots(snapshots, 3, new Set(["a.img"])), ["b.img"]);
  assert.deepEqual(readdirSync(snapshots).sort(), ["a.img", "c.img", "d.img", "e.img"]);
  assert.equal(existsSync(join(snapshots, "a.img")), true, "the update's snapshot stays");
});
