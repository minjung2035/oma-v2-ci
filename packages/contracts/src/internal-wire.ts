/** TS-001: internal-wire contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Failure } from "./errors.js";
import type { Actor, BatchId, Json } from "./identity.js";
import type { BoundaryEvidence, PreparedBatch, RunLease } from "./runtime.js";
import type { BlobDescriptor } from "./values.js";

export interface InternalMethods {
  'runner.open': { agent: Actor; invocationId: string };
  'runner.pending': Record<string, never>;
  'batch.prepare': Record<string, never>;
  'batch.read': { batchId: BatchId };
  'batch.complete': BoundaryEvidence;
  'runner.observe': { reason: string; toolName?: string; observedAtMs: number };
  'principal.attach': { sessionHandle: string; credential: string };
  'principal.detach': Record<string, never>;
}

export interface InternalResults {
  'runner.open': RunLease;
  'runner.pending': { pending: number; recoverableBatchIds: BatchId[] };
  'batch.prepare': PreparedBatch | null;
  'batch.read': PreparedBatch;
  'batch.complete': { completed: true };
  'runner.observe': { accepted: true };
  'principal.attach': { actor: 'principal'; incarnation: number };
  'principal.detach': { detached: true };
}

export type InternalRequest<M extends keyof InternalMethods = keyof InternalMethods> =
  M extends keyof InternalMethods ? { v: 1; id: string; method: M; params: InternalMethods[M] } : never;

export type InternalResponse<M extends keyof InternalMethods = keyof InternalMethods> =
  { v: 1; id: string; ok: true; result: InternalResults[M] } |
  { v: 1; id: string; ok: false; error: Failure };

export type Notification = { v: 1; event: 'mail_available' | 'run_revoked' };


