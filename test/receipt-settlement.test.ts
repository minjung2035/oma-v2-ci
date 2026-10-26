/** V06A/V06B: the two settlement entries over the common receipt observation.
 * Live completion keeps its peer, lease and incarnation fencing; the broker's
 * recovery settles one batch from its own exact receipt, only under the run
 * owner's quiescence, and never through an RPC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { agentRootPathAt } from "@oma/domain/paths";
import { RunRegistry } from "@oma/broker/run-registry";
import type { ExecutionScopePin } from "@oma/contracts/runtime";
type Population = ReturnType<ExecutionScopePin["population"]>;
import { PeerAuthenticator } from "@oma/broker/peer-authenticator";
import { processIdentity } from "@oma/broker/process-ancestry";
import { type BoundPeer } from "@oma/broker/ports";
import { InternalDispatcher, projectInternalPeers } from "@oma/broker/internal-dispatcher";
import { createInternalDispatchDataPorts } from "#oma-test/app/broker/composition";
import type { FeatureExecution } from "./fixtures/execution.js";
import { ALL_CAPS, storedSpec } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { boundaryOf, completeSession, evidenceOf, preparedFixture, type ReceiptFixture } from "./fixtures/delivery-receipt.js";

function published(f: ReceiptFixture): string {
  const session = completeSession(f.root, f.batch);
  publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
  return session;
}

/** Scripted scope observations constrain settlement policy only. These do not
 * qualify physical death; native-process-scope exercises the real kernel. */
function pin(fd: number) {
  let population: Population = "populated";
  const value: ExecutionScopePin = { identity: Object.freeze({ dev: 1n, ino: BigInt(fd) }),
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
  // P0-2: what each observation means is the receipt decision's; the outcome
  // names the decision (settle, present, hold with the spec's error).
  const cases: ReadonlyArray<readonly [string, (f: ReceiptFixture) => void, string, string | null]> = [
    ["verified", f => { published(f); }, "settled", null],
    ["absent", () => undefined, "present", null],
    ["unavailable", f => { published(f); chmodSync(f.receipt, 0o000); }, "hold", "BROKER_UNAVAILABLE"],
    // A receipt whose attempt is not one of the batch's (P0V-107: the session
    // file it names is not observed again, so its absence is no conflict).
    ["conflicting", f => { published(f); const raw = JSON.parse(readFileSync(f.receipt, "utf8")) as Record<string, unknown>;
      writeFileSync(f.receipt, `${JSON.stringify({ ...raw, incarnation: f.batch.incarnation + 5 })}\n`, { mode: 0o600 }); }, "hold", "BATCH_CONFLICT"],
  ];
  for (const [name, arrange, expected, code] of cases) {
    const f = await preparedFixture();
    try {
      arrange(f);
      const { registry } = openingSuccessor(1);
      const outcome = f.mail.settleFromReceipt(registry.settlementQuiescence("alice"), f.batch.id);
      assert.equal(outcome.kind, expected, name);
      assert.equal(outcome.kind === "hold" ? outcome.error.code : null, code, name);
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
  return { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), inheritedRunner: { actor: "alice", invocationId: OLD }, alive: () => true, sameSender: () => false,
    retainForExecution: () => () => undefined, releaseConnection: () => undefined };
}
/** The production internal dispatcher, peer authenticator and run registry. */
function liveEndpoint(f: ReceiptFixture, registry: RunRegistry, invocation: () => string) {
  const self = processIdentity(process.pid); assert.ok(self);
  // This endpoint receives only the expired OLD private grant. Even an alive
  // local process cannot promote it into the successor's authority.
  const units = { observe: () => ({ activeState: "active", invocationId: invocation(), scope: "/next" }),
    scopeRoot: () => self, runnerAlive: () => true } as unknown as FeatureExecution;
  const peers = new PeerAuthenticator(f.store, units, registry, "demo", () => undefined,
    () => { throw new Error("receipt context checks do not acquire a connection"); });
  const dispatcher = new InternalDispatcher({ ...createInternalDispatchDataPorts(f.store, f.mail, f.root), peers: projectInternalPeers(peers),
    isDraining: () => false, assertAdmission: () => undefined,
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
    assert.equal(stale.error?.code, "AUTH_FAILED", "an expired private grant is refused before live lease lookup");
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
