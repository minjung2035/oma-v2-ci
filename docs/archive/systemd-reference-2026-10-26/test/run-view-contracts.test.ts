import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Broker, boundedLogOutput } from "@oma/broker";
import { UnitsModule } from "@oma/platform-linux/units";
import type { ProtocolLimits, UnitObservation } from "@oma/contracts";

const observation: UnitObservation = {
  activeState: "inactive",
  subState: "dead",
  result: "success",
  execMainStatus: 0,
  cgroup: "",
  invocationId: "",
};

function fakeObservation(units: UnitsModule): void {
  (units as unknown as { observe: (agent: string) => UnitObservation }).observe = () => observation;
}

test("RUN-001: confirmDead is fenced by the durable monotonic incarnation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-death-proof-"));
  try {
    const values = {
      node: process.execPath,
      libdir: "/usr/lib/oma",
      state: root,
      society: "demo",
      agent: "",
    };
    const units = new UnitsModule("demo", values, root, () => 7);
    fakeObservation(units);
    assert.equal(units.confirmDead("alice", 6), true, "empty fixed cgroup proves historical incarnations are dead");
    assert.equal(units.confirmDead("alice", 7), true, "current durable incarnation may use empty fixed-cgroup evidence");
    assert.equal(units.confirmDead("alice", 8), false, "future incarnation must never borrow current death evidence");

    const unbound = new UnitsModule("demo", values, root);
    fakeObservation(unbound);
    assert.equal(unbound.confirmDead("alice", 7), false, "missing durable incarnation binding must fail closed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RUN-001: authoritative incarnation binding replaces a stale constructor reader", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-death-bind-"));
  try {
    const values = {
      node: process.execPath,
      libdir: "/usr/lib/oma",
      state: root,
      society: "demo",
      agent: "",
    };
    const units = new UnitsModule("demo", values, root, () => 99);
    fakeObservation(units);
    assert.equal(units.confirmDead("alice", 4), true);
    units.bindIncarnationReader(() => 3);
    assert.equal(units.confirmDead("alice", 3), true);
    assert.equal(
      units.confirmDead("alice", 4),
      false,
      "lifecycle/store binding must override an older reader instead of borrowing future death proof",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("VIEW-003: bounded UTF-8 log prefix never exceeds byte limit", () => {
  const exact = boundedLogOutput(Buffer.from("abc"), 3);
  assert.deepEqual(exact, { text: "abc", truncated: false });

  const multi = boundedLogOutput(Buffer.from("가나다라마바사", "utf8"), 8);
  assert.equal(multi.truncated, true);
  assert.ok(Buffer.byteLength(multi.text, "utf8") <= 8);

  const forced = boundedLogOutput(Buffer.from("short"), 32, true);
  assert.equal(forced.truncated, true);
});

test("VIEW-003: journal stdout overflow returns bounded text with truncated=true", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-log-bound-"));
  const fakeJournal = join(root, "journalctl");
  const previousPath = process.env.PATH;
  try {
    writeFileSync(
      fakeJournal,
      "#!/usr/bin/env node\nprocess.stdout.write(Buffer.alloc(4096, 0x61));\n",
      "utf8",
    );
    chmodSync(fakeJournal, 0o755);
    process.env.PATH = `${root}:${previousPath ?? ""}`;

    const limits: ProtocolLimits = {
      frameBytes: 1024,
      mailBodyBytes: 1024,
      subjectBytes: 128,
      addresses: 8,
      replyReferences: 8,
      contextFiles: 8,
      contextBytes: 1024,
      bundleBytes: 1024,
      logBytes: 64,
      batchMaxMessages: 4,
      idleStreamSeconds: 1,
      receiptWaitSeconds: 1,
    };
    const broker = Object.create(Broker.prototype) as Broker;
    Object.assign(broker, {
      paths: { stateRoot: root, runRoot: root, society: "demo" },
      limits,
    });
    const readLogs = Reflect.get(broker, "readLogs") as (
      agent: string,
      sinceSeconds: number,
    ) => Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
    const result = await readLogs.call(broker, "alice", 1);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.text, "utf8") <= limits.logBytes);
    assert.ok(result.text.length > 0);
    assert.ok(Number.isSafeInteger(result.observedAtMs));
  } finally {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
