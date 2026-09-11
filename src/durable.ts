// MUST [DB-009/M-003]: durable DB JSON crosses a trust boundary on every read.
// Recovery and same-key retry must reject malformed/extended variants before
// using them for filesystem/Git effects or returning them as successful receipts.
import type {
  Capability,
  OperationPlan,
  Receipt,
} from "../implementation/contracts.js";
import type { OperationRow } from "./store.js";
import { StoreError } from "./store.js";
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
  // `result` is retained only for compatibility with accepted branch rows;
  // new integration plans should derive the receipt from frozen plan fields.
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
    // Existing accepted rows may be between T-context-accept and candidate
    // commit publication. This is closed (only "" or a valid OID) but remains
    // a DB-009 ordering debt until candidate is frozen before acceptance.
    candidate: (value) => value === "" ? null : checkOid(value),
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

export function parseOperationPlan(op: Pick<OperationRow, "id" | "kind" | "planJson">): OperationPlan {
  let value: unknown;
  try {
    value = JSON.parse(op.planJson);
  } catch (error) {
    throw new StoreError(
      "STORE_CORRUPT",
      `operation ${op.id} has corrupt plan JSON: ${(error as Error).message}`,
    );
  }
  const check = checks[op.kind];
  if (!check)
    throw new StoreError("STORE_CORRUPT", `operation ${op.id} has unknown kind ${op.kind}`);
  const invalid = check(value);
  if (invalid)
    throw new StoreError("STORE_CORRUPT", `operation ${op.id} plan: ${invalid}`);
  return value as OperationPlan;
}

export function receiptFromOperation(op: OperationRow): Receipt {
  const state = op.state;
  const receipt: Receipt = { operation: op.id, state };
  if (state === "succeeded") {
    if (!op.resultJson)
      throw new StoreError("STORE_CORRUPT", `succeeded operation ${op.id} has no result`);
    let result: unknown;
    try {
      result = JSON.parse(op.resultJson);
    } catch (error) {
      throw new StoreError(
        "STORE_CORRUPT",
        `operation ${op.id} has corrupt result JSON: ${(error as Error).message}`,
      );
    }
    const invalid = operationResultCheck(op.kind)(result);
    if (invalid)
      throw new StoreError("STORE_CORRUPT", `operation ${op.id} result: ${invalid}`);
    receipt.result = result as Exclude<Receipt["result"], undefined>;
  } else if (op.resultJson !== null) {
    throw new StoreError("STORE_CORRUPT", `non-success operation ${op.id} has a result`);
  }

  if (state === "failed") {
    if (!op.errorCode)
      throw new StoreError("STORE_CORRUPT", `failed operation ${op.id} has no error code`);
    receipt.error = {
      code: op.errorCode,
      message: op.errorCode,
      retry: "never",
    };
  } else if (op.errorCode !== null) {
    throw new StoreError("STORE_CORRUPT", `non-failed operation ${op.id} has an error code`);
  }
  return receipt;
}
