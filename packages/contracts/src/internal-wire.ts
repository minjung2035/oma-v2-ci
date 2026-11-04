/** TS-001: internal-wire contract owner. Declarations only; wire/persisted v1 unchanged. */
import type { Failure } from "./errors.js";
import type { Actor, BatchId, Json } from "./identity.js";
import type { BatchCompletionInput, PreparedBatch, RunLease } from "./runtime.js";
import type { BlobDescriptor } from "./values.js";

export type HostControlParams =
  | { action: "inspect"; agent: Actor }
  | { action: "stop" | "release"; agent: Actor; key: string;
      expected: { incarnation: number; desired: "provisioning" | "enabled" | "stopped" | "retired"; control: string | null } }
  | { action: "society"; state: "open" | "closed"; key: string }
  | { action: "receipt"; key: string };
export type HostControlResult =
  | { kind: "status"; agent: Actor; desired: "provisioning" | "enabled" | "stopped" | "retired"; incarnation: number;
      registryObservedAtMs: number; control: { operation: string; actor: Actor; key: string; kind: "agent.start" | "agent.stop"; state: "pending" | "unknown" | "succeeded" | "failed" } | null;
      principalControl: { operation: string; key: string; kind: "agent.start" | "agent.stop"; state: "pending" | "unknown" | "succeeded" | "failed" } | null;
      execution: import("./runtime.js").ExecutionObservation | null; executionObservedAtMs: number; executionError: import("./errors.js").ErrorCode | null;
      termination: "confirmed-dead" | "unconfirmed"; terminationObservedAtMs: number; terminationError: import("./errors.js").ErrorCode | null }
  | { kind: "receipt"; key: string; receipt: import("./durable.js").Receipt | null };

export interface InternalMethods {
  'host.control': HostControlParams;
  'runner.open': { agent: Actor; invocationId: string };
  'runner.pending': Record<string, never>;
  'batch.prepare': Record<string, never>;
  'batch.read': { batchId: BatchId };
  'batch.complete': BatchCompletionInput;
  'runner.observe': { reason: string; toolName?: string; observedAtMs: number };
  'principal.attach': { sessionHandle: string; credential: string };
  'principal.detach': Record<string, never>;
}

export interface InternalResults {
  'host.control': HostControlResult;
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


