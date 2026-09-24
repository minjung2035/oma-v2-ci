// V08A (WP08, D01): after the Principal's boundary is durable, only the
// completion is retried; the engine is never handed the batch again.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoundaryEvidence, PreparedBatch } from "../implementation/contracts.js";
import { PrincipalDelivery, type DeliverySession } from "../src/runtime/principal-delivery.js";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "../src/storage/delivery-receipt.js";
import type { PiEvent } from "../src/runtime/pi-rpc.js";
import { runnerReceiptPathAt, sessionDirPathAt } from "../src/storage/paths.js";
import { StoreError } from "../src/domain/errors.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

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
  writeFileSync(sessionPath, '{"type":"session","version":3}\n');
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
    release: () => { claimed = false; },
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
