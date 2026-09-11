import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Broker, boundedLogOutput } from "../src/broker.js";
import { UnitsModule } from "../src/units.js";
import type { ProtocolLimits, UnitObservation } from "../implementation/contracts.js";

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

test("RUN-001: confirmDead proves only the durable current incarnation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-death-proof-"));
  try {
    const values = {
      node: process.execPath,
      libdir: "/usr/lib/oma",
      state: root,
      society: "demo",
      agent: "",
    };
    const units = new UnitsModule("demo", values, root, {}, () => 7);
    fakeObservation(units);
    assert.equal(units.confirmDead("alice", 6), false, "old incarnation must never borrow current unit death evidence");
    assert.equal(units.confirmDead("alice", 7), true, "matching durable incarnation may use empty fixed-unit evidence");

    const unbound = new UnitsModule("demo", values, root);
    fakeObservation(unbound);
    assert.equal(unbound.confirmDead("alice", 7), false, "missing durable incarnation binding must fail closed");
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
