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
  const lines = [`# inbox — ${batch.agent}`, "", `안내 batch ${batch.id} (incarnation ${batch.incarnation})`, "",
    ...batch.messageIds.map((id, index) => `${index + 1}. ${id}\t${mailArchiveDisplayPath(id)}`), "", "읽기: oma_mail_read 도구에 id나 path를 주면 보낸 사람이 쓴 본문을 보여 줍니다(cat은 전송 인코딩이 남은 원문)"];
  replaceDerivedFile(batchViewPathAt(stateRoot, batch.agent, batch.id), json, 0o600, faults);
  replaceDerivedFile(join(runnerViewPathAt(stateRoot, batch.agent), "inbox.md"), `${lines.join("\n")}\n`, 0o444, faults);
}
