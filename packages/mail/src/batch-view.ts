import type { MessageId, PreparedBatch, BatchViewDocuments } from "@oma/contracts";
import type { ReviewMailMeta } from "@oma/contracts/durable";
import { mailArchiveDisplayPath } from "@oma/domain/derived";
import { encodeBatchView, type BatchViewLimits } from "@oma/protocol/batch-view";

/** Rebuildable output only. Neither a file nor its view marks mail presented.
 * Both host and single-file extension count the same UTF-8 source bytes using
 * the existing frameBytes/batchMaxMessages configuration, without new budgets.
 */
/** Display details the index needs about one message: its review role (to fold
 * thread revisions of one request) and the path it is read back under. */
export interface BatchMessageInfo {
  readonly review: ReviewMailMeta | undefined;
  readonly displayPath: string;
}

/** mail-v1 (spec §6): a batch can hold several revisions of one review
 * thread. The index lists the latest in place and names the earlier ones on
 * its row -- every message id still appears, but "the thread has a newer
 * revision" is visible rather than buried. Folding changes the view only;
 * batch manifest, notice and delivery facts are untouched. */
function earlierLines(ids: readonly MessageId[], infoOf?: (id: MessageId) => BatchMessageInfo | null): {
  readonly demoted: ReadonlySet<MessageId>;
  readonly earlier: ReadonlyMap<MessageId, readonly BatchMessageInfo[]>;
} {
  if (infoOf === undefined) return { demoted: new Set(), earlier: new Map() };
  const infos = ids.map(id => ({ id, info: infoOf(id) }));
  const groups = new Map<string, { id: MessageId; revision: number; info: BatchMessageInfo }[]>();
  for (const { id, info } of infos) {
    if (info?.review?.role !== "thread") continue;
    const request = info.review.request;
    const group = groups.get(request) ?? [];
    group.push({ id, revision: info.review.revision, info });
    groups.set(request, group);
  }
  const demoted = new Set<MessageId>();
  const earlier = new Map<MessageId, readonly BatchMessageInfo[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.revision - b.revision);
    const latest = ordered.at(-1)!;
    earlier.set(latest.id, ordered.slice(0, -1).map(member => member.info));
    for (const member of ordered.slice(0, -1)) demoted.add(member.id);
  }
  return { demoted, earlier };
}

export function renderBatchView(batch: PreparedBatch, limits?: BatchViewLimits,
  infoOf?: (id: MessageId) => BatchMessageInfo | null): BatchViewDocuments {
  const json = encodeBatchView(batch, limits);
  const { demoted, earlier } = earlierLines(batch.messageIds, infoOf);
  const lines = [`# inbox — ${batch.agent}`, "", `Delivery batch${batch.id} (incarnation ${batch.incarnation})`, ""];
  let index = 0;
  for (const id of batch.messageIds) {
    if (demoted.has(id)) continue;
    index += 1;
    const prior = earlier.get(id);
    // The audience-aware path: a workers-only thread message is not at the
    // public archive path the id alone would suggest.
    const info = infoOf?.(id);
    lines.push(`${index}. ${id}\t${info?.displayPath ?? mailArchiveDisplayPath(id)}` +
      (prior === undefined ? ""
        : `\t earlier revisions: ${prior.map(member => member.displayPath).join(", ")}`));
  }
  lines.push("", "Read: pass an id or path to oma_mail_read to see the sender's message body (cat shows the raw transfer-encoded message)");
  return { json, index: `${lines.join("\n")}\n` };
}
