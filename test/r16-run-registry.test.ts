import test from "node:test";
import assert from "node:assert/strict";
import { RunRegistry, type CgroupPin, type Population } from "../src/runtime/run-registry.js";

function observedPin(fd: number) {
  let population: Population = "populated";
  let current = true;
  let closes = 0;
  const pin: CgroupPin = {
    fd, identity: Object.freeze({ dev: 1n, ino: BigInt(fd) }),
    population: () => population,
    matches: () => current && closes === 0,
    close: () => { closes++; },
  };
  return { pin, population: (value: Population) => { population = value; },
    replace: () => { current = false; }, closes: () => closes };
}
const first = "1".repeat(32);
const second = "2".repeat(32);

test("R16: revoked endpoint retains its cgroup pin and cannot reissue the same invocation", () => {
  const observation = observedPin(10);
  const registry = new RunRegistry(() => observation.pin);
  const record = registry.begin("alice", 1, first, "/society/alice");
  assert.equal(record.phase, "opening");
  assert.equal(record.lease, null);
  let endpointsClosed = 0;
  const lease = record.publish({ socketHostPath: "/run/actor.sock", done: () => { endpointsClosed++; } });
  assert.equal(record.phase, "live");
  assert.deepEqual(lease, { actor: "alice", incarnation: 1, socketHostPath: "/run/actor.sock" });
  record.revoke(); record.revoke();
  assert.equal(record.phase, "revoked-awaiting-death");
  assert.equal(record.lease, null);
  assert.equal(endpointsClosed, 1);
  assert.equal(observation.closes(), 0);
  assert.throws(() => registry.begin("alice", 2, first, "/society/alice"), { code: "STALE_RUN" });
  registry.close(); registry.close();
  assert.equal(record.phase, "closed");
  assert.equal(observation.closes(), 1);
});

for (const population of ["populated", "unknown"] as const) {
  test(`R16: old ${population} cgroup blocks a new incarnation before a new FD is acquired`, () => {
    const old = observedPin(10); const next = observedPin(11);
    let acquisitions = 0;
    const registry = new RunRegistry(() => acquisitions++ === 0 ? old.pin : next.pin);
    const record = registry.begin("alice", 1, first, "/old");
    record.publish({ socketHostPath: "/run/old.sock", done() {} });
    old.population(population);
    assert.throws(() => registry.begin("alice", 2, second, "/new"), { code: "RUN_TERMINATION_UNKNOWN" });
    assert.equal(acquisitions, 1);
    assert.equal(registry.get("alice"), record);
    assert.equal(old.closes(), 0);
    registry.close();
  });
}

for (const population of ["empty", "removed"] as const) {
  test(`R16: observed ${population} permits one ownership transfer and closes only the old pin`, () => {
    const old = observedPin(10); const next = observedPin(11);
    let acquisitions = 0;
    const registry = new RunRegistry(() => acquisitions++ === 0 ? old.pin : next.pin);
    const previous = registry.begin("alice", 1, first, "/old");
    previous.publish({ socketHostPath: "/run/old.sock", done() {} });
    old.population(population);
    const current = registry.begin("alice", 2, second, "/new");
    assert.equal(previous.phase, "closed");
    assert.equal(old.closes(), 1);
    assert.equal(next.closes(), 0);
    assert.equal(current.identity.incarnation, 2);
    assert.deepEqual(current.identity.cgroupIdentity, { dev: 1n, ino: 11n });
    current.revoke(); // A failed endpoint retains the attempted invocation fence.
    assert.throws(() => registry.begin("alice", 3, second, "/new"), { code: "STALE_RUN" });
    registry.close();
    assert.equal(next.closes(), 1);
  });
}

test("R16: matching pathname cannot substitute a replacement cgroup inode", () => {
  const observation = observedPin(10);
  const registry = new RunRegistry(() => observation.pin);
  const record = registry.begin("alice", 1, first, "/same-path");
  record.publish({ socketHostPath: "/run/a.sock", done() {} });
  assert.equal(record.matches("/same-path"), true);
  observation.replace();
  assert.equal(record.matches("/same-path"), false);
  assert.equal(record.population(), "populated");
  registry.close();
});

test("R16: shutdown attempts every native close even if an endpoint cleanup throws", () => {
  const alice = observedPin(10); const bob = observedPin(11);
  const registry = new RunRegistry(path => path === "/alice" ? alice.pin : bob.pin);
  registry.begin("alice", 1, first, "/alice").publish({ socketHostPath: "/a", done() { throw new Error("endpoint fault"); } });
  registry.begin("bob", 1, second, "/bob").publish({ socketHostPath: "/b", done() {} });
  assert.throws(() => registry.close(), /endpoint fault/);
  assert.equal(alice.closes(), 1);
  assert.equal(bob.closes(), 1);
  registry.close();
  assert.equal(alice.closes(), 1);
});
