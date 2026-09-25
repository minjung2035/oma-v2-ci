/** ERR-001/002: pure error vocabulary. No Store, filesystem or process dependency. */
import type { ErrorCode, Failure } from "../../implementation/contracts/errors.js";
import { isCapability } from "./capabilities.js";
import { isValidFullOid } from "./identifiers.js";

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
  constructor(code: ErrorCode, message: string, readonly effectKnowledge: EffectKnowledge,
    options?: ErrorOptions & { readonly details?: Readonly<Record<string, unknown>> }) {
    super(code, message, options);
  }
}
export function acceptedFailure(error: unknown, effectKnowledge: EffectKnowledge = "possible"): AcceptedFailure {
  if (error instanceof AcceptedFailure) return error;
  const normalized = normalizeStorageFailure(error);
  return normalized instanceof StoreError
    // DR3: an accepted operation's failure keeps the facts its code may carry.
    ? new AcceptedFailure(normalized.code, normalized.message, effectKnowledge,
      { cause: error, ...(normalized.details === undefined ? {} : { details: normalized.details }) })
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
  const details = error instanceof StoreError && error.code === policy.code ? publicDetails(policy.code, error.details) : undefined;
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
  BROKER_UNAVAILABLE: Object.freeze({ reason: (value: unknown) => value === "busy" || value === "draining" }),
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
  INVALID_REQUEST: "요청 형식이 맞지 않습니다", UNSUPPORTED_VERSION: "지원하지 않는 protocol 버전입니다",
  UNKNOWN_METHOD: "알 수 없는 method입니다", FRAME_TOO_LARGE: "요청이 frame 한도를 넘었습니다",
  STREAM_INVALID: "전송한 내용이 선언과 맞지 않습니다", AUTH_FAILED: "호출자 신원을 확인하지 못했습니다",
  STALE_RUN: "이 run은 더 이상 현재 run이 아닙니다(정지·재시작·폐기됨)", CAPABILITY_DENIED: "이 요청에 필요한 권한이 없습니다",
  REQUEST_KEY_REUSED: "같은 request key가 다른 요청에 이미 쓰였습니다", REQUEST_NOT_FOUND: "이 key로 접수된 요청이 없습니다",
  ADDRESS_NOT_FOUND: "그런 주소나 agent가 없습니다", AGENT_CONFLICT: "같은 이름의 agent가 다른 설정으로 있습니다",
  AGENT_NOT_READY: "agent가 아직 준비되지 않았습니다", AGENT_RETIRED: "은퇴한 agent입니다",
  GOAL_REQUIRED: "공유 GOAL이 아직 게시되지 않았습니다", LIMIT_EXCEEDED: "입력이 선언된 한도를 넘었습니다",
  STORAGE_FULL: "저장 공간이 부족합니다", DB_BUSY: "저장소가 잠시 바쁩니다",
  STORE_CORRUPT: "원본 무결성 오류로 변경이 멈췄습니다; host 복구가 필요합니다",
  BROKER_UNAVAILABLE: "broker가 지금 이 요청을 처리할 수 없습니다", DEADLINE_EXCEEDED: "기한 안에 끝나지 않았습니다",
  RUN_TERMINATION_UNKNOWN: "이전 실행의 종료를 확인하지 못했습니다", START_LIMIT: "systemd 시작 한도에 걸렸습니다; 명시적 start가 필요합니다",
  PRINCIPAL_DISCONNECTED: "Principal 화면이 연결되어 있지 않습니다", ATTACH_CONFLICT: "이미 다른 Principal 세션이 연결되어 있습니다",
  BATCH_CONFLICT: "batch의 소유나 내용이 맞지 않습니다", SESSION_BOUNDARY_UNCONFIRMED: "전달 완료의 증거가 충분하지 않습니다",
  INVALID_OID: "commit id 형식이 맞지 않습니다", CANDIDATE_NOT_PUBLISHED: "candidate가 society에 게시되어 있지 않습니다",
  BUNDLE_INVALID: "제출한 Git bundle이 올바르지 않습니다", PREREQUISITE_MISSING: "필요한 선행 commit이 없습니다",
  PUBLISHED_REF_CONFLICT: "게시 ref가 이미 다른 값을 가리킵니다", STALE_BASE: "main이 expected와 다릅니다; actual을 기준으로 다시 하세요",
  NOT_DESCENDANT: "candidate가 base의 후손이 아닙니다(fast-forward 불가)", PROTECTED_PATH: "보호 경로를 바꾸는 candidate입니다",
  CHECK_FAILED: "host 검사를 통과하지 못했습니다", POLICY_CHANGED: "접수 뒤 host 정책이 바뀌었습니다",
  REF_STATE_UNKNOWN: "canonical ref 상태를 확정할 수 없습니다", CANCELLED_BEFORE_COMMIT: "commit 전에 취소되었습니다",
  CONTEXT_CONFLICT: "공유 context가 expected와 다릅니다; actual을 기준으로 다시 하세요", QUOTA_EXCEEDED: "예산 한도를 넘었습니다",
  PROVIDER_FAILED: "모델 제공자 호출이 실패했습니다", PROVIDER_OUTCOME_UNKNOWN: "모델 제공자 호출의 결과가 불명확합니다",
  UNSUPPORTED_PROFILE: "이 배포가 지원하지 않는 설정입니다", SPIKE_UNRESOLVED: "아직 검증되지 않아 막혀 있는 기능입니다",
  INTERNAL_ERROR: "내부 오류입니다",
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
