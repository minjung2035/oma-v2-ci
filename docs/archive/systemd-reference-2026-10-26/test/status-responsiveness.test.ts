import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V23A (WP23, D04): unit status is diagnostic observation. Collecting it must
 * not stall the broker's event loop, pile up concurrent systemctl processes or
 * queue unbounded work, whatever the number of agents or the speed of the
 * manager. Real Store, Broker, dispatchers, Mail, Lifecycle and Views; the
 * systemctl boundary is replaced by a cost model fitted to `systemctl --user
 * show` on systemd 257 (6.9 ms + 1.61 ms per unit, measured on the disposable
 * account), blocking for the synchronous path and timed for the asynchronous
 * one. The measured figures are printed so a run records them.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { Broker } from "@oma/broker";
import { UnitsModule, type UnitCommandOutcome } from "@oma/platform-linux/units";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { decodeStatusView, statusViewPath } from "@oma/protocol/status-view";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const AGENTS = 64;
const showCostMs = (units: number): number => 6.9 + 1.61 * units;
const blocked = new Int32Array(new SharedArrayBuffer(4));
const blockFor = (ms: number): void => { Atomics.wait(blocked, 0, 0, ms); };

/** What `systemctl show` prints for the requested units and properties. */
function showOutput(argv: readonly string[], state: (unit: string) => string): string {
  const units = argv.filter(word => /\.(service|path|timer)$/.test(word));
  const properties: string[] = [];
  argv.forEach((word, index) => {
    if (word === "-p") properties.push(argv[index + 1]!);
    else if (word.startsWith("--property=")) properties.push(word.slice("--property=".length));
  });
  const value = (unit: string, property: string): string => ({
    Id: unit, ActiveState: state(unit), SubState: state(unit) === "active" ? "running" : "dead", Result: "success",
    ExecMainStatus: "0", ControlGroup: "", InvocationID: "", LoadState: "loaded", NRestarts: "0", StartLimitBurst: "5",
  } as Record<string, string>)[property] ?? "";
  const onlyValues = argv.includes("--value");
  return units.map(unit => properties.map(property => onlyValues ? value(unit, property) : `${property}=${value(unit, property)}`).join("\n"))
    .join("\n\n") + "\n";
}

interface Meter { commands: number; inFlight: number; maxInFlight: number; syncMs: number }
function modelledUnits(root: string, meter: Meter, options: { hang?: () => boolean; fail?: () => boolean } = {}): UnitsModule {
  const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" },
    join(root, "units"));
  const state = (): string => "inactive";
  // One-off measurement against the real user manager (units not found answer
  // as inactive); the lanes run the fitted model.
  if (process.env.V23A_REAL_SYSTEMD === "1") return units;
  Reflect.set(units, "command", (argv: readonly string[]): UnitCommandOutcome => {
    const count = argv.filter(word => word.endsWith(".service")).length;
    const started = performance.now();
    blockFor(showCostMs(Math.max(1, count)));
    meter.commands += 1; meter.syncMs += performance.now() - started;
    return { kind: "succeeded", stdout: showOutput(argv, state), stderr: "", status: 0, signal: null };
  });
  Reflect.set(units, "commandAsync", (argv: readonly string[]): Promise<UnitCommandOutcome> => {
    const count = argv.filter(word => word.endsWith(".service")).length;
    meter.commands += 1; meter.inFlight += 1; meter.maxInFlight = Math.max(meter.maxInFlight, meter.inFlight);
    const hang = options.hang?.() ?? false;
    return new Promise(resolve => setTimeout(() => {
      meter.inFlight -= 1;
      resolve(options.fail?.() ? { kind: "unknown", stdout: "", stderr: "", status: null, signal: null }
        : { kind: "succeeded", stdout: showOutput(argv, state), stderr: "", status: 0, signal: null });
    }, hang ? 3_000 : showCostMs(Math.max(1, count))));
  });
  return units;
}

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };

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
  return { root, store, meter, broker, call };
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
    assert.ok(read.answer.result.agents.every((row: { activeState: string | null }) => row.activeState === "inactive"));
  }
  for (const write of mixed.value.writes) assert.equal(write.answer.ok, true);
  assert.equal(s.meter.syncMs, 0, "a status path ran systemctl on the event loop");
  assert.ok(reads.maxLagMs < READ_LAG_BUDGET_MS, `status reads held the event loop ${Math.round(reads.maxLagMs)} ms`);
  assert.ok(mixed.maxLagMs < MIXED_LAG_BUDGET_MS, `status work with mutations held the event loop ${Math.round(mixed.maxLagMs)} ms`);
  assert.ok(percentile(readMs, 0.95) < ANSWER_BUDGET_MS, `status.get p95 ${Math.round(percentile(readMs, 0.95))} ms`);
  assert.ok(s.meter.maxInFlight <= 1, `${s.meter.maxInFlight} observations ran at once`);
  // 16 readers share at most one refresh and one follow-up: no per-caller observation.
  assert.ok(readCommands <= 2 * Math.ceil(AGENTS / 32), `${readCommands} systemctl commands for 16 concurrent reads`);
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

test("V23A: a manager that stops answering costs a bounded wait and an honest unknown, never a pile of commands", { timeout: 30_000 }, async t => {
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
  assert.equal(after.answer.result.agents[0].activeState, "inactive", "observation did not recover once the manager answered");
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
