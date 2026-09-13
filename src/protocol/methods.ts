/** IPC-001..005 / AUTH-003: closed protocol metadata, never handler imports.
 * Dynamic authority checks still run in the owning acceptance transaction.
 * This is a wire registry, not the model-facing CLI command allowlist.
 */
import type { Capability } from "../../implementation/contracts/identity.js";
import type { EphemeralMethod, PublicMethod, PublicMethods } from "../../implementation/contracts/public-wire.js";
import type { InternalMethods } from "../../implementation/contracts/internal-wire.js";
import type { MutationMethod } from "../../implementation/contracts/durable.js";
import type { ProtocolLimits } from "../../implementation/contracts/host.js";
import { parseBatchId } from "../ids.js";
import {
  type Check, agentActionParamsCheck, agentContinueParamsCheck,
  agentCreateParamsCheck, agentWaitParamsCheck, checkActor, checkInt,
  checkObject, checkOid, checkOptional, checkString, contextPublishParamsCheck,
  gitIntegrateParamsCheck, gitSubmitParamsCheck, logsReadParamsCheck,
  mailAckParamsCheck, mailParamsCheck, operationGetParamsCheck,
  routeParamsCheck, statusGetParamsCheck,
} from "../validate.js";

export interface ParamsContext {
  readonly actorNames: ReadonlySet<string>;
  readonly limits: ProtocolLimits;
}
export type AuthorityCheck =
  | "current-actor" | "current-capability" | "own-delivery"
  | "self-or-descendant" | "child-delegation" | "own-operation"
  | "published-candidate" | "integration-commit";
export type StreamPolicy = "none" | "optional-bundle" | "required-content";
type PublicDescriptor<M extends PublicMethod> = {
  readonly mode: M extends MutationMethod ? "mutation" : M extends EphemeralMethod ? "ephemeral" : "read";
  readonly key: M extends MutationMethod ? "required" : "forbidden";
  readonly stream: M extends "git.submit" ? "optional-bundle" : M extends "context.publish" ? "required-content" : "none";
  readonly channel: "actor";
  readonly result: M extends MutationMethod ? "receipt" : M;
  readonly capability: Capability | null;
  readonly authority: readonly AuthorityCheck[];
  readonly paramsCheck: (context: ParamsContext) => Check;
};
type PublicDescriptorMap = { readonly [M in PublicMethod]: PublicDescriptor<M> };
const fixed = (check: Check): ((context: ParamsContext) => Check) => () => check;

export const PUBLIC_METHODS = {
  "mail.send": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "mail.send", authority: ["current-actor", "current-capability", "published-candidate"],
    paramsCheck: ({ actorNames, limits }) => mailParamsCheck(actorNames, limits),
  },
  "mail.ack": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: null, authority: ["current-actor", "own-delivery"], paramsCheck: fixed(mailAckParamsCheck),
  },
  "route.follow": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "route.follow", authority: ["current-actor", "current-capability"], paramsCheck: fixed(routeParamsCheck),
  },
  "route.unfollow": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "route.follow", authority: ["current-actor", "current-capability"], paramsCheck: fixed(routeParamsCheck),
  },
  "agent.create": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "agent.create", authority: ["current-actor", "current-capability", "child-delegation"],
    paramsCheck: fixed(agentCreateParamsCheck),
  },
  "agent.start": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: null, authority: ["current-actor", "self-or-descendant"], paramsCheck: fixed(agentActionParamsCheck),
  },
  "agent.stop": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: null, authority: ["current-actor", "self-or-descendant"], paramsCheck: fixed(agentActionParamsCheck),
  },
  "agent.continue": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "mail.send", authority: ["current-actor", "current-capability"], paramsCheck: fixed(agentContinueParamsCheck),
  },
  "agent.wait": {
    mode: "ephemeral", key: "forbidden", stream: "none", channel: "actor", result: "agent.wait",
    capability: null, authority: ["current-actor"], paramsCheck: fixed(agentWaitParamsCheck),
  },
  "git.known": {
    mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "git.known",
    capability: null, authority: ["current-actor"], paramsCheck: fixed(checkObject({ candidate: checkOid })),
  },
  "git.submit": {
    mode: "mutation", key: "required", stream: "optional-bundle", channel: "actor", result: "receipt",
    capability: "git.submit", authority: ["current-actor", "current-capability"],
    paramsCheck: ({ actorNames, limits }) => gitSubmitParamsCheck(actorNames, limits),
  },
  "git.integrate": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "code.integrate", authority: ["current-actor", "current-capability", "published-candidate", "integration-commit"],
    paramsCheck: fixed(gitIntegrateParamsCheck),
  },
  "context.publish": {
    mode: "mutation", key: "required", stream: "required-content", channel: "actor", result: "receipt",
    capability: "context.publish", authority: ["current-actor", "current-capability"],
    paramsCheck: ({ limits }) => contextPublishParamsCheck(limits),
  },
  "operation.get": {
    mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "operation.get",
    capability: null, authority: ["current-actor", "own-operation"], paramsCheck: fixed(operationGetParamsCheck),
  },
  "status.get": {
    mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "status.get",
    capability: null, authority: ["current-actor"], paramsCheck: fixed(statusGetParamsCheck),
  },
  "logs.read": {
    mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "logs.read",
    capability: null, authority: ["current-actor"], paramsCheck: fixed(logsReadParamsCheck),
  },
} as const satisfies PublicDescriptorMap;

export function isPublicMethod(value: unknown): value is PublicMethod {
  return typeof value === "string" && Object.hasOwn(PUBLIC_METHODS, value);
}

/** Validation is shared by stream preflight and dispatch; no coercion or sorting. */
export function decodePublicParams<M extends PublicMethod>(
  method: M, value: unknown, context: ParamsContext,
): PublicMethods[M]["params"] | null {
  if (PUBLIC_METHODS[method].paramsCheck(context)(value) !== null) return null;
  return value as PublicMethods[M]["params"];
}

export type InternalChannel = "runner" | "host" | "extension";
interface InternalDescriptor {
  readonly channel: InternalChannel;
  readonly key: "forbidden";
  readonly stream: "none";
  readonly lease: "open" | "current-run" | "principal-session" | "host-unit";
  readonly evidence: "none" | "boundary" | "principal-credential";
  readonly paramsCheck: Check;
}
const noParams = checkObject({});
const batchIdCheck: Check = value => parseBatchId(value) === null ? "invalid batch id" : null;
export const INTERNAL_METHODS = {
  "runner.open": { channel: "runner", key: "forbidden", stream: "none", lease: "open", evidence: "none",
    paramsCheck: checkObject({ agent: checkActor, invocationId: checkString({ re: /^[0-9a-f]{32}$/ }) }) },
  "runner.pending": { channel: "runner", key: "forbidden", stream: "none", lease: "current-run", evidence: "none", paramsCheck: noParams },
  "batch.prepare": { channel: "runner", key: "forbidden", stream: "none", lease: "current-run", evidence: "none", paramsCheck: noParams },
  "batch.read": { channel: "extension", key: "forbidden", stream: "none", lease: "principal-session", evidence: "none",
    paramsCheck: checkObject({ batchId: batchIdCheck }) },
  "batch.complete": { channel: "runner", key: "forbidden", stream: "none", lease: "current-run", evidence: "boundary",
    paramsCheck: checkObject({ batchId: batchIdCheck, incarnation: checkInt(), sessionPath: checkString(),
      adapterRevision: checkString(), receiptPath: checkString() }) },
  "runner.observe": { channel: "runner", key: "forbidden", stream: "none", lease: "current-run", evidence: "none",
    paramsCheck: checkObject({ reason: checkString(), toolName: checkOptional(checkString()), observedAtMs: checkInt({ min: 0 }) }) },
  "principal.attach": { channel: "extension", key: "forbidden", stream: "none", lease: "principal-session", evidence: "principal-credential",
    paramsCheck: checkObject({ sessionHandle: checkString(), credential: checkString() }) },
  "principal.detach": { channel: "extension", key: "forbidden", stream: "none", lease: "principal-session", evidence: "none", paramsCheck: noParams },
  "host.principalRelay": { channel: "host", key: "forbidden", stream: "none", lease: "host-unit", evidence: "none", paramsCheck: noParams },
  "host.reconcile": { channel: "host", key: "forbidden", stream: "none", lease: "host-unit", evidence: "none", paramsCheck: noParams },
} as const satisfies Record<keyof InternalMethods, InternalDescriptor>;

export function isInternalMethod(value: unknown): value is keyof InternalMethods {
  return typeof value === "string" && Object.hasOwn(INTERNAL_METHODS, value);
}