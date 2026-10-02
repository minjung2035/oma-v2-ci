import type { PreparedBatch } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";

/** Input is the ledger's oldest-first sequence. Preserve order within each
 * established priority class; direct first, public second, then alternate.
 */
export function selectBatch<T>(pending: Iterable<{ value: T; publicList: boolean }>, maximum: number): T[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new StoreError("UNSUPPORTED_PROFILE", "batchMaxMessages must be a positive safe integer");
  const direct: T[] = [], publicList: T[] = [];
  for (const item of pending) {
    const target = item.publicList ? publicList : direct;
    if (target.length < maximum) target.push(item.value);
    if (direct.length === maximum && publicList.length === maximum) break;
  }
  if (direct.length === 0) return publicList;
  if (publicList.length === 0) return direct;
  if (maximum < 2) throw new StoreError("UNSUPPORTED_PROFILE", "batchMaxMessages must be at least 2 when both batch classes are pending");
  const output: T[] = [direct[0]!, publicList[0]!];
  let di = 1; let pi = 1; let takeDirect = true;
  while (output.length < maximum && (di < direct.length || pi < publicList.length)) {
    if (takeDirect && di < direct.length) output.push(direct[di++]!);
    else if (!takeDirect && pi < publicList.length) output.push(publicList[pi++]!);
    else if (di < direct.length) output.push(direct[di++]!);
    else output.push(publicList[pi++]!);
    takeDirect = !takeDirect;
  }
  return output;
}

export type BatchView = Pick<PreparedBatch, "id" | "agent" | "incarnation" | "deliveryMode" | "notice" | "messageIds">;
/** PreparedBatch is a host handoff. Session/index paths are never extension DTO fields. */
export function batchViewOf(batch: PreparedBatch): BatchView {
  return { id: batch.id, agent: batch.agent, incarnation: batch.incarnation,
    deliveryMode: batch.deliveryMode, notice: batch.notice, messageIds: [...batch.messageIds] };
}
