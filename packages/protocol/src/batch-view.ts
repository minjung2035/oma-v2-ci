import type { PreparedBatch } from "@oma/contracts/runtime";
import type { BatchViewLimits } from "@oma/contracts/host";
export type { BatchViewLimits } from "@oma/contracts/host";
import {
  isValidActor,
  isValidBatchId,
  isValidMessageId,
} from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";

export type BatchView = Pick<
  PreparedBatch,
  "id" | "agent" | "incarnation" | "deliveryMode" | "notice" | "messageIds"
>;
/** Trusted preparation context for the full private RPC result, never a model field. */
export interface BatchReplyBudget {
  readonly responseId: string;
  readonly frameBytes: number;
  readonly noticeBytes?: number;
}
export function batchReplyBytes(batch: PreparedBatch, responseId: string): number {
  return Buffer.byteLength(JSON.stringify({ v: 1, id: responseId, ok: true, result: batch }));
}
export function batchReplyNoticeBudget(batch: PreparedBatch, limits: BatchViewLimits | undefined,
  reply?: BatchReplyBudget): number | null {
  const view = batchViewNoticeBudget(batch, limits);
  if (view === null || reply === undefined) return view;
  if (!Number.isSafeInteger(reply.frameBytes) || reply.frameBytes < 1 ||
      (reply.noticeBytes !== undefined && (!Number.isSafeInteger(reply.noticeBytes) || reply.noticeBytes < 0)))
    throw new StoreError("INTERNAL_ERROR", "invalid trusted batch reply budget");
  return Math.min(view, reply.frameBytes - batchReplyBytes({ ...batch, notice: "" }, reply.responseId) + 2);
}
export function validBatchViewLimits(
  limits: BatchViewLimits | undefined,
): limits is BatchViewLimits {
  return (
    limits !== undefined &&
    Number.isSafeInteger(limits.frameBytes) &&
    limits.frameBytes > 0 &&
    Number.isSafeInteger(limits.batchMaxMessages) &&
    limits.batchMaxMessages > 0
  );
}
/** R28/AUD-08: the notice room a producer may be *required* to emit even when
 * every value is elided -- the redelivery line, the elision marker and the
 * index pointer. The mail producer elides item rows down to this remainder
 * rather than letting a frame refuse a batch, and a `mail` test pins the
 * actual wording inside this allowance. */
export const MIN_BATCH_VIEW_NOTICE_BYTES = 256;
/** R28/AUD-08: the smallest configured frame that can carry one complete
 * private batch reply -- identity, one manifest id and the notice
 * remainder above, with worst-case identifier lengths. Below this no batch
 * could ever be prepared, so a consumer configuration with a smaller
 * `limits.frameBytes` is refused at validation. Larger manifests and notices
 * are the producer's to page and elide; this is only the codec's floor. */
export const MIN_BATCH_VIEW_FRAME_BYTES: number = batchReplyBytes(
  {
    id: `b-${"f".repeat(36)}`,
    agent: "a".repeat(32),
    incarnation: Number.MAX_SAFE_INTEGER,
    deliveryMode: "followUp",
    notice: "x".repeat(MIN_BATCH_VIEW_NOTICE_BYTES),
    messageIds: [`m-${"f".repeat(36)}-${String(Number.MAX_SAFE_INTEGER)}`],
    sessionPath: null, indexPath: "/inbox.md",
  }, `rpc-${"f".repeat(36)}`,
);
/** R28/AUD-08: the JSON-escaped UTF-8 bytes `limits.frameBytes` can still
 * spend on this exact view's notice once its fixed fields (identity, mode and
 * the manifest above) are accounted for. A producer that keeps
 * `Buffer.byteLength(JSON.stringify(notice))` within the budget keeps the
 * whole view within the frame, whatever the notice says. Null when no lawful
 * view limits are configured. */
export function batchViewNoticeBudget(
  batch: Pick<
    PreparedBatch,
    "id" | "agent" | "incarnation" | "deliveryMode" | "messageIds"
  >,
  limits: BatchViewLimits | undefined,
): number | null {
  if (!validBatchViewLimits(limits)) return null;
  const withoutNotice = JSON.stringify({
    id: batch.id,
    agent: batch.agent,
    incarnation: batch.incarnation,
    deliveryMode: batch.deliveryMode,
    notice: "",
    messageIds: [...batch.messageIds],
  });
  // The empty notice value costs two bytes (`""`); every escaped byte the
  // real notice adds from there must stay within the frame's remainder.
  return limits.frameBytes - Buffer.byteLength(withoutNotice) + 2;
}
/** The one six-field projection used by the host and isolated extension.
 * Both source JSON and notice use UTF-8 bytes, never UTF-16 string length.
 */
export function decodeBatchView(
  value: unknown,
  expectedId: string,
  limits: BatchViewLimits,
): BatchView | null {
  if (
    !validBatchViewLimits(limits) ||
    !isValidBatchId(expectedId) ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return null;
  const item = value as Record<string, unknown>;
  const keys = [
    "id",
    "agent",
    "incarnation",
    "deliveryMode",
    "notice",
    "messageIds",
  ];
  if (
    Object.keys(item).length !== keys.length ||
    Object.keys(item).some((key) => !keys.includes(key)) ||
    item.id !== expectedId ||
    typeof item.agent !== "string" ||
    // PR-002: a batch is delivered to a Resident or to the Principal. Every
    // other reserved name -- a list, a topic, a host unit -- is an address,
    // never a recipient of a delivery.
    !isValidActor(item.agent) ||
    typeof item.incarnation !== "number" ||
    !Number.isSafeInteger(item.incarnation) ||
    item.incarnation < 0 ||
    (item.deliveryMode !== "steer" && item.deliveryMode !== "followUp") ||
    typeof item.notice !== "string" ||
    Buffer.byteLength(item.notice) > limits.frameBytes ||
    !Array.isArray(item.messageIds) ||
    item.messageIds.length > limits.batchMaxMessages ||
    item.messageIds.some(
      (id) => typeof id !== "string" || !isValidMessageId(id),
    ) ||
    new Set(item.messageIds).size !== item.messageIds.length
  )
    return null;
  return {
    id: expectedId,
    agent: item.agent,
    incarnation: item.incarnation,
    deliveryMode: item.deliveryMode,
    notice: item.notice,
    messageIds: [...item.messageIds] as string[],
  };
}
export function decodeBatchViewText(
  text: string,
  expectedId: string,
  limits: BatchViewLimits,
): BatchView | null {
  if (
    !validBatchViewLimits(limits) ||
    Buffer.byteLength(text) > limits.frameBytes
  )
    return null;
  try {
    return decodeBatchView(JSON.parse(text), expectedId, limits);
  } catch {
    return null;
  }
}
export function encodeBatchView(
  batch: PreparedBatch,
  limits: BatchViewLimits | undefined,
): string {
  if (!validBatchViewLimits(limits))
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "batch views require configured frame and manifest limits",
    );
  const view = {
    id: batch.id,
    agent: batch.agent,
    incarnation: batch.incarnation,
    deliveryMode: batch.deliveryMode,
    notice: batch.notice,
    messageIds: [...batch.messageIds],
  };
  if (!decodeBatchView(view, batch.id, limits))
    throw new StoreError(
      "INVALID_REQUEST",
      "batch view identity, shape or notice bound is invalid",
    );
  const text = JSON.stringify(view);
  if (Buffer.byteLength(text) > limits.frameBytes)
    throw new StoreError(
      "LIMIT_EXCEEDED",
      "batch view source exceeds the configured frame bound",
    );
  return text;
}
