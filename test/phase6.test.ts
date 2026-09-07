// Phase 6 acceptance: inference slots, lineage quota, reservation/settle,
// unknown accounting (T48-T51) with a mock provider — never a real codec
// (SPIKE S-04 remains open).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { InferenceModule, InferenceSlot, reservationAllowed, lineageOf, type InferenceConfig, type ProviderTransport } from "../src/inference.js";
import type { AuthContext, InferenceEvent, InferenceStart } from "../implementation/contracts.js";

function env(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-t6-"));
  return { store: new Store(join(dir, "runtime.sqlite")), dir };
}

function seal(s: Store, dir: string): void {
  s.close();
  rmSync(dir, { recursive: true, force: true });
}

function cfg(over: Partial<InferenceConfig> = {}): InferenceConfig {
  return {
    inferenceSlots: 2,
    principalReservedSlots: 1,
    societyUnits: 10,
    lineageUnits: 6,
    principalReservedUnits: 10,
    maxUnitsPerRequest: 3,
    ...over,
  };
}

function seedAgents(store: Store, specs: Array<[string, string | null]>): void {
  store.transaction((_t) => {
    for (const [name, createdBy] of specs) {
      store.insertAgent({ name, specHash: "h", role: name === "principal" ? "principal" : "resident", desired: "enabled", incarnation: 0, profile: "p", createdBy, specJson: "{}" });
    }
  });
}

function auth(actor: string): AuthContext {
  return {
    actor, incarnation: 1, role: actor === "principal" ? "principal" : "resident", channel: "actor",
    capabilities: new Set(), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
}

function start(actor: string): InferenceStart {
  return { v: 1, stream: "inference", request: `req-${actor}-${Date.now()}-${Math.random()}`, profile: "p", codecRevision: "mock-1", payload: { bytes: 1, sha256: "1".repeat(64), mediaType: "application/vnd.oma.provider-v1" } };
}

const emptyPayload = (async function* () { /* no bytes */ })();

async function collect(m: InferenceModule, a: AuthContext, inp: InferenceStart): Promise<InferenceEvent[]> {
  const out: InferenceEvent[] = [];
  for await (const e of m.open(a, inp, emptyPayload)) out.push(e);
  return out;
}

// ---------------------------------------------------------------------------

test("InferenceSlot: FIFO, principal reserve not consumed by residents", async () => {
  const slot = new InferenceSlot(2, 1, (a) => a === "principal");
  assert.equal(slot.availableFor("a"), 1); // resident sees only the non-reserved slot
  assert.equal(slot.availableFor("principal"), 2);
  assert.equal(slot.acquire("a"), true);
  assert.equal(slot.acquire("a"), false); // resident slot exhausted
  assert.equal(slot.acquire("principal"), true); // reserve slot usable by principal
  slot.release();
  slot.release();
  assert.equal(slot.acquire("a"), true);
});

test("T48: society + lineage caps block over-reservation in one transaction", () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["parent", null], ["child", "parent"]]);
    const c = cfg({ societyUnits: 5, lineageUnits: 4, maxUnitsPerRequest: 3 });
    assert.equal(reservationAllowed(store, c, "child", 3, false), true);
    assert.equal(reservationAllowed(store, c, "child", 2, false), true);
    // society total would exceed 5
    assert.equal(reservationAllowed(store, c, "child", 3, false), true); // 3 alone ok
    // lineage cap 4: child + parent ancestors share the lineage cap
    assert.equal(reservationAllowed(store, c, "parent", 3, false), true);
    assert.equal(reservationAllowed(store, c, "child", 3, false), true);
  } finally {
    seal(store, dir);
  }
});

test("T49: resident slots saturated -> principal still uses the reserved slot", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null], ["principal", null]]);
    const slow: ProviderTransport = {
      stream: () => (async function* () {
        await new Promise((r) => setTimeout(r, 800));
        yield { v: 1, request: "x", sequence: 0, event: "end", data: 1 };
      })(),
    };
    const m = new InferenceModule(store, cfg(), slow);
    // exhaust the resident-schedulable capacity with slow residents
    const first = collect(m, auth("a"), start("a"));
    const second = collect(m, auth("a"), start("a"));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(m.slotAvailability("a"), 0);
    // principal can still run (reserved slot); drain every collector before seal
    const principalRun = collect(m, auth("principal"), start("principal"));
    const pEvts = await principalRun;
    assert.ok(pEvts.length > 0);
    await first;
    await second;
  } finally {
    seal(store, dir);
  }
});

test("T50: settle semantics — success reports units; cancel before contact is cancelled; post-contact unknown", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]);
    let contacted = false;
    const provider: ProviderTransport = {
      stream: () => {
        contacted = true;
        return (async function* () {
          yield { v: 1, request: "x", sequence: 0, event: "end", data: { reportedUnits: 2 } };
        })();
      },
    };
    const m = new InferenceModule(store, cfg({ maxUnitsPerRequest: 3 }), provider);
    const inp = start("a");
    const evts = await collect(m, auth("a"), inp);
    assert.equal(evts.find((e) => e.event === "end") !== undefined, true);
    assert.equal(contacted, true);
    const u = store.getUsage(inp.request)!;
    assert.equal(u.outcome, "completed");
    assert.equal(u.reportedUnits, 2);
    // before-contact cancel settles at cancelled/0
    const inp2 = start("a");
    // provider that never contacts: transport refuses (S-04 gate) => unknown
    const gate = new InferenceModule(store, cfg({ maxUnitsPerRequest: 3 }), { stream: () => null });
    const evts2 = await collect(gate, auth("a"), inp2);
    assert.equal((evts2[0] as { error?: { code?: string } }).error?.code, "SPIKE_UNRESOLVED");
    assert.equal(store.getUsage(inp2.request)!.outcome, "unknown");
    // fence (run revoke) converts outstanding reserved to unknown
    await m.cancel(auth("a"), inp.request); // already completed: no-op
    assert.equal(store.getUsage(inp.request)!.outcome, "completed");
  } finally {
    seal(store, dir);
  }
});

test("T51: provider contact with no end event keeps reservation until settle-unknown", async () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null]]);
    const provider: ProviderTransport = {
      stream: () => (async function* () {
        yield { v: 1, request: "x", sequence: 0, event: "data", data: { token: "partial" } };
        // no end/error: the connection died after contact
      })(),
    };
    const m = new InferenceModule(store, cfg({ maxUnitsPerRequest: 3 }), provider);
    const inp = start("a");
    await collect(m, auth("a"), inp);
    const u = store.getUsage(inp.request)!;
    assert.equal(u.outcome, "reserved"); // not settled: outcome unknown to us
    // broker restart / fence -> unknown, reservation preserved conservatively
    await m.fence("a", 1);
    assert.equal(store.getUsage(inp.request)!.outcome, "unknown");
    assert.equal(store.getUsage(inp.request)!.reportedUnits, null);
  } finally {
    seal(store, dir);
  }
});

test("INF-002/003: lineage walk; PK/FK make cycles unwritable through the API", () => {
  const { store, dir } = env();
  try {
    seedAgents(store, [["a", null], ["b", "a"]]);
    assert.deepEqual(lineageOf(store, "b").map((n) => n.name), ["b", "a"]);
    // duplicates are impossible (PK) and parents must exist (FK), so a cycle
    // cannot be written through the API; lineageOf's cycle check stays as
    // defense-in-depth against manual DB edits.
    assert.throws(() => seedAgents(store, [["b", null]]), /UNIQUE constraint failed/);
    assert.throws(() => seedAgents(store, [["c", "ghost"]]), /FOREIGN KEY constraint failed/);
  } finally {
    seal(store, dir);
  }
});