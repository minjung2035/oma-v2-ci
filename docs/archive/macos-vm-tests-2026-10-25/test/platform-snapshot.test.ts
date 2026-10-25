/** macos-platform §8.4 (REC-005, MAC-619..622, MAC-661, MV-32): snapshots
 * only at a quiescent point, and no copy whose consistency is not proven. */
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GuestLink } from "#oma-test/app/platform/host/guest-link";
import type { FramedPeer } from "#oma-test/app/platform/rpc";
import { openSnapshotStore, pruneSnapshots, snapshotIdOf, snapshotRunning, snapshotStopped } from "#oma-test/app/platform/host/snapshot";
import type { SessionLauncher } from "#oma-test/app/platform/guest/host";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";
import { holdSocketNames } from "./fixtures/socket-names.js";
import type { Server } from "node:net";

async function world(t: import("node:test").TestContext, stopResult: "stopped" | "unknown" = "stopped",
  mutate?: (peer: FramedPeer) => void) {
  const dir = mkdtempSync(join(tmpdir(), "oma-snapshot-"));
  const socketNames = holdSocketNames(dir);
  let holder: Server | null = null, driver: LocalDriver | null = null;
  t.after(async () => {
    try { if (driver !== null) await driver.dispose(); }
    finally {
      try { if (holder !== null) await new Promise<void>(resolve => holder!.close(() => resolve())); }
      finally { socketNames.close(); rmSync(dir, { recursive: true, force: true }); }
    }
  });
  const societiesDir = join(dir, "data", "oma");
  mkdirSync(join(societiesDir, "demo", "state"), { recursive: true });
  const holderPath = join(dir, "demo.sock");
  holder = await listenSilently(holderPath);
  const stops: string[] = [];
  const launcher: SessionLauncher = { socketPath: () => holderPath, start: async () => {},
    stop: async society => {
      stops.push(society);
      if (stopResult === "stopped") { await new Promise<void>(resolve => holder!.close(() => resolve())); holder = null; }
      return stopResult;
    } };
  const instance = randomUUID();
  driver = new LocalDriver(dir, { dir: societiesDir, launcher, ...(mutate === undefined ? {} : { mutate }) }, instance);
  await driver.start();
  const link = new GuestLink(driver, { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: instance, expectImage: "2026.09.1",
    protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } }, { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 5000 });
  const snapshots = join(dir, "snapshots"); mkdirSync(snapshots);
  const statePath = join(dir, "state.img"); writeFileSync(statePath, "the state disk");
  return { driver, link, snapshots, statePath, stops };
}
const copy = (from: string, to: string): void => { copyFileSync(from, to); };

test("REC-005/MAC-620: a running VM's snapshot stops every society, freezes for the clone, and keeps it only after a thaw that found the freeze", async t => {
  const { driver, link, snapshots, statePath, stops } = await world(t);
  const made = await snapshotRunning({ dir: snapshots, statePath, clone: copy }, link, "s1");
  assert.equal(made.path, join(snapshots, "00000000-s1.img"));
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

test("§8.4/MAC-661, P0V-103 (G12-04): old snapshots go oldest first by the order they were made, not by their clock; an update's own is kept", async t => {
  const { snapshots, statePath } = await world(t);
  const made: string[] = [];
  for (const [index, id] of ["a", "b", "c", "d", "e"].entries()) {
    made.push(await snapshotStopped({ dir: snapshots, statePath, clone: copy }, id));
    // The wall clock went back between snapshots: the newest looks oldest.
    utimesSync(made[index]!, 5000 - index, 5000 - index);
  }
  const names = made.map(path => path.slice(snapshots.length + 1));
  assert.deepEqual(names, ["00000000-a.img", "00000001-b.img", "00000002-c.img", "00000003-d.img", "00000004-e.img"]);
  assert.deepEqual(pruneSnapshots(snapshots, 3, new Set([names[0]!])), [names[1]]);
  assert.deepEqual(readdirSync(snapshots).sort(), [names[0], names[2], names[3], names[4]]);
  assert.equal(existsSync(made[0]!), true, "the update's snapshot stays");
});

test("G12-04: a published name parses back to its own id -- a tail match is no match, and a version's '+' is a legal id", async t => {
  const { snapshots, statePath } = await world(t);
  // An image version may carry a +build suffix (image.ts): `update-<version>`
  // must always be an id the store accepts, or that update's first boot is
  // refused its rollback point forever.
  const marked = await snapshotStopped({ dir: snapshots, statePath, clone: copy }, "update-2026.09.1+build7");
  assert.equal(marked, join(snapshots, "00000000-update-2026.09.1+build7.img"));
  // The squat the old endsWith check fell for: `x-update-…`'s parsed id is
  // its own, never `update-…` -- and a name that is no snapshot has no id.
  const squatter = await snapshotStopped({ dir: snapshots, statePath, clone: copy }, "x-update-2026.09.1+build7");
  assert.equal(snapshotIdOf(squatter.slice(snapshots.length + 1)), "x-update-2026.09.1+build7");
  assert.equal(snapshotIdOf("00000002-update-2026.09.1+build7.img"), "update-2026.09.1+build7");
  assert.equal(snapshotIdOf("not-a-snapshot.img"), null);
  assert.equal(snapshotIdOf("00000002-no id chars!.img"), null);
  // Still refused: an id the rule cannot take.
  await assert.rejects(snapshotStopped({ dir: snapshots, statePath, clone: copy }, "-x"), /plain name/);
});

test("P0V-103 (F-08): a snapshot that was not finished is a temporary, never a snapshot, and the store's start removes it", async t => {
  const { snapshots, statePath } = await world(t);
  await assert.rejects(snapshotStopped({ dir: snapshots, statePath, clone: (from, to) => { copy(from, to); throw new Error("the clone was cut off"); } }, "cut"),
    /cut off/);
  assert.deepEqual(readdirSync(snapshots), [], "the cut clone is not left under any name");
  // A service that died mid-clone left a temporary; the next start removes it.
  const clone = (from: string, to: string): void => { copy(from, to); };
  let leftover = "";
  await snapshotStopped({ dir: snapshots, statePath, clone: (from, to) => { clone(from, to); leftover = to; copyFileSync(to, `${to}.kept`); } }, "whole");
  renameSync(`${leftover}.kept`, leftover);
  assert.equal(readdirSync(snapshots).some(name => name.endsWith(".partial")), true);
  assert.deepEqual(openSnapshotStore(snapshots).length, 1);
  assert.deepEqual(readdirSync(snapshots), ["00000000-whole.img"]);
});

/** The guest answers every request but refuses `maintenance.end`. */
const refuseMaintenanceEnd = (peer: FramedPeer): void => {
  const methods = new Map<string, string>();
  peer.onFrame(frame => { if (typeof frame.id === "string" && typeof frame.method === "string") methods.set(frame.id, frame.method); });
  const answer = peer.answer.bind(peer);
  peer.answer = (id, result) => {
    if (methods.get(id) === "maintenance.end") peer.refuse(id, { code: "BROKER_UNAVAILABLE", message: "the latch could not be returned", retry: "same-key" });
    else answer(id, result);
  };
};

test("NB-27/P0-4: a maintenance latch whose return fails is told -- alone, and together with the snapshot's own failure", async t => {
  const { link, snapshots, statePath } = await world(t, "stopped", refuseMaintenanceEnd);
  // The snapshot is made; the latch's return failing is told, not swallowed.
  await assert.rejects(snapshotRunning({ dir: snapshots, statePath, clone: copy }, link, "latch"),
    /latch could not be returned/);
  // Work and return of the latch both fail: the caller sees both failures.
  const both = await snapshotRunning({ dir: snapshots, statePath, clone: () => { throw new Error("the clone could not be made"); } }, link, "both")
    .then(() => null, (error: unknown) => error);
  assert.ok(both instanceof AggregateError && both.errors.length === 2, `expected both failures, got ${String(both)}`);
});
