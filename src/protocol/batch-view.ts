import type { PreparedBatch, ProtocolLimits } from "../../implementation/contracts.js";
import { isValidActorName, isValidBatchId, isValidMessageId } from "../ids.js";
import { StoreError } from "../domain/errors.js";

export type BatchView = Pick<PreparedBatch, "id" | "agent" | "incarnation" | "deliveryMode" | "notice" | "messageIds">;
export type BatchViewLimits = Pick<ProtocolLimits, "frameBytes" | "batchMaxMessages">;
export function validBatchViewLimits(limits: BatchViewLimits | undefined): limits is BatchViewLimits {
  return limits !== undefined && Number.isSafeInteger(limits.frameBytes) && limits.frameBytes > 0 &&
    Number.isSafeInteger(limits.batchMaxMessages) && limits.batchMaxMessages > 0;
}
/** This six-field projection is mirrored in the single-file Pi extension.
 * Equivalence is tested independently; no host/runtime imports enter that file.
 * Both source JSON and notice use UTF-8 bytes, never UTF-16 string length.
 */
export function decodeBatchView(value: unknown, expectedId: string, limits: BatchViewLimits): BatchView | null {
  if (!validBatchViewLimits(limits) || !isValidBatchId(expectedId) || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keys = ["id", "agent", "incarnation", "deliveryMode", "notice", "messageIds"];
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key)) ||
    item.id !== expectedId || typeof item.agent !== "string" || !isValidActorName(item.agent) ||
    typeof item.incarnation !== "number" || !Number.isSafeInteger(item.incarnation) || item.incarnation < 0 ||
    (item.deliveryMode !== "steer" && item.deliveryMode !== "followUp") || typeof item.notice !== "string" ||
    Buffer.byteLength(item.notice) > limits.frameBytes || !Array.isArray(item.messageIds) || item.messageIds.length > limits.batchMaxMessages ||
    item.messageIds.some(id => typeof id !== "string" || !isValidMessageId(id)) || new Set(item.messageIds).size !== item.messageIds.length) return null;
  return { id: expectedId, agent: item.agent, incarnation: item.incarnation,
    deliveryMode: item.deliveryMode, notice: item.notice, messageIds: [...item.messageIds] as string[] };
}
export function decodeBatchViewText(text: string, expectedId: string, limits: BatchViewLimits): BatchView | null {
  if (!validBatchViewLimits(limits) || Buffer.byteLength(text) > limits.frameBytes) return null;
  try { return decodeBatchView(JSON.parse(text), expectedId, limits); } catch { return null; }
}
export function encodeBatchView(batch: PreparedBatch, limits: BatchViewLimits | undefined): string {
  if (!validBatchViewLimits(limits)) throw new StoreError("UNSUPPORTED_PROFILE", "batch views require configured frame and manifest limits");
  const view = { id: batch.id, agent: batch.agent, incarnation: batch.incarnation,
    deliveryMode: batch.deliveryMode, notice: batch.notice, messageIds: [...batch.messageIds] };
  if (!decodeBatchView(view, batch.id, limits)) throw new StoreError("INVALID_REQUEST", "batch view identity, shape or notice bound is invalid");
  const text = JSON.stringify(view);
  if (Buffer.byteLength(text) > limits.frameBytes) throw new StoreError("LIMIT_EXCEEDED", "batch view source exceeds the configured frame bound");
  return text;
}
