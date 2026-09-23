/** V06A/V06B: the two settlement entries over the common receipt observation.
 * Live completion keeps its peer, lease and incarnation fencing; the broker's
 * recovery settles one batch from its own exact receipt, only under the run
 * owner's quiescence, and never through an RPC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { AuthContext } from "../implementation/contracts.js";
import { publishDeliveryReceipt } from "../src/storage/delivery-receipt.js";
import { agentRootPathAt, runnerSessionDirPathAt } from "../src/storage/paths.js";
import { RunRegistry, type CgroupPin, type Population } from "../src/runtime/run-registry.js";
import { PeerAuthenticator, peerCgroup, type BoundPeer } from "../src/broker/peer-authenticator.js";
import { InternalDispatcher } from "../src/broker/internal-dispatcher.js";
import { createInternalDispatchPorts } from "../src/broker/composition.js";
import type { UnitsModule } from "../src/units.js";
import { ALL_CAPS, storedSpec } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { boundaryOf, completeSession, evidenceOf, preparedFixture, type ReceiptFixture } from "./fixtures/delivery-receipt.js";

function published(f: ReceiptFixture): string {
  const session = completeSession(f.root, f.batch);
  publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
  return session;
}

/** A native cgroup pin stand-in; the registry and its fencing are production. */
function pin(fd: number) {
  let population: Population = "populated";
  const value: CgroupPin = { fd, identity: Object.freeze({ dev: 1n, ino: BigInt(fd) }),
    population: () => population, matches: () => true, close: () => undefined };
  return { value, empty: () => { population = "empty"; } };
}
const OLD = "1".repeat(32);
const NEXT = "2".repeat(32);
/** The previous run of `alice` ended without completing; its successor is opening. */
function openingSuccessor(incarnation: number) {
  const old = pin(10); const next = pin(11);
  const registry = new RunRegistry(path => path === "/old" ? old.value : next.value);
  const previous = registry.begin("alice", incarnation, OLD, "/old");
  previous.publish({ socketHostPath: "/run/old.sock", done: () => undefined });
  previous.revoke(); old.empty();
  const opening = registry.begin("alice", incarnation + 1, NEXT, "/next");
  return { registry, opening };
}
function files(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path); else out.push(`${path}:${statSync(path).size}`);
    }
  };
  walk(root);
  return out;
}

test("V06A: recovery settles only a verified receipt; absent, unavailable and conflicting settle nothing", async () => {
  const cases: ReadonlyArray<readonly [string, (f: ReceiptFixture) => void, string]> = [
    ["verified", f => { published(f); }, "settled"],
    ["absent", () => undefined, "absent"],
    ["unavailable", f => { published(f); chmodSync(f.receipt, 0o000); }, "unavailable"],
    ["conflicting", f => { published(f); unlinkSync(join(runnerSessionDirPathAt(f.root, "alice"), "delivery.jsonl")); }, "conflicting"],
  ];
  for (const [name, arrange, expected] of cases) {
    const f = await preparedFixture();
    try {
      arrange(f);
      const { registry } = openingSuccessor(1);
      const outcome = f.mail.settleFromReceipt(registry.settlementQuiescence("alice"), f.batch.id);
      assert.equal(outcome.kind, expected, name);
      assert.equal(f.store.getBatch(f.batch.id)?.state, expected === "settled" ? "completed" : "prepared", name);
      assert.equal(f.presented(), expected === "settled" ? 1 : 0, name);
      registry.close();
    } finally { f.close(); }
  }
});

test("V06A: a completed batch keeps its first terminal fact under recovery", async () => {
  const f = await preparedFixture();
  try {
    const session = published(f);
    await f.mail.complete(f.auth, evidenceOf(f.root, f.batch, session));
    const first = f.store.getBatch(f.batch.id);
    const { registry } = openingSuccessor(1);
    assert.deepEqual(f.mail.settleFromReceipt(registry.settlementQuiescence("alice"), f.batch.id), { kind: "completed" });
    assert.deepEqual(f.store.getBatch(f.batch.id), first);
    registry.close();
  } finally { f.close(); }
});

function peerOf(): BoundPeer {
  return { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), alive: () => true,
    retainForExecution: () => () => undefined, releaseConnection: () => undefined };
}
/** The production internal dispatcher, peer authenticator and run registry. */
function liveEndpoint(f: ReceiptFixture, registry: RunRegistry, invocation: () => string) {
  const cgroup = peerCgroup(process.pid);
  assert.ok(cgroup, "the test process has no observable cgroup");
  const units = { observe: () => ({ activeState: "active", invocationId: invocation(), cgroup }),
    unitCgroup: () => cgroup } as unknown as UnitsModule;
  const peers = new PeerAuthenticator(f.store, units, registry, "demo", () => undefined);
  const dispatcher = new InternalDispatcher({ ...createInternalDispatchPorts(f.store, f.mail, null, f.root, peers),
    isDraining: () => false, assertAdmission: () => undefined, admitResource: () => () => undefined,
    failureAnswer: (id, error) => ({ v: 1, id, ok: false, error: { code: (error as { code?: string }).code } }),
    refreshViews: () => undefined, openRun: () => { throw new Error("no run is opened here"); } });
  return (params: Record<string, unknown>) =>
    dispatcher.dispatch({ v: 1, id: "complete", method: "batch.complete", params }, peerOf(), null, "runner") as
      Promise<{ ok: boolean; error?: { code?: string } }>;
}

test("V06B local: a stale runner's live completion stays refused while the broker settles its exact receipt", async () => {
  const f = await preparedFixture();
  try {
    let invocation = OLD;
    const old = pin(10); const next = pin(11);
    const registry = new RunRegistry(path => path === "/old" ? old.value : next.value);
    registry.begin("alice", 1, OLD, "/old").publish({ socketHostPath: "/run/old.sock", done: () => undefined });
    const complete = liveEndpoint(f, registry, () => invocation);
    const session = published(f);
    // The old run dies after its receipt became durable, before it completed.
    registry.get("alice")!.revoke(); old.empty(); invocation = NEXT;
    registry.begin("alice", 2, NEXT, "/next");
    const stale = await complete({ ...evidenceOf(f.root, f.batch, session) });
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.code, "STALE_RUN");
    const flagged = await complete({ ...evidenceOf(f.root, f.batch, session), recovery: true });
    assert.equal(flagged.ok, false, "no request field turns live completion into recovery");
    assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
    const before = files(agentRootPathAt(f.root, "alice"));
    const receipt = readFileSync(f.receipt);
    const outcome = f.mail.settleFromReceipt(registry.settlementQuiescence("alice"), f.batch.id);
    assert.equal(outcome.kind, "settled");
    assert.equal(f.store.getBatch(f.batch.id)?.state, "completed");
    assert.equal(f.store.getBatch(f.batch.id)?.sessionPath, session);
    assert.equal(f.presented(), 1);
    assert.deepEqual(files(agentRootPathAt(f.root, "alice")), before, "settlement runs no engine and writes no file");
    assert.deepEqual(readFileSync(f.receipt), receipt);
    registry.close();
  } finally { f.close(); }
});

test("V06B local: settlement authority ends with the opening run and names one actor and incarnation", async () => {
  const f = await preparedFixture();
  try {
    published(f);
    const { registry, opening } = openingSuccessor(1);
    const authority = registry.settlementQuiescence("alice");
    opening.publish({ socketHostPath: "/run/next.sock", done: () => undefined });
    assert.throws(() => f.mail.settleFromReceipt(authority, f.batch.id), { code: "STALE_RUN" });
    assert.throws(() => registry.settlementQuiescence("alice"), { code: "STALE_RUN" });
    assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
    registry.close();
    const other = openingSuccessor(2);
    assert.throws(() => f.mail.settleFromReceipt(other.registry.settlementQuiescence("alice"), f.batch.id), { code: "BATCH_CONFLICT" });
    assert.equal(f.store.getBatch(f.batch.id)?.state, "prepared");
    other.registry.close();
  } finally { f.close(); }
});

test("V06B local: recovery for one actor cannot settle another actor's batch", async () => {
  const f = await preparedFixture();
  try {
    f.store.transaction(() => f.store.insertAgent({ name: "bob", ...storedSpec(ALL_CAPS, "p", "bob"), role: "resident",
      desired: "enabled", incarnation: 1, profile: "p", createdBy: null }));
    const bob: AuthContext = { ...f.auth, actor: "bob" };
    await f.mail.send(f.auth, "to-bob", { to: ["bob"], subject: "hello", kind: "message", body: "body" });
    const batch = await f.mail.prepare(bob);
    assert.ok(batch);
    const session = completeSession(f.root, batch);
    publishDeliveryReceipt(f.root, batch, boundaryOf(batch, session), TEST_VIEW_LIMITS.frameBytes);
    const { registry } = openingSuccessor(1);
    assert.throws(() => f.mail.settleFromReceipt(registry.settlementQuiescence("alice"), batch.id), { code: "BATCH_CONFLICT" });
    assert.equal(f.store.getBatch(batch.id)?.state, "prepared");
    registry.close();
  } finally { f.close(); }
});
