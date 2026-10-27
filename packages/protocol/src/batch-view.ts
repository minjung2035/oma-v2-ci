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
