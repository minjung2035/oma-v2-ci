// Domain/mock inference acceptance only. No real provider codec or credentials; S-04 stays open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { uuidV4 } from "../src/ids.js";
import { sha256Hex } from "../src/hash.js";
import { InferenceModule, InferenceSlot, reservationAllowed, lineageOf, type InferenceConfig, type ProviderTransport } from "../src/inference.js";
import type { AuthContext, InferenceEvent, InferenceStart } from "../implementation/contracts.js";

function env(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-t6-"));
  return { store: new Store(join(dir, "runtime.sqlite")), dir };
}
function seal(store: Store, dir: string): void { store.close(); rmSync(dir, { recursive: true, force: true }); }
function cfg(overrides: Partial<InferenceConfig> = {}): InferenceConfig {
  return { inferenceSlots: 2, principalReservedSlots: 1, societyUnits: 10, lineageUnits: 6,
    principalReservedUnits: 1, maxUnitsPerRequest: 3, ...overrides };
}
function seedAgents(store: Store, specs: Array<[string, string | null]>): void {
  store.transaction(tx => {
    for (const [name, createdBy] of specs) tx.insertAgent(makeValidAgent(name, { createdBy, capabilities: [] }));
  });
}
function auth(actor: string): AuthContext {
  return { actor, incarnation: actor === "principal" ? 0 : 1, role: actor === "principal" ? "principal" : "resident",
    channel: "actor", capabilities: new Set(), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null } };
}
const payloadBytes = Buffer.from("x");
const mockPayload: AsyncIterable<Uint8Array> = { async *[Symbol.asyncIterator]() { yield payloadBytes; } };
function start(_actor: string): InferenceStart {
  return { v: 1, stream: "inference", request: uuidV4(), profile: "md", codecRevision: "mock-1",
    payload: { bytes: payloadBytes.length, sha256: sha256Hex(payloadBytes), mediaType: "application/vnd.oma.provider-v1" } };
}
async function collect(module: InferenceModule, context: AuthContext, input: InferenceStart): Promise<InferenceEvent[]> {
  const events: InferenceEvent[] = [];
  for await (const event of module.open(context, input, mockPayload)) events.push(event);
  return events;
}

test("InferenceSlot: FIFO, principal reserve not consumed by residents", () => {
  const slot = new InferenceSlot(2, 1, actor => actor === "principal");
  assert.equal(slot.availableFor("a"), 1);
  assert.equal(slot.availableFor("principal"), 2);
  const resident = slot.acquire("a"); assert.ok(resident);
  assert.equal(slot.acquire("a"), null);
  const principal = slot.acquire("principal"); assert.ok(principal);
  resident.release(); principal.release();
  const again = slot.acquire("a"); assert.ok(again); again.release();
});

test("INF-003: unrelated lineages share society cap and residents preserve Principal budget", () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null], ["b", null], ["principal", null]]);
    const limits = cfg({ societyUnits: 10, lineageUnits: 10, principalReservedUnits: 2 });
    const used = uuidV4();
    store.transaction(tx => tx.reserveUsage({ requestId: used, actor: "a", incarnation: 1, profile: "md", pricingRevision: "mock-1", reservedUnits: 8 }));
    assert.equal(reservationAllowed(store, limits, "b", 1, false), false);
    assert.equal(reservationAllowed(store, limits, "principal", 2, true), true);
    assert.equal(reservationAllowed(store, limits, "principal", 3, true), false);
    store.transaction(tx => tx.settleUsage(used, "completed", 3, null));
    assert.equal(reservationAllowed(store, limits, "b", 5, false), true);
    assert.equal(reservationAllowed(store, limits, "b", 6, false), false);
    const terminal = store.getUsage(used);
    assert.throws(() => store.transaction(tx => tx.settleUsage(used, "cancelled", 0, null)));
    assert.deepEqual(store.getUsage(used), terminal);
    const cancelled = uuidV4();
    store.transaction(tx => tx.reserveUsage({ requestId: cancelled, actor: "b", incarnation: 1, profile: "md", pricingRevision: "mock-1", reservedUnits: 5 }));
    assert.equal(reservationAllowed(store, limits, "b", 1, false), false);
    store.transaction(tx => tx.settleUsage(cancelled, "cancelled", 0, null));
    assert.equal(reservationAllowed(store, limits, "b", 5, false), true);
    assert.equal(reservationAllowed(store, limits, "b", Number.NaN, false), false);
  } finally { seal(store, dir); }
});

test("INF-003: budget reads occur inside the reservation transaction", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]);
    const transaction = store.transaction.bind(store); const usageRows = store.usageRows.bind(store);
    let inTransaction = false; let reads = 0;
    store.transaction = callback => transaction(token => {
      inTransaction = true;
      try { return callback(token); } finally { inTransaction = false; }
    });
    store.usageRows = () => { assert.equal(inTransaction, true); reads++; return usageRows(); };
    await collect(new InferenceModule(store, cfg(), { stream: () => null }), auth("a"), start("a"));
    assert.ok(reads > 0); // A shared ledger snapshot replaces repeated independent sum reads.
  } finally { seal(store, dir); }
});

test("INF-004: unconfirmed provider cost never settles as zero", async () => {
  for (const data of [undefined, null, {}, { reportedUnits: -1 }, { reportedUnits: 0.5 }, { reportedUnits: Number.MAX_SAFE_INTEGER + 1 }]) {
    const { store, dir } = env();
    try {
      seedAgents(store, [["a", null]]);
      const module = new InferenceModule(store, cfg(), { stream: () => (async function* () {
        yield { v: 1 as const, request: "mock", sequence: 0, event: "end" as const, ...(data === undefined ? {} : { data }) };
      })() });
      const input = start("a"); await collect(module, auth("a"), input);
      assert.equal(store.getUsage(input.request)!.outcome, "unknown");
      assert.equal(store.getUsage(input.request)!.reportedUnits, null);
      assert.equal(module.slotAvailability("principal"), 2);
    } finally { seal(store, dir); }
  }
});

test("INF-004: cancellation after contact retains unknown cost", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]);
    const module = new InferenceModule(store, cfg(), { stream: () => (async function* () {
      yield { v: 1 as const, request: "mock", sequence: 0, event: "data" as const, data: "partial" };
    })() });
    const input = start("a"); const stream = module.open(auth("a"), input, mockPayload)[Symbol.asyncIterator]();
    await stream.next(); await module.cancel(auth("a"), input.request);
    assert.equal(store.getUsage(input.request)!.outcome, "unknown");
    assert.equal(store.getUsage(input.request)!.reportedUnits, null);
    await stream.return!(undefined);
    assert.equal(module.slotAvailability("principal"), 2);
  } finally { seal(store, dir); }
});

test("INF-006: fencing cancels owned waiters and transport signals, not another incarnation", { timeout: 2000 }, async () => {
  const { store, dir } = env();
  let signal: AbortSignal | undefined;
  const module = new InferenceModule(store, cfg({ inferenceSlots: 1, principalReservedSlots: 0 }), {
    stream: (_id, _profile, _payload, abort) => { signal = abort; return (async function* () {
      yield { v: 1 as const, request: "mock", sequence: 0, event: "data" as const };
      if (!abort.aborted) await new Promise<void>(resolve => abort.addEventListener("abort", () => resolve(), { once: true }));
    })(); },
  });
  let running: AsyncIterator<InferenceEvent> | undefined;
  try {
    seedAgents(store, [["a", null], ["b", null]]);
    running = module.open(auth("a"), start("a"), mockPayload)[Symbol.asyncIterator](); await running.next();
    const input = start("b"); let settled = false;
    const pending = collect(module, auth("b"), input).then(events => { settled = true; return events; });
    assert.equal((await collect(module, auth("b"), input))[0]!.error?.code, "REQUEST_KEY_REUSED");
    await module.fence("b", 0); assert.equal(settled, false);
    await module.fence("b", 1);
    assert.equal((await pending)[0]!.error?.code, "DEADLINE_EXCEEDED");
    assert.equal(store.getUsage(input.request), null);
    assert.equal((await collect(module, auth("b"), start("b")))[0]!.error?.code, "STALE_RUN");
    assert.equal(signal?.aborted, false);
    const ending = running.next(); await module.fence("a", 1);
    assert.equal(signal?.aborted, true); assert.equal((await ending).done, true);
    assert.equal(module.slotAvailability("principal"), 1);
  } finally {
    await module.fence("a", 1); await module.fence("b", 1); await running?.return?.(); seal(store, dir);
  }
});

test("INF-001/003: reservation rechecks current incarnation and frozen model", async () => {
  const { store, dir } = env(); let contacts = 0;
  const module = new InferenceModule(store, cfg(), { stream: () => { contacts++; return null; } });
  try {
    seedAgents(store, [["a", null]]);
    const stale = start("a"); const pending = collect(module, auth("a"), stale);
    store.transaction(tx => tx.updateAgent({ name: "a", incarnation: 2 }));
    await assert.rejects(pending, { code: "STALE_RUN" }); assert.equal(store.getUsage(stale.request), null);
    const forged = { ...start("a"), profile: "unconfigured-model" };
    await assert.rejects(collect(module, { ...auth("a"), incarnation: 2 }, forged), { code: "UNSUPPORTED_PROFILE" });
    assert.equal(store.getUsage(forged.request), null); assert.equal(contacts, 0);
  } finally { seal(store, dir); }
});

test("INF-005: a reservation winner appearing during slot wait is not resubmitted or settled by the loser", async () => {
  const { store, dir } = env(); let contacts = 0;
  const module = new InferenceModule(store, cfg(), { stream: () => { contacts++; return null; } });
  try {
    seedAgents(store, [["a", null]]);
    const input = start("a"); const pending = collect(module, auth("a"), input);
    store.transaction(tx => tx.reserveUsage({ requestId: input.request, actor: "a", incarnation: 1, profile: "md", pricingRevision: "mock-1", reservedUnits: 3 }));
    assert.equal((await pending)[0]!.error?.code, "REQUEST_KEY_REUSED");
    assert.equal(store.getUsage(input.request)!.outcome, "reserved");
    assert.equal(contacts, 0); assert.equal(module.slotAvailability("principal"), 2);
  } finally { seal(store, dir); }
});

test("T48: society + lineage caps block over-reservation in one transaction", () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["parent", null], ["child", "parent"]]);
    const limits = cfg({ societyUnits: 5, lineageUnits: 4, maxUnitsPerRequest: 3 });
    assert.equal(reservationAllowed(store, limits, "child", 3, false), true);
    assert.equal(reservationAllowed(store, limits, "child", 2, false), true);
    assert.equal(reservationAllowed(store, limits, "parent", 3, false), true);
    store.transaction(tx => {
      assert.equal(reservationAllowed(store, limits, "child", 3, false), true);
      tx.reserveUsage({ requestId: uuidV4(), actor: "child", incarnation: 1, profile: "md", pricingRevision: "mock-1", reservedUnits: 3 });
      assert.equal(reservationAllowed(store, limits, "parent", 2, false), false);
      assert.equal(reservationAllowed(store, limits, "child", 2, false), false);
    });
  } finally { seal(store, dir); }
});

test("T49: resident slots saturated -> principal still uses the reserved slot", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null], ["principal", null]]);
    const slow: ProviderTransport = { stream: () => (async function* () {
      await new Promise(resolve => setTimeout(resolve, 800));
      yield { v: 1 as const, request: "x", sequence: 0, event: "end" as const, data: 1 };
    })() };
    const module = new InferenceModule(store, cfg(), slow);
    const first = collect(module, auth("a"), start("a"));
    const second = collect(module, auth("a"), start("a"));
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(module.slotAvailability("a"), 0);
    const principal = await collect(module, auth("principal"), start("principal")); assert.ok(principal.length > 0);
    await first; await second;
  } finally { seal(store, dir); }
});

test("T50: settle semantics — success reports units; cancel before contact is cancelled; post-contact unknown", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]); let contacted = false;
    const module = new InferenceModule(store, cfg(), { stream: () => {
      contacted = true;
      return (async function* () { yield { v: 1 as const, request: "x", sequence: 0, event: "end" as const, data: { reportedUnits: 2 } }; })();
    } });
    const input = start("a"); const events = await collect(module, auth("a"), input);
    assert.equal(events.some(event => event.event === "end"), true); assert.equal(contacted, true);
    assert.equal(store.getUsage(input.request)!.outcome, "completed"); assert.equal(store.getUsage(input.request)!.reportedUnits, 2);
    const noContact = start("a"); const gate = new InferenceModule(store, cfg(), { stream: () => null });
    assert.equal((await collect(gate, auth("a"), noContact))[0]!.error?.code, "SPIKE_UNRESOLVED");
    assert.equal(store.getUsage(noContact.request)!.outcome, "cancelled"); assert.equal(store.getUsage(noContact.request)!.reportedUnits, 0);
    await module.cancel(auth("a"), input.request); assert.equal(store.getUsage(input.request)!.outcome, "completed");
  } finally { seal(store, dir); }
});

test("T51: provider contact with no end event keeps reservation until settle-unknown", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]);
    const module = new InferenceModule(store, cfg(), { stream: () => (async function* () {
      yield { v: 1 as const, request: "x", sequence: 0, event: "data" as const, data: { token: "partial" } };
    })() });
    const input = start("a"); await collect(module, auth("a"), input);
    assert.equal(store.getUsage(input.request)!.outcome, "unknown");
    await module.fence("a", 1); assert.equal(store.getUsage(input.request)!.outcome, "unknown");
    assert.equal(store.getUsage(input.request)!.reportedUnits, null);
    assert.equal(store.getUsage(input.request)!.reservedUnits, 3);
  } finally { seal(store, dir); }
});

test("INF-002/003: lineage walk; PK/FK make cycles unwritable through the API", () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null], ["b", "a"]]);
    assert.deepEqual(lineageOf(store, "b").map(node => node.name), ["b", "a"]);
    assert.throws(() => seedAgents(store, [["b", null]]), /UNIQUE constraint failed/);
    assert.throws(() => seedAgents(store, [["c", "ghost"]]), /FOREIGN KEY constraint failed/);
  } finally { seal(store, dir); }
});
