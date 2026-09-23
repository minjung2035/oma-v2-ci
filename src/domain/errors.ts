/** ERR-001/002: pure error vocabulary. No Store, filesystem or process dependency. */
import type { ErrorCode, Failure } from "../../implementation/contracts/errors.js";

export class StoreError extends Error {
  constructor(readonly code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
  }
}
/** Normalize native storage exhaustion without interpreting operation phase.
 * SQLite's primary result code 13 is SQLITE_FULL (extended codes retain it). */
export function normalizeStorageFailure(error: unknown): unknown {
  if (error instanceof StoreError || error === null || typeof error !== "object") return error;
  // Owned-temporary cleanup can also fail. Preserve the primary effect's meaning
  // and retain the whole aggregate as cause; a secondary ENOSPC cannot erase corruption.
  const primary: unknown = error instanceof AggregateError ? error.errors[0] : error;
  if (primary instanceof StoreError) return new StoreError(primary.code, primary.message, { cause: error });
  if (primary === null || typeof primary !== "object") return error;
  const code = "code" in primary ? primary.code : undefined;
  const sqliteFull = code === "ERR_SQLITE_ERROR" && "errcode" in primary &&
    typeof primary.errcode === "number" && Number.isInteger(primary.errcode) && (primary.errcode & 0xff) === 13;
  if (code === "ENOSPC" || code === "EDQUOT" || code === "SQLITE_FULL" || sqliteFull)
    return new StoreError("STORAGE_FULL", "durable storage is exhausted", { cause: error });
  return error;
}
export function errorCodeOf(error: unknown): ErrorCode {
  const normalized = normalizeStorageFailure(error);
  return normalized instanceof StoreError ? normalized.code : "INTERNAL_ERROR";
}

export type MutationBlockScope = "none" | "operation" | "run" | "repository" | "store";
type Category = "input" | "authority" | "conflict" | "resource" | "transient" | "integrity" | "ambiguous" | "unsupported" | "internal";
interface ErrorMetadata {
  readonly category: Category;
  readonly scope: MutationBlockScope;
  readonly preacceptOnly: boolean;
  readonly cliExit: 2 | 3 | 4;
}
const meta = (category: Category, scope: MutationBlockScope = "none", cliExit: 2 | 3 | 4 = 2, preacceptOnly = false): ErrorMetadata =>
  Object.freeze({ category, scope, cliExit, preacceptOnly });

/** A new public ErrorCode without metadata is a type error. No wire code is added. */
export const ERROR_METADATA = Object.freeze({
  INVALID_REQUEST: meta("input"), UNSUPPORTED_VERSION: meta("input"),
  UNKNOWN_METHOD: meta("input"), FRAME_TOO_LARGE: meta("input"),
  STREAM_INVALID: meta("input", "none", 2, true),
  AUTH_FAILED: meta("authority"), STALE_RUN: meta("authority", "run"),
  CAPABILITY_DENIED: meta("authority"), REQUEST_KEY_REUSED: meta("conflict", "operation"),
  REQUEST_NOT_FOUND: meta("input"), ADDRESS_NOT_FOUND: meta("input"),
  AGENT_CONFLICT: meta("conflict"), AGENT_NOT_READY: meta("conflict"),
  AGENT_RETIRED: meta("conflict"), GOAL_REQUIRED: meta("input"),
  LIMIT_EXCEEDED: meta("resource", "none", 2, true), STORAGE_FULL: meta("resource", "none", 2, true),
  DB_BUSY: meta("transient", "none", 3), STORE_CORRUPT: meta("integrity", "store", 3),
  BROKER_UNAVAILABLE: meta("transient", "none", 3), DEADLINE_EXCEEDED: meta("transient", "operation", 3),
  RUN_TERMINATION_UNKNOWN: meta("ambiguous", "run", 3), START_LIMIT: meta("conflict", "run"),
  PRINCIPAL_DISCONNECTED: meta("transient", "none", 3), ATTACH_CONFLICT: meta("conflict"),
  BATCH_CONFLICT: meta("conflict", "operation"), SESSION_BOUNDARY_UNCONFIRMED: meta("ambiguous", "operation", 3),
  INVALID_OID: meta("input"), CANDIDATE_NOT_PUBLISHED: meta("input"), BUNDLE_INVALID: meta("input"),
  PREREQUISITE_MISSING: meta("input"), PUBLISHED_REF_CONFLICT: meta("conflict", "repository"),
  STALE_BASE: meta("conflict"), NOT_DESCENDANT: meta("input"), PROTECTED_PATH: meta("authority"),
  CHECK_FAILED: meta("input"), POLICY_CHANGED: meta("conflict"),
  REF_STATE_UNKNOWN: meta("ambiguous", "repository", 3), CANCELLED_BEFORE_COMMIT: meta("conflict"),
  CONTEXT_CONFLICT: meta("conflict", "repository"), QUOTA_EXCEEDED: meta("resource"),
  PROVIDER_FAILED: meta("input"), PROVIDER_OUTCOME_UNKNOWN: meta("ambiguous", "operation", 3),
  UNSUPPORTED_PROFILE: meta("unsupported", "none", 4), SPIKE_UNRESOLVED: meta("unsupported", "none", 4),
  INTERNAL_ERROR: meta("internal", "operation", 3),
} satisfies Record<ErrorCode, ErrorMetadata>);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_METADATA, value);
}
export function isPreacceptOnlyFailure(code: ErrorCode): boolean { return ERROR_METADATA[code].preacceptOnly; }
export type ErrorPhase = "preaccept" | "accepted" | "recovering" | "terminal";
export type EffectKnowledge = "none" | "possible" | "applied";
export type ObservationKind = "absent" | "present" | "rejected" | "unavailable" | "corrupt";
export interface ErrorContext {
  readonly code: ErrorCode;
  readonly phase: ErrorPhase;
  readonly effectKnowledge: EffectKnowledge;
  readonly observationKind: ObservationKind;
}
export interface ErrorPolicy {
  readonly code: ErrorCode;
  /** null means no new terminal transition, including preserving pending. */
  readonly terminal: "failed" | "unknown" | null;
  readonly lookupSameKey: boolean;
  readonly resendFrozen: boolean;
  readonly reconcile: "none" | "observe" | "reconcile" | "repair";
  readonly blockScope: MutationBlockScope;
}
export function classifyError(context: ErrorContext): ErrorPolicy {
  const { code, phase, effectKnowledge, observationKind } = context;
  const metadata = ERROR_METADATA[code];
  const base: ErrorPolicy = { code, terminal: null, lookupSameKey: true, resendFrozen: false, reconcile: "none", blockScope: metadata.scope };
  if (phase === "terminal") return base;
  if (phase === "preaccept") {
    return {
      ...base,
      resendFrozen: code === "REQUEST_NOT_FOUND" && observationKind === "absent" && effectKnowledge === "none",
      reconcile: observationKind === "corrupt" ? "repair" : observationKind === "unavailable" ? "observe" : "none",
    };
  }
  // Accepted body bytes are broker-owned recovery evidence, not another client stream.
  if (observationKind === "corrupt" || code === "STORE_CORRUPT" || code === "STREAM_INVALID") {
    return { ...base, code: "STORE_CORRUPT", reconcile: "repair", blockScope: metadata.scope === "repository" ? "repository" : "store" };
  }
  if (metadata.preacceptOnly || metadata.category === "transient" || observationKind === "unavailable") {
    return { ...base, terminal: effectKnowledge === "none" ? null : "unknown", reconcile: effectKnowledge === "none" ? "observe" : "reconcile" };
  }
  if (effectKnowledge !== "none" || metadata.category === "ambiguous" || metadata.category === "internal") {
    return { ...base, terminal: "unknown", reconcile: "reconcile", blockScope: metadata.scope === "none" ? "operation" : metadata.scope };
  }
  return { ...base, terminal: "failed" };
}
/** A coordinator's own statement that its operation committed before this
 * failure. The code stays the closed public code; no wire field is added. */
export class AcceptedFailure extends StoreError {
  constructor(code: ErrorCode, message: string, readonly effectKnowledge: EffectKnowledge, options?: ErrorOptions) {
    super(code, message, options);
  }
}
export function acceptedFailure(error: unknown, effectKnowledge: EffectKnowledge = "possible"): AcceptedFailure {
  if (error instanceof AcceptedFailure) return error;
  const normalized = normalizeStorageFailure(error);
  return normalized instanceof StoreError
    ? new AcceptedFailure(normalized.code, normalized.message, effectKnowledge, { cause: error })
    : new AcceptedFailure("INTERNAL_ERROR", "accepted operation failed", effectKnowledge, { cause: error });
}
/** A durable failed receipt is terminal; same-key lookup is never effect replay. */
export function terminalFailure(code: ErrorCode): Failure { return { code, message: code, retry: "never" }; }

/** Sanitize exceptions. Without admission evidence, do not invent acceptance or
 * absence; a coordinator's AcceptedFailure is that evidence. */
export function publicFailure(error: unknown, context?: Omit<ErrorContext, "code">): Failure {
  const code = errorCodeOf(error);
  const metadata = ERROR_METADATA[code];
  const observationKind: ObservationKind = metadata.category === "integrity" ? "corrupt" :
    metadata.category === "transient" || metadata.category === "ambiguous" || metadata.category === "internal" ? "unavailable" : "rejected";
  const fallback: Omit<ErrorContext, "code"> = error instanceof AcceptedFailure
    ? { phase: "accepted", effectKnowledge: error.effectKnowledge, observationKind }
    : { phase: "preaccept", effectKnowledge: "none", observationKind };
  const policy = classifyError({ ...(context ?? fallback), code });
  const retry = policy.reconcile === "repair" ? "after-repair" :
    policy.lookupSameKey && (policy.reconcile === "observe" || policy.reconcile === "reconcile" || policy.resendFrozen) ? "same-key" : "never";
  return { code: policy.code, message: policy.code, retry };
}
export type CliExitCode = 0 | 2 | 3 | 4;
/** Direct failures differ from authoritative terminal receipts, which exit 2 (or gate 4). */
export function errorExit(code: ErrorCode): Exclude<CliExitCode, 0> { return ERROR_METADATA[code].cliExit; }
