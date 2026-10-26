import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V23A: real Store/Broker/read/mutation paths with a delayed observation
 * port. This models coordination cost, not native OS performance or a gate.
 * Physical scope/authentication tests use the real kernel separately. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { decodeStatusView, statusViewPath } from "@oma/protocol/status-view";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const AGENTS = 64;
const observationCostMs = (actors: number): number => 6.9 + 1.61 * actors;
interface Meter { commands: number; inFlight: number; maxInFlight: number; syncMs: number }
function modelledUnits(_root: string, meter: Meter, options: { hang?: () => boolean; fail?: () => boolean } = {}): PolicyExecution {
  const execution = new PolicyExecution();
  execution.observeStatus = async actors => {
    meter.commands++; meter.inFlight++; meter.maxInFlight = Math.max(meter.maxInFlight, meter.inFlight);
    const hang = options.hang?.() ?? false;
    try {
      await new Promise(resolve => setTimeout(resolve, hang ? 3_000 : observationCostMs(actors.length)));
      if (options.fail?.()) throw new Error("observation unavailable");
      return new Map(actors.map(actor => [actor, execution.observe(actor)]));
    } finally { meter.inFlight--; }
  };
  return execution;
}

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };

function society(t: TestContext, options: { hang?: () => boolean; fail?: () => boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-v23a-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    for (let i = 2; i < AGENTS; i++) tx.insertAgent(makeValidAgent(`w${i}`, { createdBy: "principal" }));
  });
  const meter: Meter = { commands: 0, inFlight: 0, maxInFlight: 0, syncMs: 0 };
  const units = modelledUnits(root, meter, options);
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const views = new ViewsModule(store, root, "demo", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: root, runRoot: join(root, "run"), society: "demo", hasGoal: goalPublishedAt(root) } });
  t.after(async () => { try { await broker.drainAndClose(); } catch { store.close(); } finally { removeTree(root); } });
  const call = async (request: Record<string, unknown>) => {
    const started = performance.now();
    const answer = await broker.dispatch(auth, request as never, null) as { ok: boolean; result?: any; error?: { code: string } };
    return { answer, ms: performance.now() - started };
  };
  return { root, store, meter, broker, call, units, views };
}

/** The longest the event loop went without running a 1 ms timer while `work` ran. */
async function loopLag<T>(work: () => Promise<T>): Promise<{ value: T; maxLagMs: number }> {
  let maxLagMs = 0; let last = performance.now();
  const probe = setInterval(() => { const now = performance.now(); maxLagMs = Math.max(maxLagMs, now - last - 1); last = now; }, 1);
  try {
    const value = await work();
    await new Promise(resolve => setTimeout(resolve, 5));
    return { value, maxLagMs };
  } finally { clearInterval(probe); }
}
const percentile = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!;

/** Budgets for up to 256 listed agents (the default quota is 8). Reads alone
 * never hold the event loop longer than one projection of the society; with
 * mutations the loop also carries each mutation's own synchronous Store and
 * fsync work (about 20-45 ms for mail.send here), which WP23 does not change.
 * An answer comes within two refreshes. */
const READ_LAG_BUDGET_MS = 50;
const MIXED_LAG_BUDGET_MS = 100;
const ANSWER_BUDGET_MS = 1_000;

test("V23A: concurrent status reads and mutations keep the broker responsive with bounded observation", { timeout: 60_000 }, async t => {
  const s = society(t);
  for (let round = 0; round < Number(process.env.V23A_ROUNDS ?? 0); round++) {
    const probe = await loopLag(() => Promise.all(Array.from({ length: 16 }, (_, i) => s.call({ v: 1, id: `w${i}`, method: "status.get", params: {} }))));
    console.log(`round ${round}: ${Math.round(probe.maxLagMs)} ms`);
  }
  const reads = await loopLag(() => Promise.all(Array.from({ length: 16 }, (_, i) => s.call({ v: 1, id: `r${i}`, method: "status.get", params: {} }))));
  const readCommands = s.meter.commands;
  const mixed = await loopLag(async () => {
    const reads = Array.from({ length: 16 }, (_, i) => s.call({ v: 1, id: `s${i}`, method: "status.get", params: {} }));
    const writes: { answer: { ok: boolean }; ms: number }[] = [];
    for (let i = 0; i < 4; i++) writes.push(await s.call({ v: 1, id: `m${i}`, method: "mail.send", request: `k${i}`,
      params: { to: ["w2"], subject: "load", kind: "message", body: "x" } }));
    return { reads: await Promise.all(reads), writes };
  });
  const readMs = [...reads.value, ...mixed.value.reads].map(read => read.ms);
  console.log(JSON.stringify({ oracle: "V23A", agents: AGENTS, readLagMs: Math.round(reads.maxLagMs), mixedLagMs: Math.round(mixed.maxLagMs),
    readP50Ms: Math.round(percentile(readMs, 0.5)), readP95Ms: Math.round(percentile(readMs, 0.95)),
    writeMaxMs: Math.round(Math.max(...mixed.value.writes.map(write => write.ms))), readBurstCommands: readCommands,
    commands: s.meter.commands, maxInFlight: s.meter.maxInFlight, syncCommandMs: Math.round(s.meter.syncMs) }));
  for (const read of [...reads.value, ...mixed.value.reads]) {
    assert.equal(read.answer.ok, true, JSON.stringify(read.answer));
    assert.equal(read.answer.result.agents.length, AGENTS);
    assert.ok(read.answer.result.agents.every((row: { agent: string; activeState: string | null }) => row.activeState === (row.agent === "principal" ? null : "inactive")));
  }
  for (const write of mixed.value.writes) assert.equal(write.answer.ok, true);
  assert.equal(s.meter.syncMs, 0, "a status path performed synchronous external observation");
  assert.ok(reads.maxLagMs < READ_LAG_BUDGET_MS, `status reads held the event loop ${Math.round(reads.maxLagMs)} ms`);
  assert.ok(mixed.maxLagMs < MIXED_LAG_BUDGET_MS, `status work with mutations held the event loop ${Math.round(mixed.maxLagMs)} ms`);
  assert.ok(percentile(readMs, 0.95) < ANSWER_BUDGET_MS, `status.get p95 ${Math.round(percentile(readMs, 0.95))} ms`);
  assert.ok(s.meter.maxInFlight <= 1, `${s.meter.maxInFlight} observations ran at once`);
  // 16 readers share at most one refresh and one follow-up: no per-caller observation.
  assert.ok(readCommands <= 2, `${readCommands} observation calls for 16 concurrent reads`);
});

test("V23A / WP23.03: status of a society with hundreds of pending messages is one bounded read", { timeout: 120_000 }, async t => {
  const s = society(t);
  const to = Array.from({ length: 31 }, (_, i) => `w${i + 2}`);
  for (let i = 0; i < 20; i++) assert.equal((await s.call({ v: 1, id: `b${i}`, method: "mail.send", request: `bulk${i}`,
    params: { to, subject: "load", kind: "message", body: "x" } })).answer.ok, true);
  const { value, maxLagMs } = await loopLag(() => s.call({ v: 1, id: "p", method: "status.get", params: {} }));
  const pending = value.answer.result.agents.reduce((sum: number, row: { pending: number }) => sum + row.pending, 0);
  console.log(JSON.stringify({ oracle: "V23A pending", agents: AGENTS, pending, maxLagMs: Math.round(maxLagMs), readMs: Math.round(value.ms) }));
  assert.equal(pending, 20 * 31);
  assert.ok(maxLagMs < READ_LAG_BUDGET_MS, `status with ${pending} pending messages held the event loop ${Math.round(maxLagMs)} ms`);
});

test("V23A: an observer that stops answering costs a bounded wait and an honest unknown, never a pile of commands", { timeout: 30_000 }, async t => {
  let hang = true;
  const s = society(t, { hang: () => hang });
  const asked = Date.now();
  const first = await s.call({ v: 1, id: "h1", method: "status.get", params: { agent: "alice" } });
  assert.equal(first.answer.ok, true);
  assert.ok(first.answer.result.observedAtMs - asked < 100, "an unanswered observation was dated as if it had just been made");
  assert.ok(first.ms < 2_500, `a hung observation held the answer ${Math.round(first.ms)} ms`);
  const row = first.answer.result.agents[0];
  assert.deepEqual([row.agent, row.activeState, row.subState, row.unitResult, row.execMainStatus], ["alice", null, null, null, null],
    "an unanswered observation was shown as a state");
  // Callers during the hung command wait on the same bounded budget and start nothing new.
  const during = await Promise.all(Array.from({ length: 8 }, (_, i) => s.call({ v: 1, id: `h${i + 2}`, method: "status.get", params: {} })));
  assert.ok(during.every(read => read.answer.ok && read.ms < 2_500));
  assert.ok(s.meter.maxInFlight <= 1, `${s.meter.maxInFlight} observations ran at once`);
  hang = false;
  await new Promise(resolve => setTimeout(resolve, 3_200));
  const after = await s.call({ v: 1, id: "h9", method: "status.get", params: { agent: "alice" } });
  assert.equal(after.answer.result.agents[0].activeState, "inactive", "observation did not recover once the observer answered");
});

test("V23A / WP23.05: a failed observation is published as unknown with its time, not as an empty or idle society", { timeout: 30_000 }, async t => {
  const s = society(t, { fail: () => true });
  const read = await s.call({ v: 1, id: "f", method: "status.get", params: {} });
  assert.equal(read.answer.ok, true);
  assert.equal(read.answer.result.agents.length, AGENTS, "a failed observation dropped the registry rows");
  assert.ok(read.answer.result.agents.every((row: { activeState: string | null }) => row.activeState === null));
  // The view the Human's terminal reads says the same, with the observation time.
  await s.call({ v: 1, id: "m", method: "mail.send", request: "k", params: { to: ["w2"], subject: "s", kind: "message", body: "x" } });
  await new Promise(resolve => setTimeout(resolve, 300));
  const view = decodeStatusView(readFileSync(statusViewPath(s.root), "utf8"), "demo");
  assert.equal(view.kind, "view");
  if (view.kind !== "view") return;
  assert.equal(view.view.agents.length, AGENTS);
  assert.ok(view.view.agents.every(row => row.activeState === null && row.execMainStatus === null));
  assert.equal(view.view.agents.find(row => row.agent === "w2")!.pending, 1, "the Store facts were not published with the unknown units");
});


test("NATIVE-STATUS-PUBLICATION-01: mutation hints share one active publication and one fresh follow-up", async t => {
  const s = society(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(s.units, "observeStatus", async (actors: readonly string[]) => {
    await gate; return new Map(actors.map(actor => [actor, s.units.observe(actor)]));
  });
  const publish = s.views.publishStatus.bind(s.views); let publications = 0;
  t.mock.method(s.views, "publishStatus", (snapshot: import("@oma/contracts/runtime").StatusSnapshot) => { publications++; publish(snapshot); });
  try {
    for (let i = 0; i < 4; i++) {
      const result = await s.call({ v: 1, id: `coalesce-${i}`, method: "mail.send", request: `coalesce-${i}`,
        params: { to: ["w2"], subject: "status coalescing", kind: "message", body: "x" } });
      assert.equal(result.answer.ok, true);
    }
    assert.equal(publications, 0, "publication cannot precede its observation");
  } finally { release(); }
  // The observation fixture has no timer after release. Flush its promise
  // continuations and the requested follow-up without widening a time budget.
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(publications >= 1 && publications <= 2, `${publications} duplicate durable status publications for four hints`);
  assert.equal(s.store.pendingDeliveries("w2").length, 4);
});


test("NATIVE-STATUS-PUBLICATION-02: shutdown joins a held publication before Store close", async t => {
  const s = society(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(s.units, "observeStatus", async (actors: readonly string[]) => {
    await gate; return new Map(actors.map(actor => [actor, s.units.observe(actor)]));
  });
  let closed = false, publications = 0;
  const close = s.store.close.bind(s.store);
  t.mock.method(s.store, "close", () => { closed = true; close(); });
  t.mock.method(s.views, "publishStatus", () => { publications++; });
  try {
    const sent = await s.call({ v: 1, id: "close-publication", method: "mail.send", request: "close-publication",
      params: { to: ["w2"], subject: "shutdown", kind: "message", body: "x" } });
    assert.equal(sent.answer.ok, true);
    const draining = s.broker.drainAndClose();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, false, "Store closed while its publication owner was still waiting");
    release(); await draining;
    assert.equal(closed, true); assert.equal(publications, 0, "draining cannot republish the removed status view");
  } finally { release(); }
});

test("NATIVE-DISPATCH-YIELD-01: a completed mutation gives the event loop a turn before its reply", async t => {
  const s = society(t);
  const refresh = s.views.refreshWorld.bind(s.views);
  let observed = false, turn = Promise.resolve();
  t.mock.method(s.views, "refreshWorld", () => {
    refresh();
    turn = new Promise<void>(resolve => setImmediate(() => { observed = true; resolve(); }));
  });
  const sent = await s.call({ v: 1, id: "yield-one", method: "mail.send", request: "yield-one",
    params: { to: ["w2"], subject: "fair turn", kind: "message", body: "accepted once" } });
  const turnBeforeReply = observed;
  await turn;
  assert.equal(turnBeforeReply, true, "back-to-back completed writes monopolized the microtask queue");
  assert.equal(sent.answer.ok, true);
  assert.equal(s.store.getOperation("alice", "yield-one")?.state, "succeeded");
  assert.equal(s.store.pendingDeliveries("w2").length, 1);
});

test("NATIVE-DISPATCH-YIELD-02: admission closing during the turn cannot reinterpret the accepted result", async t => {
  const s = society(t);
  const refresh = s.views.refreshWorld.bind(s.views);
  let closed = false, turn = Promise.resolve(), accepted: { id: string; planJson: string; result: string } | null = null;
  t.mock.method(s.views, "refreshWorld", () => {
    refresh();
    turn = new Promise<void>((resolve, reject) => setImmediate(() => {
      try {
        const operation = s.store.getOperation("alice", "yield-close");
        assert.equal(operation?.state, "succeeded");
        accepted = { id: operation!.id, planJson: operation!.planJson, result: JSON.stringify(operation!.result) };
        s.broker.closeAdmission(); closed = true; resolve();
      } catch (error) { reject(error); }
    }));
  });
  const sent = await s.call({ v: 1, id: "yield-close", method: "mail.send", request: "yield-close",
    params: { to: ["w2"], subject: "closed after accept", kind: "message", body: "keep this fact" } });
  const closedBeforeReply = closed;
  await turn;
  assert.equal(closedBeforeReply, true, "the reply bypassed the cooperative boundary");
  assert.equal(sent.answer.ok, true, JSON.stringify(sent.answer));
  const operation = s.store.getOperation("alice", "yield-close")!;
  assert.deepEqual({ id: operation.id, planJson: operation.planJson, result: JSON.stringify(operation.result) }, accepted);
  assert.equal(operation.state, "succeeded");
  assert.equal(s.store.pendingDeliveries("w2").length, 1);
});
