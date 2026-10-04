/** AUTH-003/PR-001, INV02: the process-observation seam. Linux's substrate is
 * /proc; every other platform ships none -- the macOS equivalence lane is
 * explicitly NOT_RUN -- and "no substrate" is "unavailable", never a false
 * "exited". */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  processProbeFor, hostProcessProbe, processIdentity, parentOf, processEnded, descendsFrom,
  type ProcessObservation, type ProcessIdentity,
} from "../src/broker/process-ancestry.js";

test("the Linux substrate answers from real /proc, unchanged", () => {
  const probe = processProbeFor("linux");
  assert.equal(probe.substrate, "proc");
  const self = probe.identity(process.pid)!;
  assert.ok(self !== null && /^[0-9]+$/.test(self.startTime), "this process is observed running with its start time");
  assert.equal(probe.parentOf(process.pid), process.ppid);
  assert.equal(probe.descendsFrom(process.pid, self), true, "a process descends from itself");
  assert.equal(probe.ended(self), "running");
  // The pid space's edge: the kernel has no such process -- "exited", which is
  // the only answer that may retire an engine (INV02).
  const dead = spawnSync("true", { stdio: "ignore" }).pid;
  assert.equal(probe.ended({ pid: dead, startTime: "1" }), "ended", "a pid the kernel does not have ended");
  // Malformed input is unobservable, not exited.
  assert.equal(probe.ended({ pid: -1, startTime: "0" }), "unknown");
  assert.equal(probe.identity(-1), null);
});

test("INV02 / macOS NOT_RUN lane: a platform with no substrate observes nothing -- and never says a process ended", () => {
  for (const platform of ["darwin", "freebsd", "win32"]) {
    const probe = processProbeFor(platform);
    assert.equal(probe.substrate, "none", `${platform} ships no substrate`);
    assert.equal(probe.identity(1), null);
    assert.equal(probe.parentOf(1), null);
    // The regression the seam closes: an absent /proc's ENOENT used to read
    // as "exited" -- a living engine would be retired by a platform that
    // could not observe it at all. "unknown" refuses without ending.
    assert.equal(probe.ended({ pid: 1, startTime: "1" }), "unknown",
      `${platform}: unobservable is unknown, never ended`);
    assert.equal(probe.descendsFrom(process.pid, { pid: 1, startTime: "1" }), false);
  }
  assert.equal(hostProcessProbe.substrate, "proc", "this run is Linux -- and this run is the only lane claimed");
});

test("the seam takes a substrate: an injected reader drives the same four answers", () => {
  // A process table: 100 -> 1, 200 -> 100, 300 -> 100, 400 (no parent).
  const table = new Map<number, ProcessObservation>([
    [1, { kind: "running", ppid: 0, startTime: "10" }],
    [100, { kind: "running", ppid: 1, startTime: "20" }],
    [200, { kind: "running", ppid: 100, startTime: "30" }],
    [300, { kind: "running", ppid: 100, startTime: "40" }],
    [400, { kind: "running", ppid: 0, startTime: "50" }],
    [999, { kind: "exited" }],
  ]);
  const probe = processProbeFor("darwin", pid => table.get(pid) ?? { kind: "unavailable" });
  assert.equal(probe.substrate, "none", "the shipped substrate is still honestly none; the reader is the test's");
  const engine = probe.identity(100)!;
  assert.deepEqual(engine, { pid: 100, startTime: "20" });
  assert.equal(probe.descendsFrom(200, engine), true, "a child descends");
  assert.equal(probe.descendsFrom(300, engine), true, "a sibling descends");
  assert.equal(probe.descendsFrom(400, engine), false, "an unrelated process does not");
  assert.equal(probe.descendsFrom(999, engine), false, "an exited process is not a descendant");
  assert.equal(probe.ended(engine), "running");
  table.set(100, { kind: "running", ppid: 1, startTime: "999" });
  assert.equal(probe.ended(engine), "ended", "the same pid started at another time is a different process");
  table.set(100, { kind: "unavailable" });
  assert.equal(probe.ended(engine), "unknown", "unreadable is unknown -- refuses, retires nothing");
});

test("the exported entry points are the platform probe's, unchanged for callers", () => {
  assert.equal(processIdentity(process.pid)?.pid, process.pid);
  assert.equal(parentOf(process.pid), process.ppid);
  assert.equal(processEnded(processIdentity(process.pid)!), "running");
  assert.equal(descendsFrom(process.pid, processIdentity(process.pid)!), true);
});
