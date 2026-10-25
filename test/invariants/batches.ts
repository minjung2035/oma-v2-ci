import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { batchViewPathAt, mailInboxPathAt } from "@oma/domain/paths";
import { decodeBatchViewText, type BatchViewLimits } from "@oma/protocol/batch-view";
import type { LedgerSnapshot, InvariantPhase } from "./store.js";

export function assertBatches(snapshot: LedgerSnapshot, root: string, phase: InvariantPhase, limits: BatchViewLimits): readonly string[] {
  const incomplete: string[] = [];
  const preparedOwners = new Set<string>();
  for (const batch of snapshot.batches) {
    const ids: unknown = JSON.parse(batch.messageIdsJson);
    assert.ok(Array.isArray(ids) && ids.every(id => typeof id === "string"), "BATCH_MANIFEST_SHAPE");
    const manifest = ids as string[];
    assert.equal(new Set(manifest).size, manifest.length, "BATCH_DUPLICATE_MANIFEST");
    const deliveries = snapshot.deliveries.filter(delivery => delivery.batchId === batch.id);
    assert.deepEqual(deliveries.map(delivery => delivery.messageId).sort(), [...manifest].sort(), "BATCH_EXACT_DELIVERY_SET");
    for (const delivery of deliveries) {
      assert.equal(delivery.recipient, batch.agent, "BATCH_DELIVERY_OWNER");
      assert.equal(delivery.materialized, 1, "BATCH_UNMATERIALIZED_MESSAGE");
      assert.equal(delivery.presented, batch.state === "completed" ? 1 : 0, "BATCH_PRESENTATION_STATE");
    }
    if (batch.state === "prepared") {
      assert.equal(preparedOwners.has(batch.agent), false, "MULTIPLE_PREPARED_BATCHES"); preparedOwners.add(batch.agent);
      const owner = snapshot.agents.find(agent => agent.name === batch.agent);
      assert.ok(owner && batch.incarnation <= owner.incarnation, "BATCH_FUTURE_INCARNATION");
    }
    for (const id of manifest) {
      const current = lstatSync(mailInboxPathAt(root, batch.agent, id, "cur"), { throwIfNoEntry: false });
      if (phase === "settled" || batch.state === "completed") assert.equal(current?.isFile(), true, "BATCH_CUR_MISSING");
      else if (!current) incomplete.push(`${batch.id}:cur-pending:${id}`);
    }
    const path = batchViewPathAt(root, batch.agent, batch.id);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) {
      assert.notEqual(phase, "settled", "BATCH_VIEW_MISSING"); incomplete.push(`${batch.id}:view-pending`); continue;
    }
    assert.equal(stat.isFile(), true, "BATCH_VIEW_TYPE");
    assert.ok(stat.size <= limits.frameBytes, "BATCH_VIEW_SOURCE_LIMIT");
    const view = decodeBatchViewText(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)), batch.id, limits);
    assert.ok(view, "BATCH_VIEW_INVALID");
    assert.equal(view.agent, batch.agent, "BATCH_VIEW_OWNER");
    assert.deepEqual(view.messageIds, manifest, "BATCH_VIEW_MANIFEST_ORDER");
    if (phase === "settled") assert.equal(view.incarnation, batch.incarnation, "BATCH_VIEW_INCARNATION");
    else if (view.incarnation !== batch.incarnation) incomplete.push(`${batch.id}:view-awaits-incarnation-republication`);
    // No requirement that acknowledged==presented, and no view/session field
    // is accepted as trusted Pi consumption evidence.
  }
  return incomplete;
}
