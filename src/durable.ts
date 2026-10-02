// MUST [DB-009/M-003]: closed durable shapes and mandatory intrinsic relations.
// No Store, filesystem reads, current defaults, or physical effects belong here.
import { tieredAcceptanceCheck, tieredAcceptanceRelation } from "./domain/tier-snapshot.js";
import { attestationProblem } from "./domain/attestation.js";
import { isAbsolute } from "node:path";
import type {
  MutationMethod,
  MessagePlan,
  OperationPlan,
  OperationResult,
} from "../implementation/contracts/durable.js";
import { capabilityCheck } from "./domain/capabilities.js";
import { resourceLimitsCheck } from "./domain/resources.js";
import { resolvedSpecDigest } from "./domain/spec-identity.js";
import { contextEntriesCheck as checkContextEntries } from "./domain/context-policy.js";
import {
  messageIdForOperation,
  contextNoopRefFor,
  isMailObjectRelativePathFor,
  isPublishedRefFor,
  residentUnitsFor,
} from "./domain/derived.js";
import {
  isWorkspacePathFor,
  isSubmitBundlePathFor,
  isContextStagingPathFor,
  isMailArchivePathFor,
} from "./storage/paths.js";
import {
  checkArray,
  checkOptional,
  checkEnum,
  checkInt,
  checkObject,
  checkOid,
  checkString,
  checkExportRef,
  checkTopic,
  messagePlanCheck,
  operationResultCheck,
  type Check,
} from "./validate.js";
import {
  isValidActorName,
  isValidActor,
  isValidMessageId,
  isValidOperationId,
  isValidSocietyName,
} from "./domain/identifiers.js";

/** Split the legacy grouped kind members without changing persisted JSON. */
type NarrowKind<T, K> = T extends { kind: infer Kind }
  ? K extends Kind
    ? Omit<T, "kind"> & { kind: K }
    : never
  : never;
export type ResultFor<K extends MutationMethod> = NarrowKind<
  OperationResult,
  K
>;
export type PlanFor<K extends MutationMethod> = K extends "git.integrate"
  ? NarrowKind<OperationPlan, K> & { result?: ResultFor<"git.integrate"> }
  : NarrowKind<OperationPlan, K>;
/** The messages owned by an immutable accepted plan, not by a file or a
 * present-day recipient lookup. All ledger/publication readers share this.
 * v1 plans own at most one message at ordinal zero. */
export function ownedMessages(plan: OperationPlan): readonly MessagePlan[] {
  switch (plan.kind) {
    case "attest.record": case "mail.send": case "agent.continue": case "git.submit": case "context.publish": return [plan.message];
    case "agent.create": return plan.initialMessage === null ? [] : [plan.initialMessage];
    case "git.integrate": return plan.publication === undefined ? [] : [plan.publication.message];
    default: return [];
  }
}
export interface RepositoryIdentity {
  readonly society: string;
}
export interface OperationPlanContext {
  readonly operationId: string;
  readonly actor: string;
  readonly stateRoot: string;
  /** null carries no authority. A create plan cannot be decoded in that state. */
  readonly repositoryIdentity: RepositoryIdentity | null;
}
const operationIdCheck: Check = (value) =>
  isValidOperationId(value) ? null : "invalid operation id";
const messageIdCheck: Check = (value) =>
  isValidMessageId(value) ? null : "invalid message id";
const sha256Check = checkString({ re: /^[0-9a-f]{64}$/ });
const nonEmpty = checkString({ min: 1 });
const actorOrPrincipal: Check = (value) =>
  isValidActor(value) ? null : "invalid actor";
export const resolvedSpecCheck: Check = checkObject({
  name: actorOrPrincipal,
  from: checkOid,
  brief: nonEmpty,
  profile: nonEmpty,
  capabilities: checkArray(capabilityCheck),
  modelProfile: nonEmpty,
  resources: resourceLimitsCheck,
});
const nullableMessagePlan: Check = (value) =>
  value === null ? null : messagePlanCheck(value);
const nullableOperationId: Check = (value) =>
  value === null ? null : operationIdCheck(value);
const nullableOid: Check = (value) => (value === null ? null : checkOid(value));

/** The domain policy owns context paths, closed fields, ordering and byte sums.
 * Accepted rows keep their exact bytes; this boundary never sorts or repairs them.
 */
export const contextEntriesCheck: Check = (value) =>
  checkContextEntries(value, { requireSorted: true });
const integrateFields = {
  kind: checkEnum(["git.integrate"] as const),
  repo: checkEnum(["project"] as const),
  target: checkEnum(["refs/heads/main"] as const),
  base: checkOid,
  candidate: checkOid,
  policyRevision: nonEmpty,
  checkProfileDigest: sha256Check,
  publication: checkOptional(checkObject({ message: messagePlanCheck, noopRef: value => value === null ? null : nonEmpty(value), tiered: tieredAcceptanceCheck })),

};
const integrateBaseCheck = checkObject(integrateFields);
const integrateWithResultCheck = checkObject({
  ...integrateFields,
  result: operationResultCheck("git.integrate"),
});
const publishedRefShape: Check = (value) => {
  if (typeof value !== "string") return "invalid published ref";
  const parts = value.split("/");
  return parts.length === 5 &&
    isPublishedRefFor(value, { actor: parts[3]!, operationId: parts[4]! })
    ? null
    : "invalid published ref";
};
const checks = {
  "society.set": checkObject({ kind: checkEnum(["society.set"]), state: checkEnum(["open", "closed"]) }),
  "attest.record": checkObject({ kind: checkEnum(["attest.record"] as const),
    fact: value => attestationProblem(value), message: messagePlanCheck }),
  "mail.send": checkObject({
    kind: checkEnum(["mail.send"] as const),
    message: messagePlanCheck,
  }),
  "agent.continue": checkObject({
    kind: checkEnum(["agent.continue"] as const),
    message: messagePlanCheck,
  }),
  "mail.ack": checkObject({
    kind: checkEnum(["mail.ack"] as const),
    recipient: actorOrPrincipal,
    message: messageIdCheck,
  }),
  "route.follow": checkObject({
    kind: checkEnum(["route.follow"] as const),
    topic: checkTopic,
    agent: actorOrPrincipal,
  }),
  "route.unfollow": checkObject({
    kind: checkEnum(["route.unfollow"] as const),
    topic: checkTopic,
    agent: actorOrPrincipal,
  }),
  "agent.create": checkObject({
    kind: checkEnum(["agent.create"] as const),
    spec: resolvedSpecCheck,
    specHash: sha256Check,
    parent: actorOrPrincipal,
    workspacePath: nonEmpty,
    unitNames: checkArray(nonEmpty),
    initialMessage: nullableMessagePlan,
    existingCreation: nullableOperationId,
  }),
  "agent.start": checkObject({
    kind: checkEnum(["agent.start"] as const),
    agent: actorOrPrincipal,
    previousIncarnation: checkInt({ min: 0 }),
    desired: checkEnum(["enabled"] as const),
    remainingOperations: checkArray(operationIdCheck),
  }),
  "agent.stop": checkObject({
    kind: checkEnum(["agent.stop"] as const),
    agent: actorOrPrincipal,
    previousIncarnation: checkInt({ min: 0 }),
    desired: checkEnum(["stopped"] as const),
    remainingOperations: checkArray(operationIdCheck),
  }),
  "git.submit": checkObject({
    kind: checkEnum(["git.submit"] as const),
    candidate: checkOid,
    exportRef: checkExportRef,
    prerequisites: checkArray(checkOid),
    bundle: (value) =>
      value === null
        ? null
        : checkObject({
            path: nonEmpty,
            sha256: sha256Check,
            bytes: checkInt({ min: 1 }),
          })(value),
    publishedRef: publishedRefShape,
    message: messagePlanCheck,
  }),
  "git.integrate": (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return "expected object";
    return Object.hasOwn(value, "result")
      ? integrateWithResultCheck(value)
      : integrateBaseCheck(value);
  },
  "context.publish": checkObject({
    kind: checkEnum(["context.publish"] as const),
    base: nullableOid,
    candidate: checkOid,
    target: checkEnum(["refs/heads/main"] as const),
    entries: contextEntriesCheck,
    stagingPath: nonEmpty,
    message: messagePlanCheck,
    goalMail: checkOptional(checkObject({ subject: checkString({ min: 1 }) })),
    noopRef: checkOptional(value => value === null ? null : nonEmpty(value)),
  }),
} satisfies Record<MutationMethod, Check>;

/** Schema-only helper for decoder internals and focused shape tests, never effect authorization. */
export function operationPlanShapeCheck(kind: string): Check {
  if (!Object.hasOwn(checks, kind)) return () => "unknown operation kind";
  return checks[kind as MutationMethod];
}

/** A relation context is mandatory; missing facts are not silently skipped. */
export function operationPlanCheck(
  kind: string,
  context: OperationPlanContext,
): Check {
  return (value) => {
    const shape = operationPlanShapeCheck(kind)(value);
    if (shape) return shape;
    if (
      !context ||
      !isValidOperationId(context.operationId) ||
      !isValidActor(context.actor) ||
      !isAbsolute(context.stateRoot)
    )
      return "missing or invalid operation identity context";
    const plan = value as PlanFor<MutationMethod>;
    const messages = ownedMessages(plan);
    for (const [ordinal, message] of messages.entries()) {
      if (
        message.id !== messageIdForOperation(context.operationId, ordinal) ||
        !isMailObjectRelativePathFor(message.objectPath, {
          messageId: message.id,
        })
      )
        return "message id/ordinal/object path differs from accepted operation";
      if (new Set(message.recipients).size !== message.recipients.length)
        return "duplicate frozen recipient";
    }
    switch (plan.kind) {
      case "society.set": return context.actor === "principal" ? null : "society control requires the Principal actor";
      case "mail.ack":
        return plan.recipient === context.actor
          ? null
          : "ack recipient differs from accepted actor";
      case "route.follow":
      case "route.unfollow":
        return plan.agent === context.actor
          ? null
          : "route agent differs from accepted actor";
      case "agent.continue":
        if (
          plan.message.kind !== "message" ||
          plan.message.to.length !== 1 ||
          plan.message.to[0] !== context.actor ||
          plan.message.recipients.length !== 1 ||
          plan.message.recipients[0] !== context.actor
        )
          return "continue message must belong to the accepted actor";
        return null;
      case "agent.create": {
        const identity = context.repositoryIdentity;
        if (!identity || !isValidSocietyName(identity.society))
          return "create requires trusted repository/society identity";
        if (!isValidActorName(plan.spec.name) || plan.parent !== context.actor)
          return "create name/parent differs from accepted actor";
        if (resolvedSpecDigest(plan.spec) !== plan.specHash)
          return "resolved spec hash mismatch";
        if (
          !isWorkspacePathFor(plan.workspacePath, {
            stateRoot: context.stateRoot,
            actor: plan.spec.name,
          })
        )
          return "create workspace identity mismatch";
        const expectedUnits = residentUnitsFor(
          identity.society,
          plan.spec.name,
        );
        if (
          plan.unitNames.length !== expectedUnits.length ||
          plan.unitNames.some((unit, index) => unit !== expectedUnits[index])
        )
          return "create unit identity mismatch";
        if (plan.existingCreation === context.operationId)
          return "create links to itself";
        if (plan.existingCreation !== null)
          return plan.initialMessage === null
            ? null
            : "linked create cannot own another initial message";
        const initial = plan.initialMessage;
        if (
          initial === null ||
          initial.kind !== "message" ||
          initial.to.length !== 1 ||
          initial.to[0] !== plan.spec.name ||
          initial.recipients.length !== 1 ||
          initial.recipients[0] !== plan.spec.name
        )
          return "physical create requires its frozen initial message and recipient";
        return null;
      }
      case "git.submit":
        if (
          !isPublishedRefFor(plan.publishedRef, {
            actor: context.actor,
            operationId: context.operationId,
          })
        )
          return "published ref differs from actor/operation";
        if (
          plan.bundle !== null &&
          !isSubmitBundlePathFor(plan.bundle.path, {
            stateRoot: context.stateRoot,
            operationId: context.operationId,
          })
        )
          return "bundle staging path differs from operation";
        return plan.message.kind === "result" &&
          plan.message.contextRevision === null
          ? null
          : "submit message kind/context mismatch";
      case "context.publish":
        if (plan.noopRef !== undefined && plan.noopRef !== (plan.base === plan.candidate ? contextNoopRefFor(context.operationId) : null))
          return "context no-op witness differs from its accepted identity";
        if (plan.goalMail && context.actor !== "principal") return "GOAL mail requires the Principal actor";
        if (
          !isContextStagingPathFor(plan.stagingPath, {
            stateRoot: context.stateRoot,
            operationId: context.operationId,
          })
        )
          return "context staging path differs from operation";
        if (
          plan.message.kind !== "context" ||
          plan.message.contextRevision !== plan.candidate
        )
          return "context candidate/message revision mismatch";
        if (plan.message.to.length !== 1 || plan.message.to[0] !== "residents")
          return "context message must retain its residents address";
        return null;
      case "git.integrate":
        if (plan.publication) {
          const tiered = plan.publication.tiered;
          const invalid = tieredAcceptanceRelation(tiered, { repo: plan.repo, targetRef: plan.target,
            expectedBase: plan.base, candidate: plan.candidate, policyRevision: plan.policyRevision }, context.actor, plan.checkProfileDigest);
          if (invalid !== null) return invalid;
          const levels = ["LOW", "MEDIUM", "HIGH"];
          if (levels.indexOf(tiered.effective) < levels.indexOf(tiered.requested))
            return "accepted tier is below the requested tier";
          if ([tiered.approvers, tiered.activeFloors].some(values => new Set(values).size !== values.length))
            return "integration authority contains duplicate evidence";
          if (tiered.objections.length !== 0) return "accepted integration has active objections";
          if (tiered.approvers.includes("principal") || tiered.approvers.includes(context.actor))
            return "integration requester or Principal is counted as a peer";
          if (tiered.effective !== "LOW" && tiered.approvers.length === 0)
            return "accepted integration lacks an eligible peer";
          if (tiered.effective === "HIGH" && tiered.principalDecision === null)
            return "accepted HIGH integration lacks a Principal decision";
        }
        if (plan.publication && plan.publication.noopRef !== (plan.base === plan.candidate ? `refs/oma/integrations/${context.operationId}` : null))
          return "integration no-op witness differs from its accepted identity";
        if (plan.publication && (plan.publication.message.kind !== "result" || plan.publication.message.to.length !== 1 ||
            plan.publication.message.to[0] !== "commons")) return "integration publication must name commons result mail";
        if (plan.result)
          return operationResultRelationCheck(kind, plan, plan.result, context);
        return null;
      case "attest.record":
        return plan.message.kind === "result" && plan.message.to.length === 1 && plan.message.to[0] === "commons"
          ? null : "attestation publication must name commons as result mail";
      case "agent.start":
      case "agent.stop":
      case "mail.send":
        return null;
    }
  };
}

/** Closed success data must describe the already accepted plan, not current defaults. */
export function operationResultRelationCheck(
  kind: string,
  planValue: unknown,
  resultValue: unknown,
  context: OperationPlanContext,
): string | null {
  const shape =
    operationPlanShapeCheck(kind)(planValue) ??
    operationResultCheck(kind)(resultValue);
  if (shape) return shape;
  const plan = planValue as PlanFor<MutationMethod>;
  const result = resultValue as OperationResult;
  if (result.kind !== plan.kind)
    return "result kind differs from accepted plan";
  const row = result as unknown as Record<string, unknown>;
  switch (plan.kind) {
    case "society.set": return row.state === plan.state ? null : "society result differs from accepted state";
    case "attest.record":
    case "mail.send":
    case "agent.continue":
      if (
        row.message !== plan.message.id ||
        row.recipientCount !== plan.message.recipients.length
      )
        return "mail result differs from frozen message/recipient snapshot";
      return isMailArchivePathFor(row.archivePath, {
        stateRoot: context.stateRoot,
        messageId: plan.message.id,
      })
        ? null
        : "archive path differs from accepted message";
    case "mail.ack":
      return row.message === plan.message && row.acknowledged === true
        ? null
        : "ack result differs from accepted message";
    case "route.follow":
    case "route.unfollow":
      return row.topic === plan.topic &&
        row.subscribed === (plan.kind === "route.follow")
        ? null
        : "route result differs from accepted topic/state";
    case "agent.create":
      return row.agent === plan.spec.name
        ? null
        : "create result differs from accepted agent";
    case "agent.start":
    case "agent.stop":
      return row.agent === plan.agent && row.desired === plan.desired
        ? null
        : "lifecycle result differs from accepted agent/state";
    case "git.submit":
      return row.candidate === plan.candidate &&
        row.publishedRef === plan.publishedRef &&
        row.message === plan.message.id &&
        row.recipientCount === plan.message.recipients.length
        ? null
        : "submit result differs from accepted plan";
    case "git.integrate":
      for (const field of [
        "base",
        "candidate",
        "target",
        "policyRevision",
      ] as const)
        if (row[field] !== plan[field])
          return `integrate result ${field} differs from accepted plan`;
      if (plan.publication) {
        const publication = row.publication as Record<string, unknown> | undefined;
        if (!publication || publication.message !== plan.publication.message.id ||
            publication.recipientCount !== plan.publication.message.recipients.length ||
            publication.effectiveTier !== plan.publication.tiered.effective || publication.authorityDigest !== plan.publication.tiered.authorityDigest)
          return "integration publication differs from accepted plan";
      } else if (row.publication !== undefined) return "historical integration cannot gain a publication";
      // Preserve the historical optional result shape and its explicit changed fact.
      return plan.result && row.changed !== plan.result.changed
        ? "integrate changed flag differs from accepted result"
        : null;
    case "context.publish":
      return row.previous === plan.base &&
        row.revision === plan.candidate &&
        row.message === plan.message.id &&
        row.recipientCount === plan.message.recipients.length
        ? null
        : "context result differs from accepted plan";
  }
}
