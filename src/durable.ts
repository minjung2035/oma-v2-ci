// MUST [DB-009/M-003]: durable operation plans are closed runtime DTOs.
// This module is deliberately store-independent so Store can validate every
// plan_json read before recovery code can use it for filesystem/Git effects.
import { join } from "node:path";
import type { Capability } from "../implementation/contracts.js";
import {
  checkArray,
  checkEnum,
  checkInt,
  checkObject,
  checkOid,
  checkString,
  messagePlanCheck,
  operationResultCheck,
  type Check,
} from "./validate.js";
import {
  isValidActorName,
  isValidMessageId,
  isValidOperationId,
  parseMessageId,
} from "./ids.js";

const operationIdCheck: Check = (value) =>
  isValidOperationId(value) ? null : "invalid operation id";
const messageIdCheck: Check = (value) =>
  isValidMessageId(value) ? null : "invalid message id";
const sha256Check = checkString({ re: /^[0-9a-f]{64}$/ });
const nonEmpty = checkString({ min: 1 });
const actorOrPrincipal: Check = (value) =>
  value === "principal" ||
  (typeof value === "string" && isValidActorName(value))
    ? null
    : "invalid actor";

const capabilities = [
  "mail.send",
  "route.follow",
  "agent.create",
  "agent.manage.self",
  "agent.manage.descendants",
  "git.submit",
  "code.integrate",
  "context.publish",
] as const satisfies readonly Capability[];

const resourceCheck = checkObject({
  memoryBytes: checkInt({ min: 1 }),
  tasks: checkInt({ min: 1 }),
  cpuQuotaPercent: checkInt({ min: 1 }),
  tmpBytes: checkInt({ min: 1 }),
  workspaceBytes: checkInt({ min: 1 }),
  stagingBytes: checkInt({ min: 1 }),
  checkTimeoutSeconds: checkInt({ min: 1 }),
});

const resolvedSpecCheck = checkObject({
  name: (value) =>
    typeof value === "string" && isValidActorName(value)
      ? null
      : "invalid agent name",
  from: checkOid,
  brief: nonEmpty,
  profile: nonEmpty,
  capabilities: checkArray(checkEnum(capabilities)),
  modelProfile: nonEmpty,
  resources: resourceCheck,
});

const nullableMessagePlan: Check = (value) =>
  value === null ? null : messagePlanCheck(value);
const nullableOperationId: Check = (value) =>
  value === null ? null : operationIdCheck(value);
const nullableOid: Check = (value) => (value === null ? null : checkOid(value));

const integrateBaseCheck = checkObject({
  kind: checkEnum(["git.integrate"] as const),
  repo: checkEnum(["project"] as const),
  target: checkEnum(["refs/heads/main"] as const),
  base: checkOid,
  candidate: checkOid,
  policyRevision: nonEmpty,
  checkProfileDigest: sha256Check,
});
const integrateWithResultCheck = checkObject({
  kind: checkEnum(["git.integrate"] as const),
  repo: checkEnum(["project"] as const),
  target: checkEnum(["refs/heads/main"] as const),
  base: checkOid,
  candidate: checkOid,
  policyRevision: nonEmpty,
  checkProfileDigest: sha256Check,
  result: operationResultCheck("git.integrate"),
});
const contextPlanShape = checkObject({
  kind: checkEnum(["context.publish"] as const),
  base: nullableOid,
  candidate: checkOid,
  target: checkEnum(["refs/heads/main"] as const),
  entries: checkArray(checkObject({
    path: nonEmpty,
    bytes: checkInt({ min: 0 }),
    sha256: sha256Check,
  })),
  stagingPath: nonEmpty,
  message: messagePlanCheck,
});

const checks: Readonly<Record<string, Check>> = {
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
    topic: checkString({ min: 1 }),
    agent: actorOrPrincipal,
  }),
  "route.unfollow": checkObject({
    kind: checkEnum(["route.unfollow"] as const),
    topic: checkString({ min: 1 }),
    agent: actorOrPrincipal,
  }),
  "agent.create": checkObject({
    kind: checkEnum(["agent.create"] as const),
    spec: resolvedSpecCheck,
    specHash: nonEmpty,
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
    exportRef: checkString({ re: /^refs\/oma\/export\/[A-Za-z0-9._-]{1,96}$/ }),
    prerequisites: checkArray(checkOid),
    bundle: (value) => value === null ? null : checkObject({
      path: nonEmpty,
      sha256: sha256Check,
      bytes: checkInt({ min: 1 }),
    })(value),
    publishedRef: nonEmpty,
    message: messagePlanCheck,
  }),
  // `result` is retained only for compatibility with already accepted rows.
  "git.integrate": (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "expected object";
    return Object.prototype.hasOwnProperty.call(value, "result")
      ? integrateWithResultCheck(value)
      : integrateBaseCheck(value);
  },
  "context.publish": (value) => {
    const shape = contextPlanShape(value);
    if (shape) return shape;
    const plan = value as { candidate: unknown; message: { contextRevision: unknown; kind: unknown } };
    if (plan.message.kind !== "context") return "context publish message kind mismatch";
    if (plan.message.contextRevision !== plan.candidate)
      return "context candidate/message revision mismatch";
    return null;
  },
};

export interface OperationPlanContext {
  operationId: string;
  actor: string;
  stateRoot: string;
}

export function operationPlanCheck(
  kind: string,
  context?: OperationPlanContext,
): Check {
  const base = checks[kind] ?? (() => `unknown operation kind ${kind}`);
  return (value) => {
    const invalid = base(value);
    if (invalid || !context) return invalid;
    if (!isValidOperationId(context.operationId)) return "invalid operation identity";
    const plan = value as Record<string, unknown>;

    const rawMessage = plan.message ?? plan.initialMessage;
    if (rawMessage && typeof rawMessage === "object" && !Array.isArray(rawMessage)) {
      const message = rawMessage as { id?: unknown; objectPath?: unknown };
      if (
        typeof message.id !== "string" ||
        parseMessageId(message.id)?.operationId !== context.operationId ||
        message.objectPath !== `mail/objects/${message.id}.eml`
      ) return "message identity/path does not match operation";
    }

    if (kind === "agent.create") {
      const spec = plan.spec as { name?: unknown } | undefined;
      if (
        typeof spec?.name !== "string" ||
        plan.workspacePath !== join(context.stateRoot, "agents", spec.name, "workspace")
      ) return "create workspace path does not match state root/agent";
    }

    if (kind === "git.submit") {
      if (plan.publishedRef !== `refs/oma/published/${context.actor}/${context.operationId}`)
        return "published ref does not match actor/operation";
      const bundle = plan.bundle as { path?: unknown } | null | undefined;
      if (
        bundle &&
        bundle.path !== join(
          context.stateRoot,
          "staging",
          `submit-${context.operationId}`,
          "upload.bundle",
        )
      ) return "bundle path does not match operation staging root";
    }

    if (
      kind === "context.publish" &&
      plan.stagingPath !== join(
        context.stateRoot,
        "staging",
        `context-${context.operationId}`,
      )
    ) return "context staging path does not match operation";

    return null;
  };
}

/** DB-009: a closed success DTO must also describe the effect accepted in plan_json. */
export function operationResultRelationCheck(
  kind: string,
  planValue: unknown,
  resultValue: unknown,
  context: OperationPlanContext,
): string | null {
  const plan = planValue as Record<string, unknown>;
  const result = resultValue as Record<string, unknown>;
  const message = plan.message as
    | { id?: unknown; recipients?: unknown[] }
    | undefined;
  const recipientCount = Array.isArray(message?.recipients)
    ? message.recipients.length
    : null;

  switch (kind) {
    case "mail.send":
    case "agent.continue": {
      if (result.message !== message?.id)
        return "result message does not match accepted message";
      if (result.recipientCount !== recipientCount)
        return "result recipient count does not match accepted snapshot";
      if (
        typeof message?.id !== "string" ||
        result.archivePath !== join(
          context.stateRoot,
          "mail",
          "archive",
          "cur",
          `${message.id}:2,`,
        )
      ) return "result archive path does not match accepted message";
      return null;
    }
    case "mail.ack":
      return result.message === plan.message
        ? null
        : "ack result message does not match accepted plan";
    case "route.follow":
    case "route.unfollow":
      if (result.topic !== plan.topic)
        return "route result topic does not match accepted plan";
      return result.subscribed === (kind === "route.follow")
        ? null
        : "route result subscription state does not match operation kind";
    case "agent.create": {
      const spec = plan.spec as { name?: unknown } | undefined;
      return result.agent === spec?.name
        ? null
        : "create result agent does not match accepted spec";
    }
    case "agent.start":
    case "agent.stop":
      if (result.agent !== plan.agent)
        return "lifecycle result agent does not match accepted plan";
      return result.desired === plan.desired
        ? null
        : "lifecycle result desired state does not match accepted plan";
    case "git.submit":
      if (result.candidate !== plan.candidate)
        return "submit result candidate does not match accepted plan";
      if (result.publishedRef !== plan.publishedRef)
        return "submit result ref does not match accepted plan";
      if (result.message !== message?.id)
        return "submit result message does not match accepted plan";
      return result.recipientCount === recipientCount
        ? null
        : "submit result recipient count does not match accepted snapshot";
    case "git.integrate": {
      for (const key of ["base", "candidate", "target", "policyRevision"] as const) {
        if (result[key] !== plan[key])
          return `integrate result ${key} does not match accepted plan`;
      }
      const acceptedResult = plan.result;
      if (
        acceptedResult &&
        typeof acceptedResult === "object" &&
        !Array.isArray(acceptedResult) &&
        result.changed !== (acceptedResult as Record<string, unknown>).changed
      ) return "integrate result changed flag does not match accepted result";
      return null;
    }
    case "context.publish":
      if (result.previous !== plan.base)
        return "context result previous revision does not match accepted base";
      if (result.revision !== plan.candidate)
        return "context result revision does not match accepted candidate";
      if (result.message !== message?.id)
        return "context result message does not match accepted plan";
      return result.recipientCount === recipientCount
        ? null
        : "context result recipient count does not match accepted snapshot";
    default:
      return `unknown operation kind ${kind}`;
  }
}
