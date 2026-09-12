// MUST [ID-001..003]: compatibility facade plus random identity creation.
// Grammar/brands live in the pure identifier owner; derived names have one owner.
import { randomUUID } from "node:crypto";
import {
  parseOperationId, parseBatchId,
  type OperationId, type BatchId,
} from "./domain/identifiers.js";

export * from "./domain/identifiers.js";
export { messageIdForOperation as generateMessageId } from "./domain/derived.js";

/** MUST [ID-002]: lowercase UUIDv4, unchanged generation policy. */
export function uuidV4(): string {
  return randomUUID();
}

export function generateOperationId(): OperationId {
  const value = parseOperationId(`op-${uuidV4()}`);
  if (value === null) throw new Error("crypto returned a non-canonical UUIDv4");
  return value;
}

export function generateBatchId(): BatchId {
  const value = parseBatchId(`b-${uuidV4()}`);
  if (value === null) throw new Error("crypto returned a non-canonical UUIDv4");
  return value;
}
