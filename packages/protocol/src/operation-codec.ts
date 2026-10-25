/** DB-009 / M-003: the sole raw-ledger -> workflow boundary. This module reads
 * no files, performs no effects, and never repairs or rewrites stored JSON.
 */
import type { ErrorCode } from "@oma/contracts/errors";
import type { Json } from "@oma/contracts/identity";
import type { MessagePlan, MutationMethod, OperationPlan } from "@oma/contracts/durable";
import type { PublicMethods } from "@oma/contracts/public-wire";
import {
  ownedMessages, operationPlanCheck, operationResultRelationCheck, resolvedSpecCheck,
  type OperationPlanContext, type PlanFor, type RepositoryIdentity, type ResultFor,
} from "@oma/domain/durable";
import {
  isValidActor, isValidOperationId, isValidRequestKey, isDerivedRequestKey,
  applyRequestKeyFor, refreshKeyOrdinalOf,
} from "@oma/domain/identifiers";
import type { Actor, OperationId, RequestKey } from "@oma/domain/identifiers";
import {
  attestationTarget, reviewFactRelationProblem,
  type ReviewRequestReference,
} from "@oma/domain/attestation-relations";
import { snapshotJson, canonicalJson } from "@oma/domain/canonical-json";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { requestHash } from "@oma/domain/request-identity";
import { StoreError, isErrorCode, isPreacceptOnlyFailure } from "@oma/domain/errors";
import { isMutationMethod } from "./receipt-codec.js";
import { currentPlanIntent, PLAN_ENVELOPE_VERSION } from "./persisted-formats.js";
import { PUBLIC_METHODS } from "./methods.js";
import { decodeMutationPayload } from "./request-codec.js";
import { operationResultCheck } from "@oma/domain/validation";

/** New acceptance serialization only. Decoding never repairs stored bytes. */
export function encodeOperationPlan(plan: OperationPlan): string {
  if (plan.kind === "agent.create" && "unitNames" in plan)
    throw new StoreError("UNSUPPORTED_PROFILE", "retired unit installation intents are read-only historical plans");
  return JSON.stringify({ version: PLAN_ENVELOPE_VERSION, intent: plan });
}

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

/** P1/P3-1: codec keys are derived from the public method registry. The mapped
 * type retains its actual mutation keys, so `satisfies` independently rejects
 * an OperationPlan kind with no registered mutation. Semantic plan, result and
 * relation validators still have their own exhaustiveness checks.
 */
export interface OperationCodec {
  readonly planCheck: (plan: unknown, context: OperationPlanContext) => string | null;
  readonly resultCheck: (result: unknown) => string | null;
  readonly relationsCheck: (plan: unknown, result: unknown, context: OperationPlanContext) => string | null;
}
const codecFor = (kind: MutationMethod): OperationCodec => Object.freeze({
  planCheck: (plan: unknown, context: OperationPlanContext) => operationPlanCheck(kind, context)(plan),
  resultCheck: (result: unknown) => operationResultCheck(kind)(result),
  relationsCheck: (plan: unknown, result: unknown, context: OperationPlanContext) =>
    operationResultRelationCheck(kind, plan, result, context),
});
type RegisteredCodecs = {
  readonly [K in keyof typeof PUBLIC_METHODS as typeof PUBLIC_METHODS[K]["mode"] extends "mutation" ? K : never]: OperationCodec;
};
export const OPERATION_CODECS = Object.freeze(Object.fromEntries(
  Object.keys(PUBLIC_METHODS).filter(isMutationMethod).map(kind => [kind, codecFor(kind)]),
) as RegisteredCodecs) satisfies Record<MutationMethod, OperationCodec>;
interface IdentityFields {
  readonly id: OperationId;
  readonly actor: Actor;
  readonly requestKey: RequestKey;
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
  /** Used for review facts; an unavailable acceptance index refuses decoding. */
  attestation?(operationId: string): unknown | null;
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
function validatePayloadRelation(plan: PlanFor<MutationMethod>, payload: unknown): void {
  if (!record(payload)) corrupt("accepted payload is not an object");
  switch (plan.kind) {
    case "society.set": if (plan.state !== payload.state) corrupt("society state differs from payload"); return;
    case "attest.record":
      {
        const fact = plan.fact;
        switch (fact.kind) {
          case "merge.open":
            if (!record(payload) || payload.kind !== "merge.open" || payload.tier !== fact.tier ||
                payload.title !== fact.title || payload.reason !== fact.reason ||
                payload.candidate !== fact.identity.candidate || payload.base !== fact.identity.expectedBase)
              corrupt("merge request payload differs from frozen fact");
            return;
          case "challenge.open":
            if (!record(payload) || payload.kind !== "challenge.open" || payload.merge !== fact.target.name ||
                payload.tier !== fact.tier || payload.title !== fact.title || payload.reason !== fact.reason)
              corrupt("challenge request payload differs from frozen fact");
            if (fact.prepared !== (payload.candidate === undefined && payload.base === undefined))
              corrupt("challenge preparation differs from payload");
            if (payload.candidate !== undefined &&
                (payload.candidate !== fact.identity.candidate || payload.base !== fact.identity.expectedBase))
              corrupt("challenge identity differs from payload");
            return;
          case "review":
            if (!record(payload) || payload.kind !== "review" || payload.body !== fact.body)
              corrupt("review payload differs from frozen fact");
            return;
          case "vote":
            if (!record(payload) || payload.kind !== "vote" || payload.verdict !== fact.verdict ||
                payload.body !== fact.body || fact.approval !== (payload.approval ?? null))
              corrupt("vote payload differs from frozen fact");
            return;
          case "cancel":
            if (!record(payload) || payload.kind !== "cancel" || payload.reason !== fact.reason)
              corrupt("cancel payload differs from frozen fact");
            return;
          case "refresh":
            if (!same(payload, fact)) corrupt("refresh payload differs from frozen fact");
            return;
        }
      }
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
      if (plan.merge !== undefined) {
        if (payload.tier !== plan.merge.tier) corrupt("merge tier differs from payload");
      } else if (payload.tier !== undefined)
        corrupt("integration tier request differs from its accepted policy");
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
      if (!same(plan.goalMail ?? null, payload.goalMail ?? null)) corrupt("GOAL mail differs from its explicit accepted intent");
      if (plan.base !== payload.expected || !same(plan.entries, payload.entries)) corrupt("context frozen base/entries differ from payload");
      if (!record(payload.content)) corrupt("context content descriptor is missing");
      const total = plan.entries.reduce((sum, entry) => sum + entry.bytes, 0);
      if (total !== payload.content.bytes) corrupt("context entries do not consume the frozen descriptor");
      return;
    }
  }
}
function validateDeliveries(id: string, messages: readonly MessagePlan[], rows: readonly unknown[]): void {
  if (messages.length === 0) {
    if (rows.length !== 0) corrupt("operation without an owned message has delivery rows");
    return;
  }
  const seen = new Set<string>();
  for (const raw of rows) {
    if (!record(raw) || raw.operation_id !== id || !isValidActor(raw.recipient)) corrupt("delivery identity differs from operation/message");
    const message = messages.find(candidate => candidate.id === raw.message_id);
    if (message === undefined || !message.recipients.includes(raw.recipient)) corrupt("duplicate or extra delivery recipient");
    const delivery = `${raw.message_id as string}/${raw.recipient}`;
    if (seen.has(delivery)) corrupt("duplicate or extra delivery recipient");
    seen.add(delivery);
  }
  for (const message of messages)
    for (const recipient of message.recipients)
      if (!seen.has(`${message.id}/${recipient}`)) corrupt("delivery rows do not match the frozen recipient set");
}

interface CheckedOperationRecord extends RawOperationRecord {
  readonly id: OperationId;
  readonly actor: Actor;
  readonly request_key: RequestKey;
  readonly request_hash: string;
  readonly kind: MutationMethod;
  readonly payload_json: string;
  readonly plan_json: string;
  readonly state: "pending" | "unknown" | "succeeded" | "failed";
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}
function assertOperationRecord(value: unknown): asserts value is CheckedOperationRecord {
  if (!record(value)) corrupt("operation row is not an object");
  const keys = ["id", "actor", "request_key", "request_hash", "kind", "payload_json", "plan_json", "state", "result_json", "error_code", "created_at_ms", "updated_at_ms"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) corrupt("operation row has missing or unknown columns");
  if (!isValidOperationId(value.id) || !isValidActor(value.actor) ||
      (!isValidRequestKey(value.request_key) && !isDerivedRequestKey(value.request_key)) ||
      typeof value.request_hash !== "string" || !/^[0-9a-f]{64}$/.test(value.request_hash) || !isMutationMethod(value.kind)) corrupt("operation identity is invalid");
  if (typeof value.payload_json !== "string" || typeof value.plan_json !== "string" || !safeInteger(value.created_at_ms) || !safeInteger(value.updated_at_ms)) corrupt("operation JSON/timestamps are invalid");
  if (value.state !== "pending" && value.state !== "unknown" && value.state !== "succeeded" && value.state !== "failed") corrupt("operation state is invalid");
}
function validateDerivedKey(plan: PlanFor<MutationMethod>, requestKey: RequestKey): void {
  // Broker-derived keys exist only for a merge plan's apply or a refresh fact.
  const mergePlan = plan.kind === "git.integrate" ? plan.merge : undefined;
  const refreshFact = plan.kind === "attest.record" && "messages" in plan && plan.fact.kind === "refresh"
    ? plan.fact : undefined;
  if (mergePlan !== undefined) {
    if (requestKey !== applyRequestKeyFor(mergePlan.request)) corrupt("merge integration requires its derived apply key");
  } else if (refreshFact !== undefined) {
    if (refreshKeyOrdinalOf(requestKey, refreshFact.request) === null)
      corrupt("refresh fact requires its derived request key");
  } else if (isDerivedRequestKey(requestKey)) {
    corrupt("a derived request key belongs only to a merge plan or refresh fact");
  }
}
function validateAttestation(plan: PlanFor<"attest.record">, value: CheckedOperationRecord, payload: PublicMethods[MutationMethod]["params"], context: OperationDecodeContext, decode: (raw: unknown) => DecodedOperation): void {
  const index = context.relations.attestation?.(value.id);
  if (!record(index) || Object.keys(index).length !== 2 || index.operation_id !== value.id ||
      !safeInteger(index.sequence) || index.sequence < 1) corrupt("attestation acceptance index is missing or invalid");
  const targetId = attestationTarget(plan.fact);
  const targetRaw = targetId === null ? null : context.relations.operation(targetId);
  const target = targetRaw === null ? null : decode(targetRaw);
  if (target?.kind === "attest.record") {
    const earlier = context.relations.attestation?.(target.id);
    if (!record(earlier) || !safeInteger(earlier.sequence) || earlier.sequence >= index.sequence)
      corrupt("attestation reference is not earlier in acceptance order");
  }
  if ("messages" in plan) {
    const fact = plan.fact;
    const request: ReviewRequestReference | null = target === null ? null : {
      actor: target.actor,
      open: target.kind === "attest.record" && "messages" in target.plan &&
        (target.plan.fact.kind === "merge.open" || target.plan.fact.kind === "challenge.open")
        ? target.plan.fact : null,
    };
    const problem = reviewFactRelationProblem(value.actor, fact, request);
    if (problem !== null) corrupt(problem);
    if (request !== null && request.open !== null) {
      // An open fact's messages name the new request itself; every other
      // fact's name the request it references.
      const isOpen = fact.kind === "merge.open" || fact.kind === "challenge.open";
      const open = isOpen ? fact : request.open;
      const requestId = isOpen ? value.id : fact.request;
      const named = (payload as { name?: unknown }).name;
      if ((fact.kind === "review" || fact.kind === "vote" || fact.kind === "cancel") && named !== open.name)
        corrupt("review payload names a different request");
      for (const message of plan.messages) {
        if (message.review === undefined || message.review.name !== open.name || message.review.request !== requestId)
          corrupt("review message differs from its request");
        if (message.review.role === "approval" && !same(message.approvalFor ?? null, open.identity))
          corrupt("approval mail names a different candidate identity");
      }
      // A succeeded review result names the request's frozen name.
      const result = value.state === "succeeded" && typeof value.result_json === "string"
        ? json(value.result_json, "operation result") : null;
      if (record(result) && typeof result.request === "string" && result.request !== open.name)
        corrupt("review attestation result names a different request");
    }
  }
}
function validateIntegration(plan: PlanFor<"git.integrate">, value: CheckedOperationRecord, context: OperationDecodeContext, decode: (raw: unknown) => DecodedOperation): void {
  if (plan.merge === undefined) return;
  const requestRaw = context.relations.operation(plan.merge.request);
  const request = requestRaw === null ? null : decode(requestRaw);
  if (request === null || request.kind !== "attest.record" || !("messages" in request.plan) ||
      (request.plan.fact.kind !== "merge.open" && request.plan.fact.kind !== "challenge.open"))
    corrupt("merge integration names no review request");
  const open = request.plan.fact;
  if (request.actor !== value.actor) corrupt("merge integration actor differs from its requester");
  if (open.name !== plan.merge.name || open.tier !== plan.merge.tier ||
      open.identity.expectedBase !== plan.base || open.identity.candidate !== plan.candidate ||
      open.identity.policyRevision !== plan.policyRevision)
    corrupt("merge integration identity differs from its request");
}
function validateCreation(plan: PlanFor<"agent.create">, context: OperationDecodeContext, decode: (raw: unknown) => DecodedOperation): void {
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
function validateResult(value: CheckedOperationRecord, plan: PlanFor<MutationMethod>, relationContext: OperationPlanContext): unknown {
  let result: unknown = null;
  if (value.state === "succeeded") {
    if (typeof value.result_json !== "string" || value.error_code !== null) corrupt("inconsistent succeeded operation");
    result = json(value.result_json, "operation result");
    const codec = OPERATION_CODECS[plan.kind];
    const error = codec.resultCheck(result) ?? codec.relationsCheck(plan, result, relationContext);
    if (error) corrupt(`operation result: ${error}`);
  } else if (value.state === "failed") {
    if (value.result_json !== null || !isErrorCode(value.error_code) || isPreacceptOnlyFailure(value.error_code)) corrupt("inconsistent or preaccept-only failed operation");
  } else if (value.result_json !== null || value.error_code !== null) corrupt("nonterminal operation contains terminal data");
  return result;
}

/** All identity facts and relational observations are required arguments. No
 * caller gets a branded operation by supplying only syntactically valid JSON.
 */
export function decodeOperation(raw: unknown, context: OperationDecodeContext): DecodedOperation {
  const active = new Set<string>();
  const decoded = new Map<string, DecodedOperation>();
  const decode = (value: unknown): DecodedOperation => {
    assertOperationRecord(value);
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
      const planRaw = currentPlanIntent(json(planJson, "operation plan"));
      if (planRaw === null) corrupt("operation plan requires the current versioned envelope; create a new development state directory");
      const relationContext: OperationPlanContext = {
        operationId: value.id, actor: value.actor, stateRoot: context.stateRoot, repositoryIdentity: context.repositoryIdentity,
      };
      const invalid = OPERATION_CODECS[kind].planCheck(planRaw, relationContext);
      if (invalid) corrupt(`operation plan: ${invalid}`);
      // Audited narrowings are confined to this boundary after closed shape and
      // operation-context checks. Workflow code consumes the returned union.
      const plan = planRaw as PlanFor<MutationMethod>;
      validatePayloadRelation(plan, payload);
      validateDeliveries(value.id, ownedMessages(plan), context.relations.deliveries(value.id));
      validateDerivedKey(plan, value.request_key);
      if (plan.kind === "attest.record") validateAttestation(plan, value, payload, context, decode);
      if (plan.kind === "git.integrate") validateIntegration(plan, value, context, decode);
      if (plan.kind === "agent.create") validateCreation(plan, context, decode);
      if (plan.kind === "agent.start" || plan.kind === "agent.stop") {
        const agent = context.relations.agent(plan.agent);
        if (!record(agent) || agent.name !== plan.agent || !safeInteger(agent.incarnation) || agent.incarnation < plan.previousIncarnation) corrupt("lifecycle target/incarnation relation mismatch");
      }
      const result = validateResult(value, plan, relationContext);
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
