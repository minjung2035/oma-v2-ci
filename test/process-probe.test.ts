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
} from "@oma/broker/process-ancestry";

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

test("descent walks the whole chain -- depth alone is not a refusal, and a cycle ends it closed", () => {
  // A chain of 64 live processes, deeper than any bound the walk once carried:
  // pid N's parent is N-1 down to init.
  const deep = new Map<number, ProcessObservation>([[1, { kind: "running", ppid: 0, startTime: "1" }]]);
  for (let pid = 2; pid <= 64; pid += 1) deep.set(pid, { kind: "running", ppid: pid - 1, startTime: String(pid) });
  const probe = processProbeFor("darwin", pid => deep.get(pid) ?? { kind: "unavailable" });
  const root = probe.identity(2)!;
  assert.equal(probe.descendsFrom(64, root), true, "a chain sixty-two links deep is still descent");
  deep.set(1, { kind: "running", ppid: 0, startTime: "1" });
  assert.equal(probe.descendsFrom(64, { pid: 2, startTime: "other" }), false,
    "the ancestor's pinned start time is part of the identity -- reuse is not descent");
  // A loop -- 700 <-> 701 -- can never reach init or the ancestor; the walk
  // must end it, not follow it forever and never call it descent.
  const looped = new Map<number, ProcessObservation>([
    [700, { kind: "running", ppid: 701, startTime: "7" }],
    [701, { kind: "running", ppid: 700, startTime: "8" }],
    [702, { kind: "running", ppid: 702, startTime: "9" }],
  ]);
  const cyclic = processProbeFor("darwin", pid => looped.get(pid) ?? { kind: "unavailable" });
  assert.equal(cyclic.descendsFrom(701, { pid: 1, startTime: "1" }), false, "a pid pair parenting each other is no descent");
  assert.equal(cyclic.descendsFrom(702, { pid: 1, startTime: "1" }), false, "a pid that is its own parent is no descent");
  // An unreadable middle of the chain fails the walk closed -- it is never
  // treated as reaching the ancestor or as the process having ended.
  const blind = new Map<number, ProcessObservation>([
    [1, { kind: "running", ppid: 0, startTime: "1" }],
    [900, { kind: "running", ppid: 901, startTime: "9" }],
    [901, { kind: "unavailable" }],
    [902, { kind: "running", ppid: 1, startTime: "1" }],
  ]);
  const dim = processProbeFor("darwin", pid => blind.get(pid) ?? { kind: "unavailable" });
  assert.equal(dim.descendsFrom(900, { pid: 1, startTime: "1" }), false, "an unavailable link is not a proven chain");
});

test("descent refuses a child that detached while its former parent PID was followed", () => {
  let detached = false;
  const probe = processProbeFor("policy-reader-only", pid => {
    if (pid === 300) return { kind: "running", ppid: detached ? 1 : 200, startTime: "child" };
    if (pid === 200) { detached = true; return { kind: "running", ppid: 100, startTime: "replacement-parent" }; }
    if (pid === 100) return { kind: "running", ppid: 1, startTime: "engine" };
    return { kind: "unavailable" };
  });
  // Supplied observations exercise only common policy, never a Darwin or
  // Linux kernel proof. Native sender/scope pinning is still required.
  assert.equal(probe.substrate, "none");
  assert.equal(probe.descendsFrom(300, { pid: 100, startTime: "engine" }), false);
});

test("descent refuses an intermediate identity that changed after the first walk", () => {
  let walked = false;
  const probe = processProbeFor("policy-reader-only", pid => {
    if (pid === 300) return { kind: "running", ppid: 200, startTime: "child" };
    if (pid === 200) return { kind: "running", ppid: 100, startTime: walked ? "other-parent" : "parent" };
    if (pid === 100) { walked = true; return { kind: "running", ppid: 1, startTime: "engine" }; }
    return { kind: "unavailable" };
  });
  assert.equal(probe.descendsFrom(300, { pid: 100, startTime: "engine" }), false);
});

test("descent refuses a replaced ancestor before publishing the chain", () => {
  let rootReads = 0;
  const probe = processProbeFor("policy-reader-only", pid => {
    if (pid === 300) return { kind: "running", ppid: 100, startTime: "child" };
    if (pid === 100) return { kind: "running", ppid: 1, startTime: ++rootReads === 1 ? "engine" : "other-engine" };
    return { kind: "unavailable" };
  });
  assert.equal(probe.descendsFrom(300, { pid: 100, startTime: "engine" }), false);
});

test("descent refuses a chain that became unobservable without reporting process death", () => {
  let childReads = 0;
  const probe = processProbeFor("policy-reader-only", pid => {
    if (pid === 300) return ++childReads === 1 ? { kind: "running", ppid: 100, startTime: "child" } : { kind: "unavailable" };
    if (pid === 100) return { kind: "running", ppid: 1, startTime: "engine" };
    return { kind: "unavailable" };
  });
  assert.equal(probe.descendsFrom(300, { pid: 100, startTime: "engine" }), false);
  assert.equal(probe.ended({ pid: 300, startTime: "child" }), "unknown");
});

test("the exported entry points are the platform probe's, unchanged for callers", () => {
  assert.equal(processIdentity(process.pid)?.pid, process.pid);
  assert.equal(parentOf(process.pid), process.ppid);
  assert.equal(processEnded(processIdentity(process.pid)!), "running");
  assert.equal(descendsFrom(process.pid, processIdentity(process.pid)!), true);
});
