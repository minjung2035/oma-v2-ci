/** RUN-003: wait control cannot be substituted for durable delivery evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelivery } from "@oma/extension/delivery";
import { PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "@oma/protocol/delivery-boundary";
import { boundaryOf, waitOf, waitObservationOf } from "@oma/engine/pi-adapter";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import type { PreparedBatch } from "@oma/contracts";
const batch: PreparedBatch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
  messageIds: [], sessionPath: null, deliveryMode: "followUp", notice: "mail", indexPath: "/inbox.md" };

test("DR27: wait decoder is exact and a wait notice is never a delivery boundary", () => {
  const good = { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: batch.incarnation };
  const event = (value: unknown) => ({ type: "extension_ui_request", method: "notify", message: PI_WAIT_PREFIX + JSON.stringify(value) });
  assert.equal(waitOf(event(good), batch), true);
  assert.equal(boundaryOf(event(good), batch), null);
  for (const phase of ["begin", "end", "failed"] as const) {
    const notice = { ...event(good), message: PI_WAIT_OBSERVATION_PREFIX + JSON.stringify({ ...good, phase }) };
    assert.equal(waitObservationOf(notice, batch), phase);
    assert.equal(waitOf(notice, batch), false);
    assert.equal(boundaryOf(notice, batch), null);
    for (const raw of [null, [], good, { ...good, phase: "unknown" }, { ...good, phase, extra: true },
      { ...good, phase, incarnation: 0 }, { ...good, phase, batchId: "other" }, { ...good, phase, adapterRevision: "other" }])
      assert.equal(waitObservationOf({ ...notice, message: PI_WAIT_OBSERVATION_PREFIX + JSON.stringify(raw) }, batch), null);
    assert.equal(waitObservationOf({ ...notice, message: PI_WAIT_OBSERVATION_PREFIX + "{" }, batch), null);
    assert.equal(waitObservationOf({ ...notice, method: "select" }, batch), null);
    assert.equal(waitObservationOf({ ...notice, type: "message_end" }, batch), null);
  }
  for (const value of [null, [], {}, { ...good, incarnation: 0 }, { ...good, batchId: "other" },
    { ...good, adapterRevision: "other" }, { ...good, entryId: "0123abcd" }])
    assert.equal(waitOf(event(value), batch), false);
  assert.equal(waitOf({ ...event(good), method: "select" }, batch), false);
  assert.equal(waitOf({ ...event(good), type: "message_end" }, batch), false);
  assert.equal(waitOf({ ...event(good), message: PI_WAIT_PREFIX + "{" }, batch), false);
});
