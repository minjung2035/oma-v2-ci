/** Physical writes only; Mail owns the one batch JSON/index renderer. */
import {join} from "node:path";
import type {PreparedBatch, BatchViewDocuments} from "@oma/contracts";
import {batchViewPathAt,runnerViewPathAt} from "@oma/domain/paths";
import {replaceDerivedFile,type DurabilityObserver} from "./durable-fs.js";

export function publishBatchView(stateRoot: string, batch: PreparedBatch, documents: BatchViewDocuments,
    faults?: DurabilityObserver): void {
  replaceDerivedFile(batchViewPathAt(stateRoot,batch.agent,batch.id),documents.json,0o600,faults);
  replaceDerivedFile(join(runnerViewPathAt(stateRoot,batch.agent),"inbox.md"),documents.index,0o444,faults);
}
