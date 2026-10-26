import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** V30A (WP30, D01): an independent state model of one prepared batch's
 * delivery evidence, run against the composed runtime -- real Store, Mail,
 * receipt files and Broker.openRun after a broker restart -- over seeded event
 * sequences.
 *
 * The expected outcomes are written from D01's decision table and DR9, not from
 * the production code: a receipt of any of the batch's delivery attempts -- the
 * run it was created in up to the latest -- settles it, including one that
 * appears only after later runs opened ("late"); a receipt proven absent leaves
 * the batch for the next run's attempt, and the batch row is never rewritten;
 * an unreadable receipt opens nothing and changes nothing, and once it is
 * readable again the next run settles it (liveness); a conflicting receipt --
 * other messages, or an attempt from before the batch existed ("early") --
 * opens nothing, is kept and never turns into success on its own. Facts never
 * regress: a completed batch stays completed, the incarnation never goes back,
 * receipt bytes are not rewritten.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PreparedBatch, ResolvedAgentSpec } from "@oma/contracts";
import { Broker } from "@oma/broker";
import { LifecycleModule } from "@oma/lifecycle";
import { ViewsModule } from "#oma-test/app/views";
import { nativeReceiptBroker } from "./fixtures/native-receipt-broker.js";
import { publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { runnerReceiptPathAt } from "@oma/domain/paths";
import { boundaryOf, completeSession, preparedFixture } from "./fixtures/delivery-receipt.js";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";


type Receipt = "absent" | "verified" | "conflicting";
interface Model { incarnation: number; batch: { incarnation: number; state: "prepared" | "completed" }; receipt: Receipt; hidden: boolean }
type Event = "publish" | "corrupt" | "late" | "early" | "hide" | "reveal" | "open";
type Outcome = { opened: true } | { opened: false; code: "BROKER_UNAVAILABLE" | "BATCH_CONFLICT" } | null;

/** D01, as a table: what an open does to the model. */
function expectOpen(m: Model): Outcome {
  if (m.batch.state === "completed") { m.incarnation += 1; return { opened: true }; }
  if (m.receipt !== "absent" && m.hidden) return { opened: false, code: "BROKER_UNAVAILABLE" };
  if (m.receipt === "conflicting") return { opened: false, code: "BATCH_CONFLICT" };
  if (m.receipt === "verified") { m.batch.state = "completed"; m.incarnation += 1; return { opened: true }; }
  // DR9: the next run is the batch's next attempt; the batch row stays as it was.
  m.incarnation += 1; return { opened: true };
}
/** Which events the model allows now; the rest are not reachable from here. */
function allowed(m: Model, rolled: boolean): Event[] {
  const events: Event[] = ["open"];
  if (m.batch.state === "prepared" && m.receipt === "absent") events.push("publish", "corrupt", "early", ...(rolled ? ["late" as const] : []));
  if (m.receipt !== "absent" && !m.hidden) events.push("hide");
  if (m.hidden) events.push("reveal");
  return events;
}

/** A broker restart, as in production: the previous broker drains and closes
 * its Store, and the next one opens the database again. */
interface World { root: string; batch: PreparedBatch; store: Store; mail: MailModule; broker: Broker | null; invocations: number }
async function restart(w: World): Promise<Broker & { tryOpen(): Promise<{ incarnation: number }> }> {
  if (w.broker) { await w.broker.drainAndClose(); w.broker = null; }
  else w.store.close();
  w.store = new Store(join(w.root, "runtime.sqlite"));
  w.mail = createMailModule({ stateRoot: w.root, society: "demo" }, w.store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
  const broker = await nativeReceiptBroker(w);
  w.broker = broker;
  const label = String(++w.invocations);
  return Object.assign(broker, { tryOpen: () => broker.openReceiptRun(label) });
}

function receiptFor(w: World, incarnation: number): void {
  const batch: PreparedBatch = { ...w.batch, incarnation };
  const session = completeSession(w.root, batch, `delivery-${incarnation}.jsonl`);
  publishDeliveryReceipt(w.root, batch, boundaryOf(batch, session), TEST_VIEW_LIMITS.frameBytes);
}

async function run(seed: number, steps: number): Promise<string[]> {
  const f = await preparedFixture(1);
  const w: World = { root: f.root, batch: f.batch, store: f.store, mail: f.mail, broker: null, invocations: 0 };
  const path = runnerReceiptPathAt(f.root, "alice", f.batch.id);
  const m: Model = { incarnation: 1, batch: { incarnation: 1, state: "prepared" }, receipt: "absent", hidden: false };
  let random = seed >>> 0;
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const trace: string[] = [];
  let rolled = false; let kept: Buffer | null = null;
  const check = (label: string) => {
    const agent = w.store.getAgent("alice")!; const row = w.store.getBatch(f.batch.id)!;
    assert.equal(agent.incarnation, m.incarnation, `${label}: incarnation`);
    assert.deepEqual([row.state, row.incarnation], [m.batch.state, m.batch.incarnation], `${label}: batch`);
    if (kept !== null && !m.hidden) assert.deepEqual(readFileSync(path), kept, `${label}: receipt bytes were rewritten`);
  };
  const apply = async (event: Event) => {
    trace.push(event);
    const label = `seed ${seed} after ${trace.join(",")}`;
    switch (event) {
      // The run holding the batch now publishes its attempt's receipt.
      case "publish": receiptFor(w, m.incarnation); m.receipt = "verified"; kept = readFileSync(path); break;
      case "corrupt": {
        receiptFor(w, m.batch.incarnation); chmodSync(path, 0o600);
        const legacy = JSON.parse(readFileSync(path, "utf8"));
        legacy.messageIds = [...legacy.messageIds, "m-00000000-0000-4000-8000-000000000000-0"];
        writeFileSync(path, JSON.stringify(legacy)); m.receipt = "conflicting"; kept = readFileSync(path); break;
      }
      // DR9: a runner of an earlier attempt of this batch publishes late; it is
      // still this batch's evidence.
      case "late": receiptFor(w, m.incarnation - 1); m.receipt = "verified"; kept = readFileSync(path); break;
      // A receipt claiming an attempt from before the batch existed is not its evidence.
      case "early": receiptFor(w, m.batch.incarnation - 1); m.receipt = "conflicting"; kept = readFileSync(path); break;
      case "hide": chmodSync(path, 0o000); m.hidden = true; break;
      // Readable again exactly as published (0600); any other mode is not the receipt.
      case "reveal": chmodSync(path, 0o600); m.hidden = false; break;
      case "open": {
        const broker = await restart(w);
        const before = m.incarnation;
        const expected = expectOpen(m);
        let actual: Outcome;
        try { await broker.tryOpen(); actual = { opened: true }; }
        catch (error) { actual = { opened: false, code: (error as { code: "BROKER_UNAVAILABLE" | "BATCH_CONFLICT" }).code }; }
        assert.deepEqual(actual, expected, `${label}: open`);
        if (m.incarnation !== before) rolled = true;
        break;
      }
    }
    check(label);
  };
  try {
    for (let step = 0; step < steps; step += 1) {
      const events = allowed(m, rolled);
      await apply(events[Math.floor(next() * events.length)]!);
    }
    // Liveness: once the evidence can be read, the next run settles what it can.
    if (m.hidden) await apply("reveal");
    await apply("open");
    if (m.receipt === "conflicting" && m.batch.state === "prepared")
      assert.ok(existsSync(path), "conflicting evidence was dropped instead of kept for repair");
    return trace;
  } finally {
    if (existsSync(path)) chmodSync(path, 0o600);
    if (w.broker) await w.broker.drainAndClose(); else w.store.close();
    // The fixture's own Store object was closed by the first restart.
    (f.store as unknown as { close(): void }).close = () => undefined;
    f.close();
  }
}

test("V30A: seeded delivery-evidence sequences follow D01 on the composed runtime", { timeout: 300_000 }, async () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 24; seed += 1) for (const event of await run(seed, 8)) seen.add(event);
  // The sequences reached every kind of event, so no row of the table went unexercised.
  assert.deepEqual([...seen].sort(), ["corrupt", "early", "hide", "late", "open", "publish", "reveal"]);
});
