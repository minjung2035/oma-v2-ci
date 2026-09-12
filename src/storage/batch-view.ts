import { join } from "node:path";
import type { PreparedBatch } from "../../implementation/contracts.js";
import { mailArchiveDisplayPath } from "../domain/derived.js";
import { batchViewOf } from "../mail/batch-policy.js";
import { batchViewPathAt, runnerViewPathAt } from "./paths.js";
import { replaceDerivedFile } from "./durable-fs.js";

/** Rebuildable output only: this function cannot mark a message presented. */
export function publishBatchView(stateRoot: string, batch: PreparedBatch): void {
  replaceDerivedFile(batchViewPathAt(stateRoot, batch.agent, batch.id), JSON.stringify(batchViewOf(batch)));
  const lines = [`# inbox — ${batch.agent}`, "", `안내 batch ${batch.id} (incarnation ${batch.incarnation})`, "",
    ...batch.messageIds.map((id, index) => `${index + 1}. ${id}\t${mailArchiveDisplayPath(id)}`), "", "읽기: cat <위 archive path>"];
  replaceDerivedFile(join(runnerViewPathAt(stateRoot, batch.agent), "inbox.md"), `${lines.join("\n")}\n`, 0o444);
}
