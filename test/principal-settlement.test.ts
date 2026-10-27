// V08A (WP08, D01): after the Principal's boundary is durable, only the
// completion is retried; the engine is never handed the batch again.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoundaryEvidence, PreparedBatch } from "@oma/contracts";
import { PrincipalDelivery, type DeliverySession } from "#oma-test/app/runtime/principal-delivery";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "@oma/protocol/delivery-boundary";
import type { PiEvent } from "@oma/engine/pi-rpc";
import { runnerReceiptPathAt, sessionDirPathAt } from "@oma/domain/paths";
import { StoreError } from "@oma/domain/errors";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { writeBoundarySession } from "./fixtures/delivery-receipt.js";

const BATCH: PreparedBatch = {
  id: "b-00000000-0000-4000-8000-0000000000a8", agent: "principal", incarnation: 0,
  messageIds: [], deliveryMode: "followUp", notice: "", sessionPath: null, indexPath: "/inbox.md",
} as unknown as PreparedBatch;

function scene() {
  const root = mkdtempSync(join(tmpdir(), "oma-v08-"));
  mkdirSync(join(root, "agents", "principal", "runner", "view"), { recursive: true });
  const sessions = sessionDirPathAt(root, "principal");
  mkdirSync(sessions, { recursive: true });
  const sessionPath = join(sessions, "live.jsonl");
  writeBoundarySession(sessionPath, BATCH, "0123abcd");
  const listeners = new Set<(event: PiEvent) => void>();
  const counts = { deliver: 0, complete: 0 };
  let claimed = false;
  const emit = (event: PiEvent) => { for (const listener of [...listeners]) listener(event); };
  const session: DeliverySession = {
    running: true,
    get busy() { return claimed; },
    onEvent: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    deliver: async () => {
      counts.deliver += 1; claimed = true;
      // The engine accepts, produces the boundary and settles.
      queueMicrotask(() => {
        emit({ type: "response", id: BATCH.id, command: "prompt", success: true } as PiEvent);
        emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [] } } as PiEvent);
        emit({ type: "extension_ui_request", method: "notify", message: `${PI_BOUNDARY_PREFIX}${JSON.stringify({
          adapterRevision: PI_ADAPTER_REVISION, batchId: BATCH.id, incarnation: BATCH.incarnation, sessionPath, entryId: "0123abcd" })}` } as PiEvent);
        claimed = false;
        emit({ type: "agent_settled" } as PiEvent);
      });
    },
  };
  return { root, sessionPath, counts, session, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("V08A: a completion that fails after the receipt is retried alone; the engine sees the batch once", async () => {
  const s = scene();
  try {
    const completions: BoundaryEvidence[] = [];
    let failNext = true;
    let now = 0;
    const delivery = new PrincipalDelivery(s.session, {
      prepare: async () => BATCH,
      complete: async evidence => {
        s.counts.complete += 1;
        if (failNext) { failNext = false; throw new StoreError("BROKER_UNAVAILABLE", "connection lost before the answer"); }
        completions.push(evidence);
      },
    }, { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 5_000, now: () => now });
    const first = await delivery.tick();
    assert.deepEqual([first.kind, first.kind === "failed" ? first.phase : null], ["failed", "complete"]);
    const receipt = readFileSync(runnerReceiptPathAt(s.root, "principal", BATCH.id));
    // The back-off still holds for this batch.
    assert.equal((await delivery.tick()).kind, "deferred");
    now += 5_000;
    assert.deepEqual(await delivery.tick(), { kind: "settled", batchId: BATCH.id });
    assert.equal(s.counts.deliver, 1, "the engine was handed the batch again");
    assert.equal(s.counts.complete, 2);
    assert.equal(completions[0]!.sessionPath, s.sessionPath);
    assert.deepEqual(readFileSync(runnerReceiptPathAt(s.root, "principal", BATCH.id)), receipt, "the first receipt was rewritten");
  } finally { s.close(); }
});

test("V08A / WP08.04: a batch conflict at completion is a failure with back-off, not a lost session race", async () => {
  const s = scene();
  try {
    let now = 0;
    const delivery = new PrincipalDelivery(s.session, {
      prepare: async () => BATCH,
      complete: async () => { s.counts.complete += 1; throw new StoreError("BATCH_CONFLICT", "batch ownership mismatch"); },
    }, { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 5_000, now: () => now });
    const first = await delivery.tick();
    assert.equal(first.kind, "failed");
    assert.equal(first.kind === "failed" ? first.phase : null, "complete");
    assert.equal((await delivery.tick()).kind, "deferred", "a completion conflict was retried at once as if the session were contended");
    assert.equal(s.counts.complete, 1);
    assert.equal(s.counts.deliver, 1);
  } finally { s.close(); }
});

test("V08A / WP08.04: losing the session claim is still deferred without back-off", async () => {
  const s = scene();
  try {
    const session: DeliverySession = { ...s.session, running: true, busy: false,
      deliver: async () => { throw new StoreError("BATCH_CONFLICT", "the session was claimed"); } };
    const delivery = new PrincipalDelivery(session, { prepare: async () => BATCH, complete: async () => {} },
      { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 60_000 });
    assert.deepEqual(await delivery.tick(), { kind: "deferred", reason: "the principal session was claimed first" });
    assert.deepEqual(await delivery.tick(), { kind: "deferred", reason: "the principal session was claimed first" });
  } finally { s.close(); }
});

test("MAC-650 / D-7: the retry spacing is elapsed time, not the wall clock's difference", async () => {
  // A wall clock that leaps two hours at every reading -- a machine waking
  // from sleep -- must not end the back-off of a batch that just failed.
  const s = scene();
  const wall = Date.now;
  let leaps = 0;
  try {
    const path = runnerReceiptPathAt(s.root, "principal", BATCH.id);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{\"not\":\"a receipt\"}");
    const delivery = new PrincipalDelivery(s.session, { prepare: async () => BATCH, complete: async () => {} },
      { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 5_000 });
    Date.now = () => wall() + (leaps += 1) * 2 * 3600_000;
    assert.equal((await delivery.tick()).kind, "failed");
    assert.deepEqual(await delivery.tick(), { kind: "deferred", reason: `batch ${BATCH.id} failed recently` });
  } finally { Date.now = wall; s.close(); }
});

test("V08B: conflicting or unavailable receipt evidence presents nothing and is kept", async () => {
  for (const fault of ["conflicting", "unavailable"] as const) {
    const s = scene();
    try {
      const path = runnerReceiptPathAt(s.root, "principal", BATCH.id);
      mkdirSync(join(path, ".."), { recursive: true });
      if (fault === "conflicting") writeFileSync(path, "{\"not\":\"a receipt\"}");
      else { writeFileSync(path, "{}"); chmodSync(path, 0o000); }
      const delivery = new PrincipalDelivery(s.session, { prepare: async () => BATCH, complete: async () => { s.counts.complete += 1; } },
        { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 5_000 });
      const outcome = await delivery.tick();
      assert.deepEqual([outcome.kind, outcome.kind === "failed" ? outcome.phase : null], ["failed", "evidence"], fault);
      assert.deepEqual(s.counts, { deliver: 0, complete: 0 }, `${fault} evidence led to a presentation or completion`);
      if (fault === "conflicting") assert.equal(readFileSync(path, "utf8"), "{\"not\":\"a receipt\"}");
      else chmodSync(path, 0o600);
    } finally { s.close(); }
  }
});


test("DR27/P0-4: each Principal delivery wake returns its observation timer", async t => {
  const s = scene();
  const pending = new Set<ReturnType<typeof setTimeout>>();
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  let emit: (event: PiEvent) => void = () => {};
  let unsubscribed = false;
  s.session.onEvent = listener => { emit = listener; return () => { unsubscribed = true; }; };
  s.session.deliver = async () => {};
  t.mock.method(globalThis, "setTimeout", (callback: () => void, ms?: number) => {
    const timer = schedule(() => { pending.delete(timer); callback(); }, ms);
    pending.add(timer);
    // Refusal wakes the production race before this timer fires.
    queueMicrotask(() => emit({ type: "response", id: BATCH.id, command: "prompt", success: false }));
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { pending.delete(timer); cancel(timer); });
  try {
    const delivery = new PrincipalDelivery(s.session, { prepare: async () => BATCH, complete: async () => assert.fail("refused delivery cannot complete") },
      { stateRoot: s.root, frameBytes: TEST_VIEW_LIMITS.frameBytes, acceptMs: 10_000, retryAfterMs: 5000 });
    const result = await delivery.tick();
    assert.equal(result.kind, "failed");
    assert.equal(unsubscribed, true);
    assert.equal(pending.size, 0, "a wake retained the losing timeout");
  } finally { for (const timer of pending) cancel(timer); s.close(); }
});
