/** ERR-001/002: pure error vocabulary. No Store, filesystem or process dependency. */
import type { ErrorCode, Failure } from "../../implementation/contracts.js";

export class StoreError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
  }
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

/** satisfies makes adding a public ErrorCode without policy a compile error. */
export const ERROR_METADATA = Object.freeze({
  INVALID_REQUEST: meta("input"), UNSUPPORTED_VERSION: meta("input"),
  UNKNOWN_METHOD: meta("input"), FRAME_TOO_LARGE: meta("input"),
  STREAM_INVALID: meta("input", "none", 2, true),
  AUTH_FAILED: meta("authority"), STALE_RUN: meta("authority", "run"),
  CAPABILITY_DENIED: meta("authority"), REQUEST_KEY_REUSED: meta("conflict", "operation"),
  REQUEST_NOT_FOUND: meta("input"), ADDRESS_NOT_FOUND: meta("input"),
  AGENT_CONFLICT: meta("conflict"), AGENT_NOT_READY: meta("conflict"),
  AGENT_RETIRED: meta("conflict"), GOAL_REQUIRED: meta("input"),
  LIMIT_EXCEEDED: meta("resource", "none", 2, true),
  STORAGE_FULL: meta("resource", "none", 2, true),
  DB_BUSY: meta("transient", "none", 3), STORE_CORRUPT: meta("integrity", "store"),
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
  INTERNAL_ERROR: meta("internal", "operation"),
} satisfies Record<ErrorCode, ErrorMetadata>);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_METADATA, value);
}
export function isPreacceptOnlyFailure(code: ErrorCode): boolean {
  return ERROR_METADATA[code].preacceptOnly;
}

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
  /** null means no new terminal transition (including preserving pending). */
  readonly terminal: "failed" | "unknown" | null;
  readonly lookupSameKey: boolean;
  /** Only explicit preaccept REQUEST_NOT_FOUND can permit a frozen resend. */
  readonly resendFrozen: boolean;
  readonly reconcile: "none" | "observe" | "reconcile" | "repair";
  readonly blockScope: MutationBlockScope;
}

export function classifyError(context: ErrorContext): ErrorPolicy {
  const { code, phase, effectKnowledge, observationKind } = context;
  const metadata = ERROR_METADATA[code];
  const base: ErrorPolicy = {
    code, terminal: null, lookupSameKey: true, resendFrozen: false,
    reconcile: "none", blockScope: metadata.scope,
  };
  // No error policy is permission to mutate an already terminal operation.
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
    return {
      ...base,
      terminal: effectKnowledge === "none" ? null : "unknown",
      reconcile: effectKnowledge === "none" ? "observe" : "reconcile",
    };
  }
  if (effectKnowledge !== "none" || metadata.category === "ambiguous") {
    return { ...base, terminal: "unknown", reconcile: "reconcile", blockScope: metadata.scope === "none" ? "operation" : metadata.scope };
  }
  return { ...base, terminal: "failed" };
}

/** A failed durable receipt is terminal. same-key lookup is not effect replay. */
export function terminalFailure(code: ErrorCode): Failure {
  return { code, message: code, retry: "never" };
}

/** Public errors do not expose arbitrary exception/provider/private-payload text. */
export function publicFailure(error: unknown, context?: Omit<ErrorContext, "code">): Failure {
  const code = error instanceof StoreError ? error.code : "INTERNAL_ERROR";
  const policy = context ? classifyError({ ...context, code }) : null;
  const retry = policy?.reconcile === "repair" ? "after-repair" :
    policy?.lookupSameKey && (policy.reconcile === "observe" || policy.reconcile === "reconcile" || policy.resendFrozen) ? "same-key" : "never";
  return { code: policy?.code ?? code, message: policy?.code ?? code, retry };
}

export type CliExitCode = 0 | 2 | 3 | 4;
export function errorExit(code: ErrorCode): Exclude<CliExitCode, 0> {
  return ERROR_METADATA[code].cliExit;
}
