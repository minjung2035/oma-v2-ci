// MUST [ID-001..003]: cryptographic identity creation.
// Grammar/brands live in the pure identifier owner; derived names have one owner.
import { randomUUID } from "node:crypto";
import {
  parseOperationId, parseBatchId,
  type OperationId, type BatchId,
} from "@oma/domain/identifiers";


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
