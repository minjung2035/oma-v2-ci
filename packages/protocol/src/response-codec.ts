/** IPC-001/008: response bytes establish transport facts, not replay authority.
 * No Store, Runner, Pi adapter, host configuration I/O or process.exit imports.
 */
import type { PublicMethods, PublicMethod, InternalMethods, InternalResults, Failure, MutationMethod } from "@oma/contracts";
import { StoreError, isErrorCode } from "@oma/domain/errors";
import { parseActor, parseBatchId, parseMessageFileId, parseOperationId } from "@oma/domain/identifiers";
import { checkObject, checkArray, checkString, checkInt, checkBool, checkEnum, checkOid, checkOptional, exactCandidateCheck, type Check } from "@oma/domain/validation";
import { PUBLIC_METHODS, isPublicMethod, isInternalMethod } from "./methods.js";
import { decodeReceipt, decodeFailure } from "./receipt-codec.js";
import { decodeInvocationRejection } from "./invocation-rejection.js";
import { decodeInvocationResolution } from "./invocation-resolution.js";
import { decodeSubmissionPublication } from "./invocation-submission.js";
import { decodeInvocationMail } from "./invocation-mail.js";

export type RpcMethod = PublicMethod | keyof InternalMethods;
export type RpcResult<M extends RpcMethod> = M extends PublicMethod ? PublicMethods[M]["result"] : M extends keyof InternalResults ? InternalResults[M] : never;
export type RpcReply<M extends RpcMethod = RpcMethod> = { readonly ok: true; readonly result: RpcResult<M> } | { readonly ok: false; readonly error: Failure };

export function isRpcMethod(value: unknown): value is RpcMethod { return isPublicMethod(value) || isInternalMethod(value); }
const actor: Check = value => parseActor(value) !== null ? null : "invalid response actor";
const batchId: Check = value => parseBatchId(value) !== null ? null : "invalid response batch ID";
const messageId: Check = value => parseMessageFileId(value) !== null ? null : "invalid response message ID";
const operationId: Check = value => parseOperationId(value) !== null ? null : "invalid response operation ID";
const nonnegative = checkInt({ min: 0 });
const string = checkString();
const nullable = (check: Check): Check => value => value === null ? null : check(value);
const exactlyTrue: Check = value => value === true ? null : "expected true";
const batchShape = checkObject({
  id: batchId, agent: actor, incarnation: nonnegative, messageIds: checkArray(messageId),
  sessionPath: nullable(string), deliveryMode: checkEnum(["steer", "followUp"] as const),
  notice: string, indexPath: value => value === "/inbox.md" ? null : "invalid batch index path",
});
const preparedBatch: Check = value => {
  const error = batchShape(value);
  if (error) return error;
  const batch = value as { messageIds: string[] };
  return new Set(batch.messageIds).size === batch.messageIds.length ? null : "duplicate batch message ID";
};
const agentStatus = checkObject({
  agent: actor, desired: checkEnum(["provisioning", "enabled", "stopped", "retired"] as const),
  activeState: nullable(string), subState: nullable(string), unitResult: nullable(string), execMainStatus: nullable(nonnegative),
  pending: nonnegative, preparedBatches: nonnegative, reason: nullable(string), runnerObservedAtMs: nullable(nonnegative),
});
const riskTier = checkEnum(["LOW", "MEDIUM", "HIGH"] as const);
const reviewKind = checkEnum(["merge", "challenge"] as const);
const reviewMain = checkObject({ oid: nullable(checkOid), observedAtMs: nonnegative });
const reviewTarget = checkObject({ name: checkString({ min: 1 }), integration: operationId, identity: exactCandidateCheck });
const reviewDiff = checkOptional(checkObject({ version: (v: unknown) => v === 1 ? null : "invalid diff version", base: checkOid, candidate: checkOid,
  reference: checkString({ re: /^oma-result:[a-f0-9-]{36}:[a-f0-9]{64}$/ }), bytes: nonnegative, sha256: checkString({ re: /^[a-f0-9]{64}$/ }) }));
const integrationStatus = { revision: nonnegative, scope: nullable(operationId), proposal: exactCandidateCheck, contextDiff: reviewDiff, observedAtMs: checkOptional(checkInt({ min: 0 })), integrationPhase: string, notice: checkEnum(["none", "pending", "delivered"] as const),
  retryable: checkBool(), nextAction: string, attemptNumber: nonnegative, diff: reviewDiff };
const reviewStatusDetail = checkObject({
  name: checkString({ min: 1 }), kind: reviewKind, tier: riskTier, title: string, reason: string,
  ...integrationStatus, requester: actor, identity: exactCandidateCheck, display: string, required: nonnegative,
  normalRequired: nonnegative, maxWorkers: checkInt({ min: 1 }), capacityFallback: checkBool(), principalRequired: checkBool(),
  approvers: checkArray(actor), rejectors: checkArray(actor),
  observedAtMs: nonnegative, remainingApprovals: nonnegative, acceptingWorkerVotes: checkBool(),
  reviewers: checkObject({ items: checkArray(checkObject({ name: actor,
    desired: nullable(checkEnum(["provisioning", "enabled", "stopped", "retired"] as const)),
    exclusions: checkArray(checkEnum(["author", "not-enabled", "missing-mail-send", "missing-agent"] as const)),
    latestVote: nullable(checkEnum(["approve", "reject"] as const)) })), next: nullable(actor) }),
  principal: checkObject({ approval: nullable(messageId), sent: checkBool(),
    decision: nullable(checkEnum(["approve", "reject"] as const)),
    decisionApproval: nullable(messageId) }),
  integration: nullable(checkObject({ operation: operationId,
    state: checkEnum(["pending", "succeeded", "failed", "unknown"] as const), error: nullable(string) })),
  entries: checkArray(checkObject({ index: checkInt({ min: 1 }), sequence: nonnegative, actor,
    kind: checkEnum(["review", "vote", "cancel", "refresh", "challenge.open", "review.withdraw", "review.invalidate", "review.adopt", "review.retry", "review.preparation-failed", "review.revise", "review.integration", "review.supersede", "review.included"] as const),
    verdict: checkOptional(checkEnum(["approve", "reject"] as const)) })),
  missing: checkArray(string), main: reviewMain, target: checkOptional(reviewTarget),
});
const reviewStatusList = checkObject({
  requests: checkArray(checkObject({ name: checkString({ min: 1 }), kind: reviewKind, tier: riskTier,
    title: string, requester: actor, display: string })),
  omitted: nonnegative, next: nullable(checkString({ min: 1 })), main: reviewMain,
});
const reviewStatusPrincipal = checkObject({
  name: checkString({ min: 1 }), kind: reviewKind, tier: riskTier, title: string,
  ...integrationStatus, identity: exactCandidateCheck, approval: nullable(messageId), display: string,
  target: checkOptional(reviewTarget),
});
/** The answer's variant is decided by shape: entries → Worker detail,
 * requests → Worker list, otherwise the minimal Principal view. */
const reviewStatusResult: Check = value => {
  if (reviewStatusDetail(value) === null) return null;
  if (reviewStatusList(value) === null) return null;
  return reviewStatusPrincipal(value);
};
const invocationLinkShape = checkObject({ key: checkString({ re: /^inv1-[a-f0-9]{64}$/ }),
  method: value => typeof value === "string" && isPublicMethod(value) && PUBLIC_METHODS[value].mode === "mutation" ? null : "invalid invocation method",
  phase: checkEnum(["bound", "frozen", "sending", "observed", "resolved", "rejected"]), frozen: checkBool(),
  resolution: checkOptional(value => { const decoded = decodeInvocationResolution(value); return decoded.ok ? null : decoded.reason; }),
  rejection: checkOptional(value => { const decoded = decodeInvocationRejection(value); return decoded.ok ? null : decoded.reason; }),
  mail: checkOptional(value => { const decoded = decodeInvocationMail(value); return decoded.ok ? null : decoded.reason; }),
  publication: checkOptional(value => value !== null && typeof value === "object" ? null : "invalid publication observation") });
const invocationLink: Check = value => {
  const problem = invocationLinkShape(value);
  if (problem !== null) return problem;
  // SAFETY: the closed shape above checked these fields.
  const { phase, frozen, resolution, rejection, method } = value as { phase: string; frozen: boolean; resolution?: unknown; rejection?: unknown; method: string };
  if ((phase === "resolved") !== (resolution !== undefined) || (phase === "resolved" && method !== "attest.record")) return "inconsistent no-effect invocation";
  if ((phase === "rejected") !== (rejection !== undefined) || (rejection !== undefined && (resolution !== undefined || frozen || Object.hasOwn(value as object, "publication") || Object.hasOwn(value as object, "mail")))) return "inconsistent original preaccept completion";
  if (Object.hasOwn(value as object, "publication")) {
    const row = value as { key: string; publication: unknown };
    const publication = decodeSubmissionPublication(row.publication, row.key);
    if (!publication.ok) return publication.reason;
    if (!frozen || method !== "attest.record" || resolution !== undefined) return "publication has no original submission freeze";
  }
  if (Object.hasOwn(value as object, "mail") && (phase !== "observed" || method !== "mail.send")) return "mail observation has no accepted original send";
  return (phase === "bound" && frozen) || (["frozen", "sending", "resolved"].includes(phase) && !frozen) ? "inconsistent invocation phase" : null;
};
const hostError: Check = value => value === null || isErrorCode(value) ? null : "invalid Human observation error";
const controlState = checkEnum(["pending", "unknown", "succeeded", "failed"] as const);
const controlKind = checkEnum(["agent.start", "agent.stop"] as const);
const hostStatus = checkObject({ kind: checkEnum(["status"]), agent: actor,
  desired: checkEnum(["provisioning", "enabled", "stopped", "retired"]), incarnation: nonnegative, registryObservedAtMs: nonnegative,
  control: nullable(checkObject({ operation: operationId, actor, key: string, kind: controlKind, state: controlState })),
  principalControl: nullable(checkObject({ operation: operationId, key: string, kind: controlKind, state: controlState })),
  execution: nullable(checkObject({ activeState: string, subState: string, result: string, execMainStatus: nonnegative, invocationId: string, scope: string })),
  executionObservedAtMs: nonnegative, executionError: hostError, termination: checkEnum(["confirmed-dead", "unconfirmed"]),
  terminationObservedAtMs: nonnegative, terminationError: hostError });
const hostControlResult: Check = value => {
  if (!record(value)) return "invalid Human control result";
  if (value.kind === "status") {
    const error = hostStatus(value);
    if (error) return error;
    return (value.execution === null) !== (value.executionError !== null) ||
      (value.termination === "confirmed-dead" && value.terminationError !== null) ? "inconsistent Human execution observation" : null;
  }
  const error = checkObject({ kind: checkEnum(["receipt"]), key: string, receipt: () => null })(value);
  if (error) return error;
  return value.receipt === null || decodeReceipt(value.receipt).ok ? null : "invalid original Human control receipt";
};
type ReadResultMethod = Exclude<PublicMethod, MutationMethod | "operation.get">;
const checks = {
  "host.control": hostControlResult,
  "invocation.bind": invocationLink,
  "invocation.prepare": invocationLink,
  "operation.read": checkObject({ sha256: checkString({ re: /^[0-9a-f]{64}$/ }), bytes: checkInt({ min: 1 }), offset: nonnegative,
    data: checkString({ min: 1, re: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/ }), next: nullable(nonnegative) }),
  "agent.wait": checkObject({ accepted: checkBool() }),
  "git.known": checkObject({ hasCandidate: checkBool(), prerequisites: checkArray(checkOid) }),
  "status.get": checkObject({ observedAtMs: nonnegative, agents: checkArray(agentStatus), next: checkOptional(actor),
    creation: checkObject({ capability: checkBool(), childProfile: nullable(string), childHasMailSend: nullable(checkBool()),
      maxWorkers: nullable(checkInt({ min: 1 })), workerCount: nonnegative,
      observedAtMs: nonnegative, error: checkOptional(checkObject({ code: string, message: string })) }) }),
  "review.status": reviewStatusResult,
  "logs.read": checkObject({ text: string, truncated: checkBool(), observedAtMs: nonnegative }),
  "runner.open": checkObject({ actor, incarnation: nonnegative, socketHostPath: checkString({ min: 1 }) }),
  "runner.pending": checkObject({ pending: nonnegative, recoverableBatchIds: checkArray(batchId) }),
  "batch.prepare": nullable(preparedBatch),
  "batch.read": preparedBatch,
  "batch.complete": checkObject({ completed: exactlyTrue }),
  "runner.observe": checkObject({ accepted: exactlyTrue }),
  "principal.attach": checkObject({ actor: value => value === "principal" ? null : "expected principal", incarnation: nonnegative }),
  "principal.detach": checkObject({ detached: exactlyTrue }),
} satisfies Record<ReadResultMethod | keyof InternalMethods, Check>;
function invalid(message: string): never { throw new StoreError("BROKER_UNAVAILABLE", `invalid broker response: ${message}`); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function decodeRpcReply<M extends RpcMethod>(method: M, value: unknown, expectedId: string, params: Readonly<Record<string, unknown>>): RpcReply<M> {
  if (!record(value) || value.v !== 1 || value.id !== expectedId || typeof value.ok !== "boolean") invalid("version, ID or success discriminator mismatch");
  const allowed = value.ok ? ["v", "id", "ok", "result"] : ["v", "id", "ok", "error"];
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) invalid("unexpected or missing envelope fields");
  if (!value.ok) {
    const failure = decodeFailure(value.error);
    if (!failure.ok) invalid(failure.reason);
    return { ok: false, error: failure.value };
  }
  let result: unknown;
  if (method === "operation.get") {
    const receipt = decodeReceipt(value.result, { allowNotFound: true });
    if (!receipt.ok) invalid(receipt.reason);
    result = receipt.value;
  } else if (isPublicMethod(method) && PUBLIC_METHODS[method].mode === "mutation") {
    const receipt = decodeReceipt(value.result, { expectedKind: method as MutationMethod });
    if (!receipt.ok) invalid(receipt.reason);
    result = receipt.value;
  } else {
    // A closed finite method registry owns every other result variant.
    if (!Object.hasOwn(checks, method)) invalid("method has no response decoder");
    const error = checks[method as keyof typeof checks](value.result);
    if (error) invalid(error);
    result = value.result;
  }
  if (method === "host.control" && record(result)) {
    if (result.kind === "status") {
      if (params.action !== "inspect" || result.agent !== params.agent) invalid("Human observation belongs to another target");
    } else {
      if (params.action === "inspect" || result.key !== params.key) invalid("Human receipt belongs to another original request");
      if (params.action !== "receipt") {
        const kind = params.action === "stop" ? "agent.stop" : params.action === "release" ? "agent.start" : "society.set";
        if (!decodeReceipt(result.receipt, { expectedKind: kind }).ok) invalid("Human receipt differs from its original action");
      }
    }
  }
  if (method === "runner.open" && record(result) && result.actor !== params.agent) invalid("runner identity differs from requested agent");
  if (method === "batch.read" && record(result) && result.id !== params.batchId) invalid("batch identity differs from requested batch");
  // Boundary-only assertion after the complete, method-indexed runtime check.
  return { ok: true, result: result as RpcResult<M> };
}
