import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** WP23 (D04): the pieces status display is built from. The shared refresh is
 * single-flight and bounded; native Resident observation is kept separate from the Principal host session; the whole-society pending projection counts exactly what the per-agent
 * full-row projection counts, and refuses what it would refuse.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ExecutionObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { StatusRefresh } from "@oma/broker/status-refresh";
import { ViewsModule } from "#oma-test/app/views";
import { pendingWork, pendingWorkByAgent } from "#oma-test/app/views/pending-work";
import { generateBatchId } from "@oma/native/identity";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const idle: ExecutionObservation = { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "" };
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

test("AV9 / INV02: Principal status never borrows a Resident's idle or exit-zero observation", async t => {
  const f = await ledger(t), views = new ViewsModule(f.store, f.root, "demo", "principal");
  const observed: string[] = [];
  const rows = views.status(undefined, actor => { observed.push(actor); return idle; });
  const principal = rows.find(row => row.agent === "principal")!;
  assert.deepEqual([principal.activeState, principal.subState, principal.unitResult, principal.execMainStatus], [null, null, null, null]);
  assert.equal(principal.reason, "no managed Resident execution");
  assert.equal(observed.includes("principal"), false, "the host session is outside the Resident observer's authority");
  assert.equal(rows.find(row => row.agent === "alice")!.activeState, "inactive");
});

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: 1, uid: 1000, gid: 1000 } };

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
