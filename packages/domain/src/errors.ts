/** ERR-001/002: pure error vocabulary. No Store, filesystem or process dependency. */
import type { ErrorCode, Failure } from "@oma/contracts/errors";
import { isCapability } from "./capabilities.js";
import { isValidFullOid, isValidMessageId, isValidWirePath, isReviewRequestName } from "./identifiers.js";

export class StoreError extends Error {
  /** DR3: facts this failure may tell its caller. `publicFailure` keeps only
   * what ERROR_DETAILS allows for the code, and drops everything else. */
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(readonly code: ErrorCode, message: string, options?: ErrorOptions & { readonly details?: Readonly<Record<string, unknown>> }) {
    super(message, options);
    this.name = "StoreError";
    if (options?.details !== undefined) this.details = options.details;
  }
}
/** Cleanup can fail beside an effect, but never replaces its first failure. */
export function primaryFailure(error: unknown): unknown {
  let primary = error;
  while (primary instanceof AggregateError && primary.errors.length > 0) primary = primary.errors[0];
  return primary;
}
/** Normalize native storage exhaustion without interpreting operation phase.
 * SQLite's primary result code 13 is SQLITE_FULL (extended codes retain it). */
export function normalizeStorageFailure(error: unknown): unknown {
  if (error instanceof StoreError || error === null || typeof error !== "object") return error;
  // Owned-temporary cleanup can also fail. Preserve the primary effect's meaning
  // and retain the whole aggregate as cause; a secondary ENOSPC cannot erase corruption.
  // P0V-33, P0-1: the primary is the first failure however deeply the cleanups
  // nest, and it is restated whole -- its code, the facts its code may carry and,
  // for a coordinator's AcceptedFailure, that the operation had been accepted
  // and what is known of its effect. A cleanup failing beside it changes none of that.
  const primary = primaryFailure(error);
  if (primary instanceof StoreError) return restated(primary, error);
  if (primary === null || typeof primary !== "object") return error;
  const code = "code" in primary ? primary.code : undefined;
  const sqlite = sqlitePrimaryCode(primary);
  if (code === "ENOSPC" || code === "EDQUOT" || code === "SQLITE_FULL" || sqlite === 13)
    return new StoreError("STORAGE_FULL", "durable storage is exhausted", { cause: error });
  // P0V-69, P0-5: what SQLite's own result code says, read here once for every
  // query, BEGIN, COMMIT and ROLLBACK. CORRUPT and NOTADB are the database file
  // saying it is not intact: an integrity observation, which closes new
  // acceptance. BUSY and LOCKED are contention. An I/O error, a file that could
  // not be opened, a read-only or refused file, or a broken lock protocol is an
  // observation that did not finish -- not proof of corruption.
  if (sqlite === 11 || sqlite === 26)
    return new StoreError("STORE_CORRUPT", `the database reports it is not intact (SQLite ${sqlite})`, { cause: error });
  if (sqlite === 5 || sqlite === 6) return new StoreError("DB_BUSY", "the database is busy", { cause: error });
  if (sqlite === 3 || sqlite === 8 || sqlite === 10 || sqlite === 14 || sqlite === 15)
    return new StoreError("BROKER_UNAVAILABLE", `durable storage cannot be observed now (SQLite ${sqlite})`, { cause: error });
  // R6-02: node:sqlite's own refusals, not SQLite's, belong to this table too.
  // An INTEGER it cannot hand over as a JavaScript number is a value this
  // product never writes (every integer field is a safe integer), so the file
  // saying it holds one is the file saying it is not intact. The driver's other
  // errors (ERR_INVALID_STATE for a closed database or finalized statement,
  // ERR_INVALID_ARG_* for a bad binding) are this process's mistakes, not the
  // file's, and stay what they are.
  if (sqliteValueOutOfRange(primary))
    return new StoreError("STORE_CORRUPT", "the database holds a value this product never writes", { cause: error });
  return error;
}
/** node:sqlite refusing to read an INTEGER outside the safe range. The code
 * is Node's general ERR_OUT_OF_RANGE, so the driver's own words are what tell
 * it from, say, a Buffer write out of range, which is no storage fact. */
export function sqliteValueOutOfRange(error: unknown): boolean {
  return error instanceof RangeError && (error as { code?: unknown }).code === "ERR_OUT_OF_RANGE" &&
    error.message.startsWith("Value is too large to be represented as a JavaScript number");
}
/** SQLite's primary result code (the extended code's low byte) of a native
 * SQLite error, or null for anything else. */
export function sqlitePrimaryCode(error: unknown): number | null {
  if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ERR_SQLITE_ERROR" || !("errcode" in error)) return null;
  return typeof error.errcode === "number" && Number.isInteger(error.errcode) ? error.errcode & 0xff : null;
}
/** Errno answers about a name itself: it is not there, or is not what a path
 * through it needs. The filesystem answered; the caller states what it means. */
const ANSWERED_ERRNO = new Set(["ENOENT", "ENOTDIR", "ELOOP", "EISDIR", "ENAMETOOLONG"]);
/** DR13, P0-5: the one reading of a local observation that failed. An OMA
 * failure, an answered errno (above) or bytes that were read and refused are
 * the caller's to state as a fact. Any other errno -- EACCES, EIO, EMFILE --
 * is an observation that did not answer: "cannot be observed now"
 * (BROKER_UNAVAILABLE, exit 3), never a changed, invalid, corrupt or
 * unsupported fact. null when the caller states it. */
export function unobserved(error: unknown, what: string): StoreError | null {
  if (error instanceof StoreError || error === null || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  if (typeof code !== "string" || !/^E[A-Z0-9]+$/.test(code) || ANSWERED_ERRNO.has(code)) return null;
  return new StoreError("BROKER_UNAVAILABLE", `${what} cannot be observed now (${code})`, { cause: error });
}
/** CONFIG-CONTRACT outcome-unconfirmed: the effect is visible -- the commit
 * point was passed -- and only its durability is not known. The one reading
 * of that fact for every caller; such a failure is never "nothing was saved". */
export function publishedUnconfirmed(error: unknown): boolean {
  return error instanceof StoreError && error.details?.publication === "unconfirmed";
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
  INTEGRATION_CONDITIONS: meta("authority"), CHECK_FAILED: meta("input"), POLICY_CHANGED: meta("conflict"),
  REF_STATE_UNKNOWN: meta("ambiguous", "repository", 3), CANCELLED_BEFORE_COMMIT: meta("conflict"),
  CONTEXT_CONFLICT: meta("conflict", "repository"),
  PROVIDER_FAILED: meta("input"), PROVIDER_OUTCOME_UNKNOWN: meta("ambiguous", "operation", 3),
  REQUEST_CLOSED: meta("conflict"), REQUEST_EXISTS: meta("conflict"), SELF_REVIEW: meta("authority"),
  APPROVAL_STALE: meta("conflict"), REVERT_CONFLICT: meta("conflict"),
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
  constructor(code: ErrorCode, message: string, readonly effectKnowledge: EffectKnowledge,
    options?: ErrorOptions & { readonly details?: Readonly<Record<string, unknown>> }) {
    super(code, message, options);
  }
}
/** A failure restated with another cause, as the same kind of failure. */
function restated(primary: StoreError, cause: unknown): StoreError {
  const options = { cause, ...(primary.details === undefined ? {} : { details: primary.details }) };
  return primary instanceof AcceptedFailure
    ? new AcceptedFailure(primary.code, primary.message, primary.effectKnowledge, options)
    : new StoreError(primary.code, primary.message, options);
}
export function acceptedFailure(error: unknown, effectKnowledge: EffectKnowledge = "possible"): AcceptedFailure {
  // P0V-64, P0-2: what the failure is, is read once -- from its normalized
  // form. An accepted failure a cleanup failure was bundled with is still
  // that accepted failure, with what is known of its effect.
  const normalized = normalizeStorageFailure(error);
  if (normalized instanceof AcceptedFailure) return normalized;
  return normalized instanceof StoreError
    // DR3: an accepted operation's failure keeps the facts its code may carry.
    ? new AcceptedFailure(normalized.code, normalized.message, effectKnowledge,
      { cause: error, ...(normalized.details === undefined ? {} : { details: normalized.details }) })
    : new AcceptedFailure("INTERNAL_ERROR", "accepted operation failed", effectKnowledge, { cause: error });
}
/** P0V-64, P0-2: how an accepted operation's failure settles, one reading for
 * every coordinator. Its code is the normalized failure's -- a refusal a
 * cleanup failure was bundled with is still that refusal -- and a stream found
 * invalid after acceptance is corrupt evidence, not a refusal. */
export function acceptedFailurePolicy(error: unknown, phase: ErrorPhase, effectKnowledge: EffectKnowledge): ErrorPolicy {
  const code = errorCodeOf(error);
  const category = ERROR_METADATA[code].category;
  return classifyError({ code, phase, effectKnowledge,
    observationKind: code === "STREAM_INVALID" || category === "integrity" ? "corrupt" :
      category === "transient" || category === "ambiguous" || category === "internal" ? "unavailable" : "rejected" });
}
/** A local exception's authored text for CLI and TUI presentation.
 * No platform vocabulary filter, logging effect or output-channel policy. */
export function exceptionText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The normalized failure's own message, or null for a failure OMA does not name. */
export function failureMessage(error: unknown): string | null {
  const normalized = normalizeStorageFailure(error);
  return normalized instanceof StoreError ? normalized.message : null;
}
/** A durable failed receipt is terminal; same-key lookup is never effect replay. */
export function terminalFailure(code: ErrorCode): Failure { return { code, message: code, retry: "never" }; }

/** Sanitize exceptions. Without admission evidence, do not invent acceptance or
 * absence; a coordinator's AcceptedFailure is that evidence. */
export function publicFailure(error: unknown, context?: Omit<ErrorContext, "code">): Failure {
  // P0V-64, P0-2: code, phase, effect and details all come from the one
  // normalized failure. Reading the phase and details from the raw error made
  // an accepted failure bundled with a cleanup failure public as a refusal
  // before acceptance, without its facts.
  const normalized = normalizeStorageFailure(error);
  const code: ErrorCode = normalized instanceof StoreError ? normalized.code : "INTERNAL_ERROR";
  const metadata = ERROR_METADATA[code];
  const observationKind: ObservationKind = metadata.category === "integrity" ? "corrupt" :
    metadata.category === "transient" || metadata.category === "ambiguous" || metadata.category === "internal" ? "unavailable" : "rejected";
  const fallback: Omit<ErrorContext, "code"> = normalized instanceof AcceptedFailure
    ? { phase: "accepted", effectKnowledge: normalized.effectKnowledge, observationKind }
    : { phase: "preaccept", effectKnowledge: "none", observationKind };
  const policy = classifyError({ ...(context ?? fallback), code });
  const retry = policy.reconcile === "repair" ? "after-repair" :
    policy.lookupSameKey && (policy.reconcile === "observe" || policy.reconcile === "reconcile" || policy.resendFrozen) ? "same-key" : "never";
  const details = normalized instanceof StoreError && normalized.code === policy.code ? publicDetails(policy.code, normalized.details) : undefined;
  return { code: policy.code, message: policy.code, retry, ...(details === undefined ? {} : { details }) };
}

type DetailCheck = (value: unknown) => boolean;
const FULL_OID_OR_NONE: DetailCheck = value => value === null || isValidFullOid(value);
/** DR3: what a failure may tell its caller, per code: the error table returns
 * the actual OID for STALE_BASE and NOT_DESCENDANT (AV28) and CTX-003 the
 * actual revision for CONTEXT_CONFLICT; a denied request names the capability
 * it needed; a broker that cannot take a request says whether it is busy or
 * draining. Every other code, and every other field, is dropped. */
export const ERROR_DETAILS: Readonly<Partial<Record<ErrorCode, Readonly<Record<string, DetailCheck>>>>> = Object.freeze({
  STALE_BASE: Object.freeze({ actual: FULL_OID_OR_NONE }),
  NOT_DESCENDANT: Object.freeze({ actual: FULL_OID_OR_NONE }),
  CONTEXT_CONFLICT: Object.freeze({ actual: FULL_OID_OR_NONE }),
  CAPABILITY_DENIED: Object.freeze({ capability: isCapability }),
  INTEGRATION_CONDITIONS: Object.freeze({
    effectiveTier: (value: unknown) => value === "LOW" || value === "MEDIUM" || value === "HIGH",
    missing: (value: unknown) => typeof value === "string" && value.length > 0,
  }),
  BROKER_UNAVAILABLE: Object.freeze({ reason: (value: unknown) => value === "busy" || value === "draining" }),
  REQUEST_CLOSED: Object.freeze({
    name: (value: unknown) => isReviewRequestName(value),
    state: (value: unknown) => value === "applied" || value === "cancelled" || value === "rejected" ||
      value === "stale" || value === "applying",
  }),
  REQUEST_EXISTS: Object.freeze({ name: (value: unknown) => isReviewRequestName(value) }),
  APPROVAL_STALE: Object.freeze({ current: (value: unknown) => value === null || isValidMessageId(value) }),
  REVERT_CONFLICT: Object.freeze({
    paths: (value: unknown) => Array.isArray(value) && value.every(item => isValidWirePath(item)),
    artifact: (value: unknown) => value === "none",
  }),
  // UX-09: an unsupported candidate names every gitlink path its tree carried;
  // the wire keeps only the names, never the authored sentence.
  UNSUPPORTED_PROFILE: Object.freeze({
    paths: (value: unknown) => Array.isArray(value) && value.every(item => isValidWirePath(item)),
  }),
});
/** The details a failure of this code may carry, exactly, or undefined. */
export function publicDetails(code: ErrorCode, details: unknown): { readonly [key: string]: string | null } | undefined {
  const schema = ERROR_DETAILS[code];
  if (schema === undefined || details === null || typeof details !== "object" || Array.isArray(details)) return undefined;
  const fields = Object.keys(schema); const given = details as Record<string, unknown>;
  if (Object.keys(given).length !== fields.length || !fields.every(field => Object.hasOwn(given, field) && schema[field]!(given[field])))
    return undefined;
  return Object.freeze(Object.fromEntries(fields.map(field => [field, given[field] as string | null])));
}

/** DR3: what each code means, in the words a caller is shown. The error
 * table's meaning column; the retry a caller takes comes from `retry`. */
export const ERROR_DESCRIPTIONS = Object.freeze({
  INVALID_REQUEST: "Invalid request format", UNSUPPORTED_VERSION: "Unsupported protocol version",
  UNKNOWN_METHOD: "Unknown method", FRAME_TOO_LARGE: "Request exceeds the frame limit",
  STREAM_INVALID: "Stream content does not match its declaration", AUTH_FAILED: "Could not authenticate the caller",
  STALE_RUN: "This run is no longer current (stopped, restarted, or retired)", CAPABILITY_DENIED: "Insufficient permission for this request",
  REQUEST_KEY_REUSED: "Request key was already used for a different request", REQUEST_NOT_FOUND: "No request was accepted under this key",
  ADDRESS_NOT_FOUND: "Address or agent not found", AGENT_CONFLICT: "An agent with this name exists with different settings",
  AGENT_NOT_READY: "Agent is not ready", AGENT_RETIRED: "Agent is retired",
  GOAL_REQUIRED: "The shared GOAL has not been published", LIMIT_EXCEEDED: "Input exceeds the declared limit",
  STORAGE_FULL: "Insufficient storage space", DB_BUSY: "Storage is temporarily busy",
  STORE_CORRUPT: "Mutations stopped due to a source integrity error; host recovery is required",
  BROKER_UNAVAILABLE: "The broker cannot process this request right now", DEADLINE_EXCEEDED: "The operation did not finish before its deadline",
  RUN_TERMINATION_UNKNOWN: "Could not confirm termination of the previous run", START_LIMIT: "Automatic restart limit reached; an explicit start is required",
  PRINCIPAL_DISCONNECTED: "The Principal UI is not connected", ATTACH_CONFLICT: "Another Principal session is already attached",
  BATCH_CONFLICT: "Batch ownership or content does not match", SESSION_BOUNDARY_UNCONFIRMED: "Insufficient evidence of delivery completion",
  INVALID_OID: "Invalid commit ID format", CANDIDATE_NOT_PUBLISHED: "Candidate is not published to the society",
  BUNDLE_INVALID: "Invalid Git bundle", PREREQUISITE_MISSING: "Required prerequisite commit is missing",
  PUBLISHED_REF_CONFLICT: "Published ref already points to a different value", STALE_BASE: "Main differs from expected; retry against actual",
  NOT_DESCENDANT: "Candidate is not a descendant of base (cannot fast-forward)", PROTECTED_PATH: "Candidate changes a protected path",
  INTEGRATION_CONDITIONS: "Integration approval conditions are not met", CHECK_FAILED: "Host checks did not pass", POLICY_CHANGED: "Host policy changed after acceptance",
  REF_STATE_UNKNOWN: "Cannot determine canonical ref state", CANCELLED_BEFORE_COMMIT: "Cancelled before commit",
  CONTEXT_CONFLICT: "Shared context differs from expected; retry against actual",
  PROVIDER_FAILED: "Model provider call failed", PROVIDER_OUTCOME_UNKNOWN: "Model provider outcome is unknown",
  UNSUPPORTED_PROFILE: "Configuration is unsupported by this deployment", SPIKE_UNRESOLVED: "Feature is blocked pending verification",
  REQUEST_CLOSED: "The merge or challenge request is closed", REQUEST_EXISTS: "A review request for this change already exists",
  SELF_REVIEW: "The requester or a submitter cannot vote on their own change", APPROVAL_STALE: "The named approval is no longer current",
  REVERT_CONFLICT: "The revert could not be built without conflicting changes",
  INTERNAL_ERROR: "Internal error",
} satisfies Record<ErrorCode, string>);
/** How a failure reads to its caller: the code, its words -- the authored text
 * a validation gave, or the table's -- and the facts its code may carry. */
export function failureText(failure: { readonly code: ErrorCode; readonly message: string; readonly details?: unknown }): string {
  const said = failure.message === failure.code ? ERROR_DESCRIPTIONS[failure.code] : failure.message;
  const facts = publicDetails(failure.code, failure.details);
  const shown = facts === undefined ? "" : ` (${Object.entries(facts).map(([field, value]) => `${field}: ${value ?? "none"}`).join(", ")})`;
  return `${failure.code}: ${said}${shown}`;
}
export type CliExitCode = 0 | 2 | 3 | 4;
/** Direct failures differ from authoritative terminal receipts, which exit 2 (or gate 4). */
/** CLI-003, DR13: 2 is a settled failure, 3 an outcome not yet known. A failure
 * the caller must look up again under the same key (or after a repair) may
 * stand accepted, so it is 3 whatever its code; only a profile/gate refusal
 * keeps its 4. A failure with nothing to look up has its code's exit. */
export function errorExit(code: ErrorCode, retry: Failure["retry"] = "never"): Exclude<CliExitCode, 0> {
  const exit = ERROR_METADATA[code].cliExit;
  return retry === "never" || exit === 4 ? exit : 3;
}
