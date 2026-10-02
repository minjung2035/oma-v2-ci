import { join } from "node:path";
import type { PreparedBatch } from "../../implementation/contracts.js";
import { mailArchiveDisplayPath } from "../domain/derived.js";
import { encodeBatchView, type BatchViewLimits } from "../protocol/batch-view.js";
import { batchViewPathAt, runnerViewPathAt } from "./paths.js";
import { replaceDerivedFile, type DurabilityObserver } from "./durable-fs.js";

/** Rebuildable output only. Neither a file nor its view marks mail presented.
 * Both host and single-file extension count the same UTF-8 source bytes using
 * the existing frameBytes/batchMaxMessages configuration, without new budgets.
 */
export function publishBatchView(stateRoot: string, batch: PreparedBatch, limits?: BatchViewLimits, faults?: DurabilityObserver): void {
  const json = encodeBatchView(batch, limits);
  const lines = [`# inbox — ${batch.agent}`, "", `Delivery batch${batch.id} (incarnation ${batch.incarnation})`, "",
    ...batch.messageIds.map((id, index) => `${index + 1}. ${id}\t${mailArchiveDisplayPath(id)}`), "", "Read: pass an id or path to oma_mail_read to see the sender's message body (cat shows the raw transfer-encoded message)"];
  replaceDerivedFile(batchViewPathAt(stateRoot, batch.agent, batch.id), json, 0o600, faults);
  replaceDerivedFile(join(runnerViewPathAt(stateRoot, batch.agent), "inbox.md"), `${lines.join("\n")}\n`, 0o444, faults);
}
