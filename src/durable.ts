// MUST [DB-009/M-003]: durable operation plans are closed runtime DTOs.
// This module is deliberately store-independent so Store can validate every
// plan_json read before recovery code can use it for filesystem/Git effects.
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
import { isValidActorName } from "./ids.js";

const operationIdCheck = checkString({ re: /^op-[0-9a-f-]{36}$/ });
const messageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\d+$/ });
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
    publishedRef: checkString({ re: /^refs\/oma\/published\/[a-z][a-z0-9-]{0,31}\/op-[0-9a-f-]{36}$/ }),
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
  "context.publish": checkObject({
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
  }),
};

export function operationPlanCheck(kind: string): Check {
  return checks[kind] ?? (() => `unknown operation kind ${kind}`);
}
