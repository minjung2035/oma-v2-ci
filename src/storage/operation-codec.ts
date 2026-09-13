/** DB-009 / M-003: the sole raw-ledger -> workflow boundary. This module reads
 * no files, performs no effects, and never repairs or rewrites stored JSON.
 */
import type { ErrorCode } from "../../implementation/contracts/errors.js";
import type { Json } from "../../implementation/contracts/identity.js";
import type { MessagePlan, MutationMethod } from "../../implementation/contracts/durable.js";
import type { PublicMethods } from "../../implementation/contracts/public-wire.js";
import {
  operationPlanCheck, operationResultRelationCheck, resolvedSpecCheck,
  type OperationPlanContext, type PlanFor, type RepositoryIdentity, type ResultFor,
} from "../durable.js";
import { isValidActor, isValidOperationId, isValidRequestKey } from "../ids.js";
import { snapshotJson, canonicalJson } from "../domain/canonical-json.js";
import { resolvedSpecDigest } from "../domain/spec-identity.js";
import { requestHash } from "../hash.js";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "../domain/errors.js";
import { isMutationMethod } from "../protocol/receipt-codec.js";
import { decodeMutationPayload } from "../protocol/request-codec.js";
import { operationResultCheck } from "../validate.js";

/** SQLite representation. Untrusted values stay unknown until checked. */
export interface RawOperationRecord {
  readonly id: unknown;
  readonly actor: unknown;
  readonly request_key: unknown;
  readonly request_hash: unknown;
  readonly kind: unknown;
  readonly payload_json: unknown;
  readonly plan_json: unknown;
  readonly state: unknown;
  readonly result_json: unknown;
  readonly error_code: unknown;
  readonly created_at_ms: unknown;
  readonly updated_at_ms: unknown;
}
const PLAN = Symbol("ValidatedOperationPlan");
const OPERATION = Symbol("DecodedOperation");
export type ValidatedPlan<K extends MutationMethod> = PlanFor<K> & { readonly [PLAN]: true };
interface IdentityFields {
  readonly id: string;
  readonly actor: string;
  readonly requestKey: string;
  readonly requestHash: string;
  /** Original bytes are retained for CAS/audit, not for workflow parsing. */
  readonly payloadJson: string;
  readonly planJson: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly [OPERATION]: true;
}
type StateFields<K extends MutationMethod> =
  | { readonly state: "pending" | "unknown"; readonly result: null; readonly resultJson: null; readonly errorCode: null }
  | { readonly state: "succeeded"; readonly result: ResultFor<K>; readonly resultJson: string; readonly errorCode: null }
  | { readonly state: "failed"; readonly result: null; readonly resultJson: null; readonly errorCode: ErrorCode };
export type OperationOf<K extends MutationMethod> = IdentityFields & {
  readonly kind: K;
  readonly payload: PublicMethods[K]["params"];
  readonly plan: ValidatedPlan<K>;
} & StateFields<K>;
export type DecodedOperation = { [K in MutationMethod]: OperationOf<K> }[MutationMethod];
export interface OperationRelations {
  /** These return raw observations from the same Store, never repaired values. */
  operation(id: string): unknown | null;
  agent(name: string): unknown | null;
  deliveries(operationId: string): readonly unknown[];
}
export interface OperationDecodeContext {
  readonly stateRoot: string;
  readonly repositoryIdentity: RepositoryIdentity | null;
  readonly relations: OperationRelations;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function corrupt(reason: string): never { throw new StoreError("STORE_CORRUPT", reason); }
function safeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function json(text: string, label: string): Json {
  try { return snapshotJson(JSON.parse(text)); }
  catch { return corrupt(`${label} is not finite closed JSON`); }
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort(); const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function ownMessage(plan: PlanFor<MutationMethod>): MessagePlan | null {
  switch (plan.kind) {
    case "mail.send": case "agent.continue": case "git.submit": case "context.publish": return plan.message;
    case "agent.create": return plan.initialMessage;
    default: return null;
  }
}
function validatePayloadRelation(plan: PlanFor<MutationMethod>, payload: unknown): void {
  if (!record(payload)) corrupt("accepted payload is not an object");
  switch (plan.kind) {
    case "mail.send": {
      if (plan.message.kind !== payload.kind || !same(plan.message.approvalFor ?? null, payload.approvalFor ?? null)) corrupt("mail kind/approval identity differs from payload");
      const to = payload.to as string[];
      if (to.length > 0 && !sameSet(plan.message.to, to)) corrupt("mail logical recipients differ from payload");
      const refs = payload.refs as Array<{ repo: string; oid: string }> | undefined;
      if (plan.message.contextRevision !== (refs?.find(ref => ref.repo === "context")?.oid ?? null)) corrupt("mail context revision differs from payload");
      if (typeof payload.replyToMessage === "string" && plan.message.replyHeaders.inReplyTo?.split("@", 1)[0] !== payload.replyToMessage) corrupt("mail reply identity differs from payload");
      return;
    }
    case "agent.continue": return; // Rendered bytes are checked against the frozen object at the mail boundary.
    case "mail.ack": if (plan.message !== payload.message) corrupt("ack message differs from payload"); return;
    case "route.follow": case "route.unfollow": if (plan.topic !== payload.topic) corrupt("route topic differs from payload"); return;
    case "agent.start": case "agent.stop": if (plan.agent !== payload.agent) corrupt("lifecycle agent differs from payload"); return;
    case "agent.create":
      if (plan.spec.name !== payload.name || plan.spec.from !== payload.from || plan.spec.brief !== payload.brief) corrupt("create frozen spec differs from caller identity");
      return;
    case "git.integrate":
      if (plan.candidate !== payload.candidate || plan.base !== payload.expected) corrupt("integrate base/candidate differs from payload");
      return;
    case "git.submit": {
      if (plan.candidate !== payload.candidate || plan.exportRef !== payload.exportRef || !sameSet(plan.prerequisites, payload.prerequisites as string[])) corrupt("submit identity differs from payload");
      const descriptor = payload.bundle;
      if (descriptor === undefined) {
        if (plan.bundle !== null) corrupt("submit plan has an unadvertised bundle");
      } else if (!record(descriptor) || plan.bundle === null || plan.bundle.bytes !== descriptor.bytes || plan.bundle.sha256 !== descriptor.sha256) corrupt("submit bundle differs from payload descriptor");
      const to = payload.to as string[];
      if (!sameSet(plan.message.to, to.length === 0 ? ["commons"] : to)) corrupt("submit logical recipients differ from payload");
      return;
    }
    case "context.publish": {
      if (plan.base !== payload.expected || !same(plan.entries, payload.entries)) corrupt("context frozen base/entries differ from payload");
      if (!record(payload.content)) corrupt("context content descriptor is missing");
      const total = plan.entries.reduce((sum, entry) => sum + entry.bytes, 0);
      if (total !== payload.content.bytes) corrupt("context entries do not consume the frozen descriptor");
      return;
    }
  }
}
function validateDeliveries(id: string, message: MessagePlan | null, rows: readonly unknown[]): void {
  if (message === null) {
    if (rows.length !== 0) corrupt("operation without an owned message has delivery rows");
    return;
  }
  const recipients = new Set<string>();
  for (const raw of rows) {
    if (!record(raw) || raw.operation_id !== id || raw.message_id !== message.id || !isValidActor(raw.recipient)) corrupt("delivery identity differs from operation/message");
    if (recipients.has(raw.recipient) || !message.recipients.includes(raw.recipient)) corrupt("duplicate or extra delivery recipient");
    recipients.add(raw.recipient);
  }
  if (recipients.size !== message.recipients.length || message.recipients.some(recipient => !recipients.has(recipient))) corrupt("delivery rows do not match the frozen recipient set");
}

/** All identity facts and relational observations are required arguments. No
 * caller gets a branded operation by supplying only syntactically valid JSON.
 */
export function decodeOperation(raw: unknown, context: OperationDecodeContext): DecodedOperation {
  const active = new Set<string>();
  const decoded = new Map<string, DecodedOperation>();
  const decode = (value: unknown): DecodedOperation => {
    if (!record(value)) corrupt("operation row is not an object");
    const keys = ["id", "actor", "request_key", "request_hash", "kind", "payload_json", "plan_json", "state", "result_json", "error_code", "created_at_ms", "updated_at_ms"];
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) corrupt("operation row has missing or unknown columns");
    if (!isValidOperationId(value.id) || !isValidActor(value.actor) || !isValidRequestKey(value.request_key) || typeof value.request_hash !== "string" || !/^[0-9a-f]{64}$/.test(value.request_hash) || !isMutationMethod(value.kind)) corrupt("operation identity is invalid");
    if (typeof value.payload_json !== "string" || typeof value.plan_json !== "string" || !safeInteger(value.created_at_ms) || !safeInteger(value.updated_at_ms)) corrupt("operation JSON/timestamps are invalid");
    if (value.state !== "pending" && value.state !== "unknown" && value.state !== "succeeded" && value.state !== "failed") corrupt("operation state is invalid");
    if (active.has(value.id)) corrupt("existingCreation cycle detected");
    const previous = decoded.get(value.id);
    if (previous) return previous;
    active.add(value.id);
    try {
      const kind = value.kind;
      const payloadJson = value.payload_json;
      const planJson = value.plan_json;
      const payloadRaw = json(payloadJson, "operation payload");
      let payload: PublicMethods[MutationMethod]["params"];
      try { payload = decodeMutationPayload(kind, payloadRaw); }
      catch { return corrupt("operation payload has an invalid caller DTO"); }
      if (requestHash(kind, payloadRaw) !== value.request_hash) corrupt("operation payload/hash identity mismatch");
      const planRaw = json(planJson, "operation plan");
      const relationContext: OperationPlanContext = {
        operationId: value.id, actor: value.actor, stateRoot: context.stateRoot, repositoryIdentity: context.repositoryIdentity,
      };
      const invalid = operationPlanCheck(kind, relationContext)(planRaw);
      if (invalid) corrupt(`operation plan: ${invalid}`);
      // Audited narrowings are confined to this boundary after closed shape and
      // operation-context checks. Workflow code consumes the returned union.
      const plan = planRaw as PlanFor<MutationMethod>;
      validatePayloadRelation(plan, payload);
      validateDeliveries(value.id, ownMessage(plan), context.relations.deliveries(value.id));
      if (plan.kind === "agent.create") {
        const agent = context.relations.agent(plan.spec.name);
        if (!record(agent) || agent.name !== plan.spec.name || agent.profile !== plan.spec.profile || agent.spec_hash !== plan.specHash || agent.role !== "resident" || typeof agent.spec_json !== "string") corrupt("create agent/spec row identity mismatch");
        const spec = json(agent.spec_json, "agent spec");
        if (resolvedSpecCheck(spec)) corrupt("create agent has an invalid resolved spec");
        if (!same(spec, plan.spec)) corrupt("create plan and frozen agent spec differ");
        if (resolvedSpecDigest(plan.spec) !== agent.spec_hash) corrupt("create agent spec digest mismatch");
        if (plan.existingCreation === null) {
          if (agent.created_by !== plan.parent) corrupt("physical create parent differs from agent lineage");
        } else {
          const originalRaw = context.relations.operation(plan.existingCreation);
          if (originalRaw === null) corrupt("existingCreation is dangling");
          const original = decode(originalRaw);
          if (original.id !== plan.existingCreation || original.kind !== "agent.create" || original.plan.spec.name !== plan.spec.name || original.plan.specHash !== plan.specHash || !same(original.plan.spec, plan.spec)) corrupt("existingCreation target kind/name/spec mismatch");
        }
      }
      if (plan.kind === "agent.start" || plan.kind === "agent.stop") {
        const agent = context.relations.agent(plan.agent);
        if (!record(agent) || agent.name !== plan.agent || !safeInteger(agent.incarnation) || agent.incarnation < plan.previousIncarnation) corrupt("lifecycle target/incarnation relation mismatch");
      }
      let result: unknown = null;
      if (value.state === "succeeded") {
        if (typeof value.result_json !== "string" || value.error_code !== null) corrupt("inconsistent succeeded operation");
        result = json(value.result_json, "operation result");
        const error = operationResultCheck(kind)(result) ?? operationResultRelationCheck(kind, plan, result, relationContext);
        if (error) corrupt(`operation result: ${error}`);
      } else if (value.state === "failed") {
        if (value.result_json !== null || !isErrorCode(value.error_code) || isPreacceptOnlyFailure(value.error_code)) corrupt("inconsistent or preaccept-only failed operation");
      } else if (value.result_json !== null || value.error_code !== null) corrupt("nonterminal operation contains terminal data");
      const operation = freeze({
        id: value.id, actor: value.actor, requestKey: value.request_key, requestHash: value.request_hash,
        kind, payloadJson, planJson, payload, plan: { ...plan, [PLAN]: true },
        state: value.state, result, resultJson: value.result_json, errorCode: value.error_code,
        createdAtMs: value.created_at_ms, updatedAtMs: value.updated_at_ms, [OPERATION]: true,
      }) as DecodedOperation;
      decoded.set(operation.id, operation);
      return operation;
    } finally { active.delete(value.id); }
  };
  return decode(raw);
}
