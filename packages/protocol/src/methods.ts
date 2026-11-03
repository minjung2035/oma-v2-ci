/** IPC-001..005 / AUTH-003: closed protocol metadata, never handler imports.
 * Dynamic authority checks still run in the owning acceptance transaction.
 * This is a wire registry, not the model-facing CLI command allowlist.
 */
import type { Capability } from "@oma/contracts/identity";
import type {
  EphemeralMethod,
  PublicMethod,
  PublicMethods,
} from "@oma/contracts/public-wire";
import type { InternalMethods } from "@oma/contracts/internal-wire";
import type { MutationMethod } from "@oma/contracts/durable";
import type { ProtocolLimits } from "@oma/contracts/host";
import { parseBatchId, parseOperationId, isValidRequestKey } from "@oma/domain/identifiers";
import { decodeFailure } from "./failure-codec.js";
import {
  type Check,
  checkBlobDescriptor,
  attestationParamsCheck,
  agentActionParamsCheck,
  societySetParamsCheck,
  agentContinueParamsCheck,
  agentCreateParamsCheckFor,
  agentWaitParamsCheck,
  checkActor,
  checkEnum,
  checkInt,
  checkObject,
  checkOid,
  checkOptional,
  checkString,
  contextPublishParamsCheck,
  gitIntegrateParamsCheck,
  gitSubmitParamsCheck,
  logsReadParamsCheck,
  mailAckParamsCheck,
  mailParamsCheck,
  operationGetParamsCheck,
  operationReadParamsCheck,
  routeParamsCheck,
  statusGetParamsCheck,
  reviewStatusParamsCheck,
} from "@oma/domain/validation";

/** What a method's parameter check may depend on. P0V-125 (G02-ledger-r2-01):
 * it held the society's whole agent list, which no check read, and every
 * public request decoded that list to build it. */
export interface ParamsContext {
  readonly limits: ProtocolLimits;
}
export type AuthorityCheck =
  | "current-actor"
  | "current-capability"
  | "own-delivery"
  | "self-or-descendant"
  | "child-delegation"
  | "own-operation"
  | "published-candidate"
  | "integration-commit";
export type StreamPolicy = "none" | "optional-bundle" | "optional-content" | "required-content";
type PublicDescriptor<M extends PublicMethod> = {
  readonly mode: M extends MutationMethod
    ? "mutation"
    : M extends EphemeralMethod
      ? "ephemeral"
      : "read";
  readonly key: M extends MutationMethod ? "required" : "forbidden";
  readonly stream: M extends "git.submit"
    ? "optional-bundle"
    : M extends "context.publish"
      ? "required-content"
      : M extends "invocation.prepare" | "mail.send" | "agent.create" ? "optional-content" : "none";
  readonly channel: "actor";
  readonly result: M extends MutationMethod ? "receipt" : M;
  readonly capability: Capability | null;
  readonly authority: readonly AuthorityCheck[];
  readonly paramsCheck: (context: ParamsContext) => Check;
};
type PublicDescriptorMap = {
  readonly [M in PublicMethod]: PublicDescriptor<M>;
};
const fixed =
  (check: Check): ((context: ParamsContext) => Check) =>
  () =>
    check;

/** DR27: a live Principal reviews, communicates and controls safety. Legacy
 * broad grants cannot restore routine orchestration through raw actor RPC. */
export function principalRequestAllowed(method: PublicMethod, params: object): boolean {
  switch (method) {
    case "invocation.bind": return true;
    case "invocation.prepare": {
      if (!("content" in params)) return true;
      const content = params.content;
      return content !== null && typeof content === "object" && "mediaType" in content && content.mediaType === "application/vnd.oma.context-v1";
    }
    case "society.set": case "attest.record": case "mail.send":
    case "agent.start": case "agent.stop": case "git.known":
    case "operation.get": case "operation.read": case "review.status": return true;
    case "context.publish": return Object.hasOwn(params, "goalMail");
    case "mail.ack": case "route.follow": case "route.unfollow": case "agent.create":
    case "agent.continue": case "agent.wait": case "git.submit": case "git.integrate":
    case "status.get": case "logs.read": return false;
  }
}

export const PUBLIC_METHODS = {
  "invocation.bind": {
    mode: "ephemeral", key: "forbidden", stream: "none", channel: "actor", result: "invocation.bind",
    capability: null, authority: ["current-actor", "own-operation"],
    paramsCheck: fixed(checkObject({ contract: checkEnum(["collaboration-v1"]),
      origin: checkObject({ file: checkString({ min: 1, re: /^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/ }),
        session: checkString({ min: 1 }), branch: checkString({ min: 1 }), toolCall: checkString({ min: 1 }) }),
      tool: checkString({ min: 1 }), arguments: value => value !== null && typeof value === "object" && !Array.isArray(value) ? null : "expected action arguments" })),
  },
  "invocation.prepare": {
    mode: "ephemeral", key: "forbidden", stream: "optional-content", channel: "actor", result: "invocation.prepare",
    capability: null, authority: ["current-actor", "own-operation"],
    paramsCheck: context => value => {
      if (value !== null && typeof value === "object" && Object.hasOwn(value, "reject"))
        return checkObject({ contract: checkEnum(["collaboration-v1"]), key: checkString({ re: /^inv1-[a-f0-9]{64}$/ }),
          reject: raw => { const decoded = decodeFailure(raw); return decoded.ok ? null : decoded.reason; } })(value);
      return checkObject({ contract: checkEnum(["collaboration-v1"]), key: checkString({ re: /^inv1-[a-f0-9]{64}$/ }),
      params: value => value !== null && typeof value === "object" && !Array.isArray(value) ? null : "expected frozen parameters",
      content: checkOptional(value => {
        const problem = checkBlobDescriptor(Math.max(context.limits.contextBytes, context.limits.bundleBytes))(value);
        if (problem !== null) return problem;
        // SAFETY: the closed BlobDescriptor checker above validated both fields.
        const descriptor = value as { bytes: number; mediaType: string };
        const bound = (descriptor.mediaType === "application/x-git-bundle" || descriptor.mediaType === "application/vnd.oma.attachments-v1") ? context.limits.bundleBytes :
          descriptor.mediaType === "application/vnd.oma.context-v1" ? context.limits.contextBytes : 0;
        return descriptor.bytes <= bound && bound > 0 ? null : "unsupported original source stream or effective bound exceeded";
      }) })(value);
    },
  },
  "society.set": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "agent.manage.descendants",  authority: ["current-actor", "current-capability"],
    paramsCheck: fixed(societySetParamsCheck),
  },
  "attest.record": {
    mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt",
    capability: "mail.send",  authority: ["current-actor", "current-capability"],
    paramsCheck: context => value => attestationParamsCheck(value, context.limits),
  },
  "mail.send": {
    mode: "mutation",
    key: "required",
    stream: "optional-content",
    channel: "actor",
    result: "receipt",
    capability: "mail.send",
    authority: ["current-actor", "current-capability", "published-candidate"],
    paramsCheck: ({ limits }) =>
      mailParamsCheck(limits),
  },
  "mail.ack": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: null,
    authority: ["current-actor", "own-delivery"],
    paramsCheck: fixed(mailAckParamsCheck),
  },
  "route.follow": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: "route.follow",
    authority: ["current-actor", "current-capability"],
    paramsCheck: fixed(routeParamsCheck),
  },
  "route.unfollow": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: "route.follow",
    authority: ["current-actor", "current-capability"],
    paramsCheck: fixed(routeParamsCheck),
  },
  "agent.create": {
    mode: "mutation",
    key: "required",
    stream: "optional-content",
    channel: "actor",
    result: "receipt",
    capability: "agent.create",
    authority: ["current-actor", "current-capability", "child-delegation"],
    paramsCheck: ({ limits }) => agentCreateParamsCheckFor(limits),
  },
  "agent.start": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: null,
    authority: ["current-actor", "self-or-descendant"],
    paramsCheck: fixed(agentActionParamsCheck),
  },
  "agent.stop": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: null,
    authority: ["current-actor", "self-or-descendant"],
    paramsCheck: fixed(agentActionParamsCheck),
  },
  "agent.continue": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: "mail.send",
    authority: ["current-actor", "current-capability"],
    paramsCheck: fixed(agentContinueParamsCheck),
  },
  "agent.wait": {
    mode: "ephemeral",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "agent.wait",
    capability: null,
    authority: ["current-actor"],
    paramsCheck: fixed(agentWaitParamsCheck),
  },
  "git.known": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "git.known",
    capability: null,
    authority: ["current-actor"],
    paramsCheck: fixed(checkObject({ candidate: checkOid, reachable: checkOptional(value => value === true ? null : "reachable must be true when present") })),
  },
  "git.submit": {
    mode: "mutation",
    key: "required",
    stream: "optional-bundle",
    channel: "actor",
    result: "receipt",
    capability: "git.submit",
    authority: ["current-actor", "current-capability"],
    paramsCheck: ({ limits }) =>
      gitSubmitParamsCheck(limits),
  },
  "git.integrate": {
    mode: "mutation",
    key: "required",
    stream: "none",
    channel: "actor",
    result: "receipt",
    capability: "code.integrate",
    authority: [
      "current-actor",
      "current-capability",
      "published-candidate",
      "integration-commit",
    ],
    paramsCheck: fixed(gitIntegrateParamsCheck),
  },
  "context.publish": {
    mode: "mutation",
    key: "required",
    stream: "required-content",
    channel: "actor",
    result: "receipt",
    capability: "context.publish",
    authority: ["current-actor", "current-capability"],
    paramsCheck: ({ limits }) => contextPublishParamsCheck(limits),
  },
  "operation.get": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "operation.get",
    capability: null,
    authority: ["current-actor", "own-operation"],
    paramsCheck: fixed(operationGetParamsCheck),
  },
  "operation.read": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "operation.read",
    capability: null,
    authority: ["current-actor", "own-operation"],
    paramsCheck: fixed(operationReadParamsCheck),
  },
  "status.get": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "status.get",
    capability: null,
    authority: ["current-actor"],
    paramsCheck: fixed(statusGetParamsCheck),
  },
  "review.status": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "review.status",
    capability: null,
    authority: ["current-actor"],
    paramsCheck: fixed(reviewStatusParamsCheck),
  },
  "logs.read": {
    mode: "read",
    key: "forbidden",
    stream: "none",
    channel: "actor",
    result: "logs.read",
    capability: null,
    authority: ["current-actor"],
    paramsCheck: fixed(logsReadParamsCheck),
  },
} as const satisfies PublicDescriptorMap;

export function isPublicMethod(value: unknown): value is PublicMethod {
  return typeof value === "string" && Object.hasOwn(PUBLIC_METHODS, value);
}

/** The bound-free profile: every wire grammar check (field shape, identifier,
 * enum and cross-field rule) with only the deployment's numeric bounds lifted.
 * It is the grammar half of decodePublicParams -- the part a durable accepted
 * request is classified by forever. Live limits still gate new work; they may
 * tighten after acceptance without rewriting what a same-key lookup answers. */
export const UNBOUNDED_PUBLIC_LIMITS: ProtocolLimits = Object.freeze({
  frameBytes: Number.MAX_SAFE_INTEGER, mailBodyBytes: Number.MAX_SAFE_INTEGER,
  subjectBytes: Number.MAX_SAFE_INTEGER, addresses: Number.MAX_SAFE_INTEGER,
  replyReferences: Number.MAX_SAFE_INTEGER, contextFiles: Number.MAX_SAFE_INTEGER,
  contextBytes: Number.MAX_SAFE_INTEGER, bundleBytes: Number.MAX_SAFE_INTEGER,
  logBytes: Number.MAX_SAFE_INTEGER, batchMaxMessages: Number.MAX_SAFE_INTEGER,
  idleStreamSeconds: Number.MAX_SAFE_INTEGER, receiptWaitSeconds: Number.MAX_SAFE_INTEGER,
});

/** Validation is shared by stream preflight and dispatch; no coercion or sorting. */
export function decodePublicParams<M extends PublicMethod>(
  method: M,
  value: unknown,
  context: ParamsContext,
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
const batchIdCheck: Check = (value) =>
  parseBatchId(value) === null ? "invalid batch id" : null;
const hostRequestKey: Check = value => isValidRequestKey(value) ? null : "invalid original Human request key";
const hostMutationKey: Check = value => typeof value === "string" && value.startsWith("human-") && value.length > 6 && isValidRequestKey(value)
  ? null : "fresh Human control keys must use the human- namespace; receipt reads retain legacy keys";
const hostControlParams: Check = value => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected Human control parameters";
  const action = Object.getOwnPropertyDescriptor(value, "action")?.value;
  if (action === "inspect") return checkObject({ action: checkEnum(["inspect"]), agent: checkActor })(value);
  if (action === "receipt") return checkObject({ action: checkEnum(["receipt"]), key: hostRequestKey })(value);
  if (action === "society") return checkObject({ action: checkEnum(["society"]), state: checkEnum(["open", "closed"]), key: hostMutationKey })(value);
  if (action === "stop" || action === "release") return checkObject({ action: checkEnum(["stop", "release"]), agent: checkActor, key: hostMutationKey,
    expected: checkObject({ incarnation: checkInt({ min: 0 }), desired: checkEnum(["provisioning", "enabled", "stopped", "retired"]),
      control: v => v === null || parseOperationId(v) !== null ? null : "invalid original control identity" }) })(value);
  return "unknown Human control action";
};
export const INTERNAL_METHODS = {
  "host.control": { channel: "host", key: "forbidden", stream: "none", lease: "host-unit", evidence: "none", paramsCheck: hostControlParams },
  "runner.open": {
    channel: "runner",
    key: "forbidden",
    stream: "none",
    lease: "open",
    evidence: "none",
    paramsCheck: checkObject({
      agent: checkActor,
      invocationId: checkString({ re: /^[0-9a-f]{32}$/ }),
    }),
  },
  "runner.pending": {
    channel: "runner",
    key: "forbidden",
    stream: "none",
    lease: "current-run",
    evidence: "none",
    paramsCheck: noParams,
  },
  "batch.prepare": {
    channel: "runner",
    key: "forbidden",
    stream: "none",
    lease: "current-run",
    evidence: "none",
    paramsCheck: noParams,
  },
  "batch.read": {
    channel: "extension",
    key: "forbidden",
    stream: "none",
    lease: "principal-session",
    evidence: "none",
    paramsCheck: checkObject({ batchId: batchIdCheck }),
  },
  "batch.complete": {
    channel: "runner",
    key: "forbidden",
    stream: "none",
    lease: "current-run",
    evidence: "boundary",
    paramsCheck: checkObject({
      batchId: batchIdCheck,
      incarnation: checkInt(),
      sessionPath: checkOptional(checkString()),
      adapterRevision: checkString(),
      receiptPath: checkOptional(checkString()),
    }),
  },
  "runner.observe": {
    channel: "runner",
    key: "forbidden",
    stream: "none",
    lease: "current-run",
    evidence: "none",
    paramsCheck: checkObject({
      reason: checkString(),
      toolName: checkOptional(checkString()),
      observedAtMs: checkInt({ min: 0 }),
    }),
  },
  "principal.attach": {
    channel: "extension",
    key: "forbidden",
    stream: "none",
    lease: "principal-session",
    evidence: "principal-credential",
    paramsCheck: checkObject({
      sessionHandle: checkString(),
      credential: checkString(),
    }),
  },
  "principal.detach": {
    channel: "extension",
    key: "forbidden",
    stream: "none",
    lease: "principal-session",
    evidence: "none",
    paramsCheck: noParams,
  },
} as const satisfies Record<keyof InternalMethods, InternalDescriptor>;

/** P0V-32, P0-2: the one reading of an internal request's envelope, for every
 * endpoint that serves internal methods -- the runner and host channels and
 * the Principal's attach, detach and delivery endpoints alike. It decides
 * nothing about authority; each endpoint still asks its own questions after
 * it. null when the envelope is well formed. */
export function internalEnvelopeProblem(raw: Record<string, unknown>): string | null {
  const params = raw.params;
  return raw.v === 1 && typeof raw.id === "string" && typeof raw.method === "string" &&
    typeof params === "object" && params !== null && !Array.isArray(params) &&
    Object.keys(raw).every(key => key === "v" || key === "id" || key === "method" || key === "params")
    ? null : "invalid internal envelope";
}
export function isInternalMethod(
  value: unknown,
): value is keyof InternalMethods {
  return typeof value === "string" && Object.hasOwn(INTERNAL_METHODS, value);
}
