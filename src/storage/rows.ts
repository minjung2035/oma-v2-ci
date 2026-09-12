/** DB-009/M-003: pure full-row decoders. Projections have separate decoders;
 * absent columns are never filled, persisted JSON is never repaired or rehashed.
 * Cross-row ownership is checked by the Store's bounded relational queries.
 */
import type { ResolvedAgentSpec } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { resolvedSpecCheck } from "../durable.js";
import { resolvedSpecDigest } from "../domain/spec-identity.js";
import {
  isValidActor, isValidActorName, isValidTopicName, isValidRequestKey,
  isValidOperationId, isValidMessageId, isValidBatchId, parseMessageId,
} from "../domain/identifiers.js";

export interface AgentRow {
  name: string; specHash: string; role: "resident" | "principal";
  desired: "provisioning" | "enabled" | "stopped" | "retired";
  incarnation: number; profile: string; createdBy: string | null; specJson: string;
  createdAtMs: number; updatedAtMs: number;
}
export interface SubscriptionRow { topic: string; agent: string; createdAtMs: number }
export interface DeliveryRow {
  messageId: string; recipient: string; operationId: string; materialized: 0 | 1;
  batchId: string | null; presented: 0 | 1; acknowledged: 0 | 1; createdAtMs: number;
  materializedAtMs: number | null; presentedAtMs: number | null; acknowledgedAtMs: number | null;
}
export interface BatchRow {
  id: string; agent: string; incarnation: number; messageIdsJson: string;
  sessionPath: string | null; state: "prepared" | "completed"; createdAtMs: number; completedAtMs: number | null;
}
export interface UsageRow {
  requestId: string; actor: string; incarnation: number; profile: string; pricingRevision: string;
  reservedUnits: number; reportedUnits: number | null; outcome: "reserved" | "completed" | "cancelled" | "unknown";
  detailsJson: string | null; createdAtMs: number; updatedAtMs: number;
}

export function rowCorrupt(message: string): never { throw new StoreError("STORE_CORRUPT", message); }
export function fullRow(value: unknown, keys: readonly string[], entity: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return rowCorrupt(`${entity} row is not an object`);
  const row = value as Record<string, unknown>; // shape only; every field remains unknown
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)))
    return rowCorrupt(`${entity} row has missing or unknown columns`);
  return row;
}
export function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return rowCorrupt(`${label} is not a safe integer in range`);
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\0\p{Cs}]/u.test(value)) return rowCorrupt(`${label} is not a nonempty valid string`);
  return value;
}
function identity<T extends string>(value: unknown, guard: (value: unknown) => value is T, label: string): T {
  if (!guard(value)) return rowCorrupt(`invalid ${label}`);
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  for (const candidate of allowed) if (candidate === value) return candidate;
  return rowCorrupt(`invalid ${label}`);
}
function flag(value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) return rowCorrupt(`invalid ${label} flag`);
  return value;
}
function optionalTime(value: unknown, label: string, created: number): number | null {
  return value === null ? null : safeInteger(value, label, created);
}
function parseJson(value: string, label: string): unknown {
  try { return JSON.parse(value); } catch { return rowCorrupt(`${label} is not valid JSON`); }
}
export function decodeAgentSpec(specJson: string): ResolvedAgentSpec {
  const parsed = parseJson(specJson, "agent spec");
  const invalid = resolvedSpecCheck(parsed);
  if (invalid) return rowCorrupt(`invalid frozen agent spec: ${invalid}`);
  return parsed as ResolvedAgentSpec; // audited narrowing after closed runtime validation
}

export function decodeAgentRow(value: unknown): AgentRow {
  const raw = fullRow(value, ["name", "spec_hash", "role", "desired", "incarnation", "profile", "created_by", "spec_json", "created_at_ms", "updated_at_ms"], "agent");
  const name = identity(raw.name, isValidActor, "agent name");
  const role = choice(raw.role, ["resident", "principal"] as const, "agent role");
  if (role === "principal") {
    if (name !== "principal" || raw.created_by !== null) rowCorrupt("principal identity/lineage mismatch");
  } else if (!isValidActorName(name)) rowCorrupt("resident identity is reserved or invalid");
  const createdBy = raw.created_by === null ? null : identity(raw.created_by, isValidActor, "creator");
  if (createdBy === name) rowCorrupt("agent is its own creator");
  const specJson = text(raw.spec_json, "agent spec JSON");
  const spec = decodeAgentSpec(specJson);
  const profile = text(raw.profile, "agent profile");
  const specHash = text(raw.spec_hash, "agent spec hash");
  if (!/^[0-9a-f]{64}$/.test(specHash) || spec.name !== name || spec.profile !== profile || resolvedSpecDigest(spec) !== specHash)
    rowCorrupt("agent/spec/profile/hash identity mismatch");
  const createdAtMs = safeInteger(raw.created_at_ms, "agent creation time");
  return { name, role, createdBy, specJson, profile, specHash,
    desired: choice(raw.desired, ["provisioning", "enabled", "stopped", "retired"] as const, "desired state"),
    incarnation: safeInteger(raw.incarnation, "agent incarnation"), createdAtMs,
    updatedAtMs: safeInteger(raw.updated_at_ms, "agent update time", createdAtMs) };
}

export function decodeSubscriptionRow(value: unknown): SubscriptionRow {
  const raw = fullRow(value, ["topic", "agent", "created_at_ms"], "subscription");
  return { topic: identity(raw.topic, isValidTopicName, "topic"), agent: identity(raw.agent, isValidActor, "subscriber"), createdAtMs: safeInteger(raw.created_at_ms, "subscription creation time") };
}

export function decodeDeliveryRow(value: unknown): DeliveryRow {
  const raw = fullRow(value, ["message_id", "recipient", "operation_id", "materialized", "batch_id", "presented", "acknowledged", "created_at_ms", "materialized_at_ms", "presented_at_ms", "acknowledged_at_ms"], "delivery");
  const messageId = identity(raw.message_id, isValidMessageId, "delivery message");
  const operationId = identity(raw.operation_id, isValidOperationId, "delivery operation");
  if (parseMessageId(messageId)?.operationId !== operationId) rowCorrupt("delivery message/operation identity mismatch");
  const createdAtMs = safeInteger(raw.created_at_ms, "delivery creation time");
  const materialized = flag(raw.materialized, "materialized");
  const presented = flag(raw.presented, "presented");
  const acknowledged = flag(raw.acknowledged, "acknowledged");
  const materializedAtMs = optionalTime(raw.materialized_at_ms, "materialization time", createdAtMs);
  const presentedAtMs = optionalTime(raw.presented_at_ms, "presentation time", createdAtMs);
  const acknowledgedAtMs = optionalTime(raw.acknowledged_at_ms, "acknowledgement time", createdAtMs);
  const batchId = raw.batch_id === null ? null : identity(raw.batch_id, isValidBatchId, "delivery batch");
  if ((materialized === 0) !== (materializedAtMs === null) || (presented === 0) !== (presentedAtMs === null) ||
      (acknowledged === 0) !== (acknowledgedAtMs === null) || (presented === 1 && (materialized !== 1 || batchId === null)) ||
      (batchId !== null && materialized !== 1)) rowCorrupt("delivery flags/timestamps/batch are inconsistent");
  if (presentedAtMs !== null && materializedAtMs !== null && presentedAtMs < materializedAtMs) rowCorrupt("presentation precedes materialization");
  // Acknowledgement is not presentation; no implication between those flags.
  return { messageId, operationId, recipient: identity(raw.recipient, isValidActor, "delivery recipient"),
    materialized, presented, acknowledged, batchId, createdAtMs, materializedAtMs, presentedAtMs, acknowledgedAtMs };
}

export function decodeBatchManifest(json: string): string[] {
  const parsed = parseJson(json, "batch manifest");
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isValidMessageId) || new Set(parsed).size !== parsed.length)
    return rowCorrupt("batch manifest must be an ordered nonempty list of unique message identities");
  return [...parsed]; // preserve exact order, never sort or deduplicate durable identity
}
export function decodeBatchRow(value: unknown): BatchRow {
  const raw = fullRow(value, ["id", "agent", "incarnation", "message_ids_json", "session_path", "state", "created_at_ms", "completed_at_ms"], "batch");
  const state = choice(raw.state, ["prepared", "completed"] as const, "batch state");
  const createdAtMs = safeInteger(raw.created_at_ms, "batch creation time");
  const completedAtMs = optionalTime(raw.completed_at_ms, "batch completion time", createdAtMs);
  if ((state === "prepared") !== (completedAtMs === null)) rowCorrupt("batch state/completion time mismatch");
  const messageIdsJson = text(raw.message_ids_json, "batch manifest");
  decodeBatchManifest(messageIdsJson);
  // The string is persisted metadata, not S-03 physical session-boundary proof.
  const sessionPath = raw.session_path === null ? null : text(raw.session_path, "batch session path");
  return { id: identity(raw.id, isValidBatchId, "batch id"), agent: identity(raw.agent, isValidActor, "batch agent"),
    incarnation: safeInteger(raw.incarnation, "batch incarnation"), state, createdAtMs, completedAtMs, messageIdsJson, sessionPath };
}

function validateUsageDetails(json: string, pricingRevision: string): void {
  const value = parseJson(json, "usage details");
  if (value === null) return; // Existing producer persists both SQL NULL and JSON null.
  if (typeof value !== "object" || Array.isArray(value)) rowCorrupt("usage details is not an accounting object");
  for (const [key, item] of Object.entries(value)) {
    if (["inputTokens", "outputTokens", "cachedInputTokens", "totalTokens", "reportedUnits"].includes(key)) safeInteger(item, `usage ${key}`);
    else if (key === "providerRequestId") text(item, "provider request id");
    else if (key === "pricingRevision") {
      if (item !== pricingRevision) rowCorrupt("usage detail pricing revision mismatch");
    } else rowCorrupt("usage details contains unsupported payload or token-stream data");
  }
}
export function decodeUsageRow(value: unknown): UsageRow {
  const raw = fullRow(value, ["request_id", "actor", "incarnation", "profile", "pricing_revision", "reserved_units", "reported_units", "outcome", "details_json", "created_at_ms", "updated_at_ms"], "usage");
  const outcome = choice(raw.outcome, ["reserved", "completed", "cancelled", "unknown"] as const, "usage outcome");
  const reportedUnits = raw.reported_units === null ? null : safeInteger(raw.reported_units, "reported units");
  if (((outcome === "reserved" || outcome === "unknown") && reportedUnits !== null) ||
      ((outcome === "completed" || outcome === "cancelled") && reportedUnits === null)) rowCorrupt("usage outcome/reported units mismatch");
  const pricingRevision = text(raw.pricing_revision, "pricing revision");
  const detailsJson = raw.details_json === null ? null : text(raw.details_json, "usage details JSON");
  if (detailsJson !== null) validateUsageDetails(detailsJson, pricingRevision);
  const createdAtMs = safeInteger(raw.created_at_ms, "usage creation time");
  return { requestId: identity(raw.request_id, isValidRequestKey, "usage request id"), actor: identity(raw.actor, isValidActor, "usage actor"),
    incarnation: safeInteger(raw.incarnation, "usage incarnation"), profile: text(raw.profile, "usage model profile"), pricingRevision,
    reservedUnits: safeInteger(raw.reserved_units, "reserved units"), reportedUnits, outcome, detailsJson, createdAtMs,
    updatedAtMs: safeInteger(raw.updated_at_ms, "usage update time", createdAtMs) };
}

/** Only the actual SELECT id projection is accepted, not a pretend full operation. */
export function decodeOperationIdProjection(value: unknown): string {
  return identity(fullRow(value, ["id"], "operation id projection").id, isValidOperationId, "operation id");
}
