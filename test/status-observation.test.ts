import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** WP23 (D04): the pieces status display is built from. The shared refresh is
 * single-flight and bounded; batched unit observation binds every answer to its
 * unit; the whole-society pending projection counts exactly what the per-agent
 * full-row projection counts, and refuses what it would refuse.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, UnitObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { UnitsModule, STATUS_CHUNK, unitCommandError, type UnitCommandOutcome } from "@oma/platform-linux/units";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { ViewsModule } from "#oma-test/app/views";
import { pendingWork, pendingWorkByAgent } from "#oma-test/app/views/pending-work";
import { generateBatchId } from "@oma/native/identity";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const idle: UnitObservation = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, cgroup: "", invocationId: "" };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

test("WP23.02: callers during a refresh share one follow-up that starts after them; no caller starts its own", { timeout: 5_000 }, async () => {
  const pending: Array<() => void> = [];
  let observations = 0; let clock = 1_000;
  const refresh = new StatusRefresh(() => ["a"], async () => {
    observations += 1;
    await new Promise<void>(resolve => pending.push(resolve));
    return new Map([["a", idle]]);
  }, 10_000, () => clock);
  const first = refresh.request();
  clock = 2_000;
  const during = Array.from({ length: 10 }, () => refresh.request());
  await tick();
  assert.equal(observations, 1, "a caller started an observation beside the running one");
  pending.shift()!();
  assert.equal((await first).observedAtMs, 1_000);
  await tick();
  assert.equal(observations, 2, "the waiting callers were not given one shared follow-up");
  clock = 3_000;
  const late = refresh.request();
  pending.shift()!();
  const answers = await Promise.all(during);
  assert.ok(answers.every(answer => answer === answers[0]), "callers of one follow-up got different observations");
  assert.ok(answers[0]!.observedAtMs >= 2_000, "an answer predates its question");
  await tick();
  assert.equal(observations, 3);
  pending.shift()!();
  assert.equal((await late).observedAtMs, 3_000);
});

test("WP23.02: a hung observation costs each caller the budget and an unknown, and is not started again beside itself", { timeout: 5_000 }, async () => {
  let observations = 0;
  const refresh = new StatusRefresh(() => ["a"], () => { observations += 1; return new Promise(() => {}); }, 40, () => 7);
  const answers = await Promise.all([refresh.request(), refresh.request(), refresh.request()]);
  for (const answer of answers) {
    assert.equal(answer.failure, "timeout");
    assert.equal(answer.units.size, 0);
    assert.equal(answer.observedAtMs, 7, "a timed-out answer does not carry the time it was asked");
  }
  assert.equal((await refresh.request()).failure, "timeout");
  assert.equal(observations, 1, "a hung observation was started again beside itself");
  const failing = new StatusRefresh(() => ["a"], async () => { throw new Error("manager gone"); }, 1_000);
  const failed = await failing.request();
  assert.equal(failed.failure, "unavailable");
  assert.equal(failed.units.size, 0);
});

function scriptedShow(root: string, answer: (units: string[]) => UnitCommandOutcome): { units: UnitsModule; calls: string[][] } {
  const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "u"));
  const calls: string[][] = [];
  Reflect.set(units, "commandAsync", async (argv: readonly string[]) => {
    const names = argv.filter(word => word.endsWith(".service"));
    calls.push(names);
    return answer(names);
  });
  return { units, calls };
}
const block = (unit: string, state = "inactive") =>
  `Id=${unit}\nActiveState=${state}\nSubState=${state === "active" ? "running" : "dead"}\nResult=success\nExecMainStatus=0\nControlGroup=\nInvocationID=\n`;
const ok = (stdout: string): UnitCommandOutcome => ({ kind: "succeeded", stdout, stderr: "", status: 0, signal: null });
/** The observation of a unit that exists. */
const unitOf = (value: UnitObservation | "no-unit" | undefined): UnitObservation => {
  assert.ok(value !== undefined && value !== "no-unit", `expected an observed unit, got ${String(value)}`);
  return value;
};

test("WP23.02: batched status observation binds each answer to its unit by Id, in bounded chunks", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-wp23-show-"));
  try {
    const agents = Array.from({ length: STATUS_CHUNK + 8 }, (_, i) => `w${i}`);
    // The manager's order is not trusted: blocks are answered in reverse.
    const { units, calls } = scriptedShow(root, names => ok(names.map((unit, i) => block(unit, i % 2 ? "active" : "inactive")).reverse().join("\n")));
    const observed = await units.observeStatus(agents);
    assert.deepEqual(calls.map(chunk => chunk.length), [STATUS_CHUNK, 8], "units were not observed in bounded chunks");
    assert.equal(unitOf(observed.get("w1")).activeState, "active");
    assert.equal(unitOf(observed.get("w2")).activeState, "inactive");
    assert.equal(observed.size, agents.length);
    // A repeated, missing, foreign or malformed block leaves only that agent unknown.
    const { units: odd } = scriptedShow(root, names => ok([block(names[0]!), block(names[0]!, "active"), block("oma-other-x.service", "active"),
      block(names[2]!).replace("ExecMainStatus=0", "ExecMainStatus=zero"), block(names[3]!, "active")].join("\n")));
    const partial = await odd.observeStatus(["a", "b", "c", "d"]);
    assert.equal(partial.has("a"), false, "a unit reported twice was believed");
    assert.equal(partial.has("b"), false, "a unit the manager did not report was invented");
    assert.equal(unitOf(partial.get("c")).activeState, "unknown");
    assert.equal(unitOf(partial.get("d")).activeState, "active");
    // A failed command observes nothing in its chunk.
    const { units: failing } = scriptedShow(root, () => ({ kind: "failed", stdout: block("oma-demo-a.service"), stderr: "", status: 1, signal: null }));
    assert.equal((await failing.observeStatus(["a"])).size, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AV9 / INV02: a unit systemd does not have is observed as no unit, and shown as none -- not as one that ran and exited", async t => {
  // systemd answers for a unit it does not have with LoadState=not-found and
  // the values of a clean exit; the Principal, which has no unit, was shown so.
  const f = await ledger(t);
  const { units } = scriptedShow(f.root, names => ok(names.map(unit => unit.endsWith("-principal.service")
    ? `Id=${unit}\nLoadState=not-found\nActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=\nInvocationID=\n`
    : `Id=${unit}\nLoadState=loaded\nActiveState=active\nSubState=running\nResult=success\nExecMainStatus=0\nControlGroup=/u\nInvocationID=${"a".repeat(32)}\n`).join("\n")));
  const observed = await units.observeStatus(["principal", "alice"]);
  assert.equal(observed.get("principal"), "no-unit");
  assert.equal(unitOf(observed.get("alice")).activeState, "active");
  const views = new ViewsModule(f.store, f.root, "demo", "principal");
  const [principal] = views.statusOf(Object.freeze({ observedAtMs: 1, units: observed, failure: null }), "principal");
  assert.deepEqual({ activeState: principal!.activeState, subState: principal!.subState, unitResult: principal!.unitResult,
    execMainStatus: principal!.execMainStatus, reason: principal!.reason },
    { activeState: null, subState: null, unitResult: null, execMainStatus: null, reason: "no systemd unit" });
  const [alice] = views.statusOf(Object.freeze({ observedAtMs: 1, units: observed, failure: null }), "alice");
  assert.equal(alice!.activeState, "active");
  assert.equal(alice!.reason, null);
});

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null } };

async function ledger(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-wp23-pending-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  const f = { root, store, mail: createMailModule({ stateRoot: root, society: "demo" }, store, 64) };
  t.after(() => { try { f.store.close(); } catch { /* reopened stores are closed by their case */ } finally { rmSync(root, { recursive: true, force: true }); } });
  f.store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    for (const name of ["alice", "bob", "carol"]) tx.insertAgent(makeValidAgent(name, { createdBy: "principal" }));
  });
  return f;
}
function prepare(store: Store, agent: string, messages: string[]): string {
  const id = generateBatchId();
  store.transaction(tx => {
    tx.insertPreparedBatch({ id, agent, incarnation: 1, messageIds: messages, sessionPath: null });
    tx.linkDeliveriesToBatch(id, messages);
  });
  return id;
}
function agree(store: Store): void {
  const all = pendingWorkByAgent(store.pendingWorkRows());
  for (const agent of store.listAgents()) assert.deepEqual(all.get(agent.name), pendingWork(store, agent.name), agent.name);
  assert.equal(all.size, store.listAgents().length);
}

test("WP23.03: the whole-society projection counts exactly what the per-agent full-row projection counts", async t => {
  const f = await ledger(t);
  agree(f.store);
  let seed = 23;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const recipients = ["alice", "bob", "carol"];
  for (let step = 0; step < 24; step++) {
    const to = recipients.filter(() => random() < 0.6);
    await f.mail.send(auth, `k${step}`, { to: to.length > 0 ? to : ["bob"], subject: "s", kind: "message", body: "x" });
    const agent = recipients[Math.floor(random() * recipients.length)]!;
    const open = f.store.preparedBatches(agent);
    if (open.length > 0 && random() < 0.5) {
      const batch = open[0]!;
      f.store.transaction(tx => tx.completeBatch(batch.id, JSON.parse(batch.messageIdsJson), agent, 1, `/s/${batch.id}`));
    } else if (open.length === 0 && random() < 0.5) {
      const messages = f.store.pendingDeliveries(agent).map(row => row.messageId).slice(0, 1 + Math.floor(random() * 3));
      if (messages.length > 0) prepare(f.store, agent, messages);
    }
    if (random() < 0.2) {
      const delivery = f.store.pendingDeliveries(agent)[0];
      if (delivery) f.store.transaction(tx => tx.markAcknowledged(delivery.messageId, agent));
    }
    agree(f.store);
  }
  const total = [...pendingWorkByAgent(f.store.pendingWorkRows()).values()].reduce((sum, work) => sum + work.pendingMessages, 0);
  assert.ok(total > 0, "the sequence never produced pending work to compare");
});

test("WP23.03: what the full-row projection refuses, the whole-society projection refuses too -- never a smaller count", async t => {
  const cases: Array<[string, (raw: import("node:sqlite").DatabaseSync, batch: string, messages: string[]) => void]> = [
    ["a manifest repeating a message", (raw, batch, messages) => raw.prepare("UPDATE batches SET message_ids_json=? WHERE id=?").run(JSON.stringify([messages[0], messages[0]]), batch)],
    ["a manifest missing a linked message", (raw, batch, messages) => raw.prepare("UPDATE batches SET message_ids_json=? WHERE id=?").run(JSON.stringify([messages[0]]), batch)],
    ["a batch from its owner's future", (raw, batch) => raw.prepare("UPDATE batches SET incarnation=99 WHERE id=?").run(batch)],
    ["a presented delivery in a prepared batch", (raw, _batch, messages) => raw.prepare("UPDATE deliveries SET presented=1, presented_at_ms=created_at_ms WHERE message_id=?").run(messages[1]!)],
    ["a message both unbatched and batched", (raw, batch, messages) => raw.prepare("UPDATE batches SET message_ids_json=? WHERE id=?").run(JSON.stringify([...messages, messages[2]]), batch)],
  ];
  for (const [name, corrupt] of cases) {
    const f = await ledger(t);
    for (let i = 0; i < 3; i++) await f.mail.send(auth, `c${i}`, { to: ["alice"], subject: "s", kind: "message", body: "x" });
    const messages = f.store.pendingDeliveries("alice").map(row => row.messageId);
    const batch = prepare(f.store, "alice", messages.slice(0, 2));
    agree(f.store);
    const path = f.store.path;
    f.store.close();
    mutateRawRowAfterClose(path, raw => corrupt(raw, batch, messages));
    f.store = new Store(path, 5, { society: "demo" });
    assert.throws(() => pendingWork(f.store, "alice"), { code: "STORE_CORRUPT" }, `${name}: the full-row projection accepted it`);
    assert.throws(() => pendingWorkByAgent(f.store.pendingWorkRows()), { code: "STORE_CORRUPT" }, `${name}: the display projection counted it`);
  }
});

test("WP23.03: the names-only read still refuses a name that is not an identity", async t => {
  const f = await ledger(t);
  assert.deepEqual(f.store.agentNames(), ["alice", "bob", "carol", "principal"]);
  const path = f.store.path;
  f.store.close();
  mutateRawRowAfterClose(path, raw => raw.prepare("UPDATE agents SET name='Carol Bad' WHERE name='carol'").run());
  f.store = new Store(path, 5, { society: "demo" });
  assert.throws(() => f.store.agentNames(), { code: "STORE_CORRUPT" });
});

test("AV12 / INV02, T36: an explicit start resets only a failed unit; an unloaded one is not a failed repair", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av12-"));
  try {
    const script = (state: string) => {
      const calls: string[][] = [];
      const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "u"));
      let started = false;
      Reflect.set(units, "command", (argv: readonly string[]): UnitCommandOutcome => {
        calls.push([...argv]);
        const [verb, unit, property] = argv;
        // systemd refuses reset-failed for a unit it has unloaded.
        if (verb === "reset-failed" && state !== "failed")
          return { kind: "failed", stdout: "", stderr: `Unit ${unit} not loaded.`, status: 1, signal: null };
        if (verb === "start") started = true;
        if (verb === "show" && unit?.endsWith(".path"))
          return ok(property === "--property=UnitFileState" ? "enabled\n" : "active\n");
        if (verb === "show") return ok(block(unit!, started ? "active" : state).replace("InvocationID=", `InvocationID=${"b".repeat(32)}`));
        return ok("");
      });
      return { units, calls };
    };
    const quiet = script("inactive");
    quiet.units.start("a", true);
    assert.equal(quiet.calls.some(argv => argv[0] === "reset-failed"), false, "a unit with no failed state was reset");
    assert.ok(quiet.calls.some(argv => argv[0] === "start"), "the start never reached the unit");
    const failed = script("failed");
    failed.units.start("a", true);
    assert.ok(failed.calls.some(argv => argv[0] === "reset-failed"), "an explicit start did not repair a failed unit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});


for (const [name, state, result, restarts, burst, expected] of [
  ["old restarts across expired windows", "failed", "exit-code", 700, 5, null],
  ["exactly one historical burst", "failed", "exit-code", 5, 5, null],
  ["explicit current limit", "failed", "start-limit-hit", 0, 5, "start_limit"],
  ["stale limit after restart", "active", "start-limit-hit", 700, 5, null],
  ["inactive old failure", "inactive", "start-limit-hit", 700, 5, null],
] as const) {
  test(`DR27: start-limit observation uses current evidence, not ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-limit-"));
    try {
      const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "u"));
      const calls: string[][] = [];
      Reflect.set(units, "command", (argv: string[]): UnitCommandOutcome => {
        calls.push(argv);
        assert.equal(argv[0], "show", "a diagnostic must never repair the unit");
        return ok(block(argv[1]!, state).replace("Result=success", `Result=${result}`) +
          `NRestarts=${restarts}\nStartLimitBurst=${burst}\n`);
      });
      assert.equal(units.startLimitStatus("a"), expected);
      assert.equal(calls.length, 1, "cumulative counters are neither a second clock nor evidence of a current limit");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const [name, outcome] of [
  ["unobserved command", { ...ok(""), kind: "unknown", status: null }],
  ["failed command", { ...ok(""), kind: "failed", status: 1 }],
  ["incomplete properties", ok("ActiveState=failed\nResult=start-limit-hit\n")],
  ["contradictory properties", ok(block("a", "failed").replace("Result=success", "Result=start-limit-hit\nResult=exit-code"))],
] satisfies Array<[string, UnitCommandOutcome]>) {
  test(`DR27: start-limit is unconfirmed after ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-limit-"));
    try {
      const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "u"));
      Reflect.set(units, "command", () => outcome);
      assert.equal(units.startLimitStatus("a"), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const [kind, result, expected] of [
  ["failed", "exit-code", "INTERNAL_ERROR"],
  ["failed", "start-limit-hit", "START_LIMIT"],
  ["unknown", "start-limit-hit", "DEADLINE_EXCEEDED"],
  ["unknown", "exit-code", "DEADLINE_EXCEEDED"],
] as const) {
  test(`DR27: ${kind} start with ${result} preserves the command's knowledge`, () => {
    const root = mkdtempSync(join(tmpdir(), "oma-limit-"));
    try {
      const units = new UnitsModule("demo", { node: process.execPath, libdir: root, state: root, society: "demo", agent: "" }, join(root, "u"));
      const calls: string[][] = [];
      Reflect.set(units, "command", (argv: string[]): UnitCommandOutcome => {
        calls.push(argv);
        if (argv[0] === "start") return { kind, stdout: "", stderr: "Job for oma-demo-start-limit.service failed.", status: kind === "failed" ? 1 : null, signal: null };
        if (argv[0] === "show" && argv[1]?.endsWith(".path"))
          return ok(argv[2] === "--property=UnitFileState" ? "enabled\n" : "active\n");
        if (argv[0] === "show") return ok(block(argv[1]!, "failed").replace("Result=success", `Result=${result}`) +
          "NRestarts=700\nStartLimitBurst=5\n");
        return ok("");
      });
      assert.throws(() => units.start("a", false), { code: expected });
      assert.equal(calls.filter(argv => argv[0] === "start").length, 1, "never retry a failed or unobserved effect");
      assert.equal(calls.some(argv => argv[0] === "reset-failed"), false, "diagnosis is not repair authority");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("DR27: command prose or a unit name is not structured start-limit evidence", () => {
  for (const verb of ["start", "stop", "show", "enable", "reset-failed"]) {
    for (const text of ["start-limit-hit", "Job for oma-demo-start-limit.service failed.", "Failed to stop start-limit.service: Permission denied."]) {
      assert.equal(unitCommandError({ kind: "failed", stdout: "", stderr: text, status: 1, signal: null }, verb)?.code, "INTERNAL_ERROR");
      assert.equal(unitCommandError({ kind: "unknown", stdout: text, stderr: text, status: null, signal: null }, verb)?.code, "DEADLINE_EXCEEDED");
    }
  }
});
