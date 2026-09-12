// MUST [M-003]: runtime schema validation at trust boundaries; unknown fields are
// rejected; `as SomeType` is never validation. Validators return an error string
// or null; they do not coerce.
import type { Json, RequestKey } from "../implementation/contracts.js";
import { contextEntriesCheck } from "./domain/context-policy.js";
import { isExportRef, isPublishedRef, isMailObjectRelativePath } from "./domain/derived.js";
export { contextPathCheck, contextFileCheck } from "./domain/context-policy.js";
import { exactCandidateCheck, headerMessageIdCheck, messageKindCheck, logicalAddressCheck as checkLogicalAddress } from "./domain/mail-values.js";
export { exactCandidateCheck, logicalAddressCheck as checkLogicalAddress } from "./domain/mail-values.js";
import {
  isValidActorName,
  isValidRequestKey,
  isValidFullOid,
  isValidTopicName,
  isValidWirePath,
  isValidMessageId,
  isValidOperationId,
} from "./ids.js";

export type Check = (v: unknown) => string | null;
const OPTIONAL = Symbol("optional");
type OptionalCheck = Check & { [OPTIONAL]?: true };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Unknown-field-rejecting object check. `spec` keys are the only allowed fields. */
export function checkObject(spec: Readonly<Record<string, Check>>): Check {
  return (v) => {
    if (!isPlainObject(v)) return `expected object, got ${typeName(v)}`;
    for (const [key, c] of Object.entries(spec)) {
      if (!Object.prototype.hasOwnProperty.call(v, key)) {
        if (!(c as OptionalCheck)[OPTIONAL]) return `missing field "${key}"`;
        continue;
      }
      const err = c(v[key]);
      if (err) return `field "${key}": ${err}`;
    }
    for (const key of Object.keys(v)) {
      if (!Object.prototype.hasOwnProperty.call(spec, key)) return `unknown field "${key}"`;
    }
    return null;
  };
}

export function checkOptional(spec: Check): Check {
  const check = ((v: unknown) => v === undefined ? null : spec(v)) as OptionalCheck;
  check[OPTIONAL] = true;
  return check;
}

export function checkString(opts?: { min?: number; max?: number; re?: RegExp }): Check {
  return (v) => {
    if (typeof v !== "string") return `expected string, got ${typeName(v)}`;
    if (/\p{Cs}/u.test(v)) return "unpaired Unicode surrogate";
    const bytes = Buffer.byteLength(v, "utf8");
    if (opts?.min !== undefined && bytes < opts.min) return `too short (min ${opts.min} UTF-8 bytes)`;
    if (opts?.max !== undefined && bytes > opts.max) return `too long (max ${opts.max} UTF-8 bytes)`;
    if (opts?.re && !opts.re.test(v)) return "invalid format";
    return null;
  };
}

export function checkInt(opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v)) return `expected safe integer, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

export function checkBool(): Check {
  return (v) => typeof v === "boolean" ? null : `expected boolean, got ${typeName(v)}`;
}

export function checkEnum<T extends string>(values: readonly T[]): Check {
  return (v) => typeof v === "string" && (values as readonly string[]).includes(v)
    ? null : `expected one of ${values.join("|")}, got ${typeName(v)}`;
}

export function checkArray(item: Check, opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (!Array.isArray(v)) return `expected array, got ${typeName(v)}`;
    if (opts?.min !== undefined && v.length < opts.min) return `too few items (min ${opts.min})`;
    if (opts?.max !== undefined && v.length > opts.max) return `too many items (max ${opts.max})`;
    for (let i = 0; i < v.length; i++) {
      const err = item(v[i]);
      if (err) return `item ${i}: ${err}`;
    }
    return null;
  };
}

export function checkJson(): Check {
  return (v) => ((v as Json) !== undefined ? null : "missing JSON value");
}

/** MUST [IPC-001]: reject NaN/Infinity at the JSON root (JSON.parse already forbids them). */
export function checkFiniteNumber(opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return `expected finite number, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

// ---------------------------------------------------------------------------
// domain values
// ---------------------------------------------------------------------------
export const checkActor: Check = (v) => typeof v === "string" && isValidActorName(v) ? null : "invalid actor name";
export const checkTopic: Check = (v) => typeof v === "string" && isValidTopicName(v) ? null : "invalid topic name";
export const checkOid: Check = (v) => typeof v === "string" && isValidFullOid(v) ? null : "invalid full OID";
export const checkRequestKey: Check = (v) => isValidRequestKey(v) ? null : "invalid request key";
export const checkExportRef: Check = (v) => isExportRef(v) ? null : "invalid export ref";

/** Structural logical grammar comes from mail-values; this adds only the
 * caller-supplied registered-resident set, never a display-address fallback.
 */
export function checkAddress(actorNames: ReadonlySet<string>): Check {
  return (v) => {
    const structural = checkLogicalAddress(v);
    if (structural) return structural;
    if (v === "principal" || v === "commons" || v === "residents" || (typeof v === "string" && v.startsWith("topic/"))) return null;
    return actorNames.has(v as string) ? null : `unknown address "${String(v)}"`;
  };
}

export function checkBlobDescriptor(maxBytes: number): Check {
  return checkObject({
    bytes: checkInt({ min: 0, max: maxBytes }),
    sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
    mediaType: checkEnum([
      "text/plain; charset=utf-8", "application/x-git-bundle",
      "application/vnd.oma.context-v1", "application/vnd.oma.provider-v1",
    ] as const),
  });
}

// ---------------------------------------------------------------------------
// method params (public API). Limits come from the host profile (CFG-003).
// ---------------------------------------------------------------------------
export interface ParamsLimits {
  frameBytes: number; mailBodyBytes: number; subjectBytes: number; addresses: number;
  replyReferences: number; contextFiles: number; contextBytes: number; bundleBytes: number;
}
const messageIdCheck: Check = (value) => isValidMessageId(value) ? null : "invalid message id";
const operationIdCheck: Check = (value) => isValidOperationId(value) ? null : "invalid operation id";

export const messagePlanCheck = checkObject({
  id: messageIdCheck,
  objectPath: value => isMailObjectRelativePath(value) ? null : "invalid mail object path",
  sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
  bytes: checkInt({ min: 1 }), dateMs: checkInt({ min: 0 }),
  to: checkArray(checkLogicalAddress),
  recipients: checkArray(v => v === "principal" ? null : checkActor(v)),
  kind: messageKindCheck, approvalFor: checkOptional(exactCandidateCheck),
  contextRevision: v => v === null ? null : checkOid(v),
  replyHeaders: checkObject({
    replyTo: checkArray(checkLogicalAddress),
    inReplyTo: v => v === null ? null : headerMessageIdCheck(v),
    references: checkArray(headerMessageIdCheck),
  }),
});

/** MUST [DB-009/M-003]: result_json is a closed result variant keyed by kind. */
export function operationResultCheck(kind: string): Check {
  switch (kind) {
    case "mail.send": case "agent.continue":
      return checkObject({ kind: checkEnum([kind]), message: messageIdCheck,
        recipientCount: checkInt({ min: 0 }), archivePath: checkString({ min: 1 }) });
    case "mail.ack":
      return checkObject({ kind: checkEnum(["mail.ack"]), message: messageIdCheck,
        acknowledged: (v) => v === true ? null : "expected true" });
    case "route.follow": case "route.unfollow":
      return checkObject({ kind: checkEnum([kind]), topic: checkTopic, subscribed: checkBool() });
    case "agent.create": case "agent.start": case "agent.stop":
      return checkObject({ kind: checkEnum([kind]), agent: checkActor,
        desired: checkEnum(["provisioning", "enabled", "stopped", "retired"] as const),
        remainingOperations: checkArray(operationIdCheck) });
    case "git.submit":
      return checkObject({ kind: checkEnum(["git.submit"]), candidate: checkOid,
        publishedRef: value => isPublishedRef(value) ? null : "invalid published ref",
        message: messageIdCheck, recipientCount: checkInt({ min: 0 }) });
    case "git.integrate":
      return checkObject({ kind: checkEnum(["git.integrate"]), base: checkOid, candidate: checkOid,
        target: checkEnum(["refs/heads/main"]), policyRevision: checkString({ min: 1 }), changed: checkBool() });
    case "context.publish":
      return checkObject({ kind: checkEnum(["context.publish"]),
        previous: (v) => v === null ? null : checkOid(v), revision: checkOid,
        message: messageIdCheck, recipientCount: checkInt({ min: 0 }) });
    default: return () => `unknown operation kind ${kind}`;
  }
}

export function mailParamsCheck(actorNames: ReadonlySet<string>, l: ParamsLimits): Check {
  const shape = checkObject({
    to: checkArray(checkAddress(actorNames), { min: 0, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }), kind: messageKindCheck,
    body: checkString({ max: l.mailBodyBytes }), approvalFor: checkOptional(exactCandidateCheck),
    replyToMessage: checkOptional(messageIdCheck),
    refs: checkOptional(checkArray(checkObject({
      repo: checkEnum(["project", "context"] as const), oid: checkOid,
      path: checkOptional((v) => typeof v === "string" && isValidWirePath(v) ? null : "invalid wire path"),
    }), { max: l.replyReferences })),
  });
  return (value) => {
    const error = shape(value);
    if (error) return error;
    const mail = value as { kind: string; to: string[]; approvalFor?: unknown };
    if (mail.kind === "approval_required")
      return mail.approvalFor && mail.to.includes("principal") ? null : "approval_required needs approvalFor and explicit principal recipient";
    return mail.approvalFor === undefined ? null : "approvalFor is only allowed for approval_required";
  };
}

export const agentCreateParamsCheck: Check = checkObject({
  name: checkActor, from: checkOid, brief: checkString({ min: 1, max: 8 * 1024 }),
});
export function gitSubmitParamsCheck(actorNames: ReadonlySet<string>, l: ParamsLimits): Check {
  return checkObject({
    candidate: checkOid, exportRef: checkExportRef,
    prerequisites: checkArray(checkOid, { max: 1024 }),
    to: checkArray(checkAddress(actorNames), { min: 0, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }), body: checkString({ max: l.mailBodyBytes }),
    paths: checkArray((v) => typeof v === "string" && isValidWirePath(v) ? null : "invalid wire path", { max: 1024 }),
    bundle: checkOptional(checkBlobDescriptor(l.bundleBytes)),
  });
}
export const gitIntegrateParamsCheck: Check = checkObject({ candidate: checkOid, expected: checkOid });

/** CTX-002: input and accepted plans use the same ordered manifest policy.
 * Metadata is rejected before spooling; the stream handler still verifies bytes.
 */
export function contextPublishParamsCheck(l: ParamsLimits): Check {
  const shape = checkObject({
    expected: (v) => v === null ? null : checkOid(v),
    entries: value => contextEntriesCheck(value, { requireSorted: true, maxFiles: l.contextFiles, maxBytes: l.contextBytes }),
    content: checkBlobDescriptor(l.contextBytes),
  });
  return value => {
    const invalid = shape(value);
    if (invalid) return invalid;
    const input = value as { entries: unknown; content: { bytes: number } };
    return contextEntriesCheck(input.entries, { requireSorted: true, contentBytes: input.content.bytes });
  };
}
export const operationGetParamsCheck: Check = checkObject({ key: checkRequestKey });
export const statusGetParamsCheck: Check = checkObject({ agent: checkOptional(checkActor) });
export const logsReadParamsCheck: Check = checkObject({ agent: checkActor, sinceSeconds: checkInt({ min: 1, max: 31536000 }) });
export const mailAckParamsCheck: Check = checkObject({ message: messageIdCheck });
export const routeParamsCheck: Check = checkObject({ topic: checkTopic });
export const agentActionParamsCheck: Check = checkObject({ agent: checkActor });
export const agentContinueParamsCheck: Check = checkObject({ note: checkString({ min: 1, max: 64 * 1024 }) });
export const agentWaitParamsCheck: Check = checkObject({});

/** Validated, normalized wire values ready for the domain layer. */
export interface ValidatedEnvelope<M> {
  v: 1; id: string; method: M; params: unknown; request: RequestKey | undefined;
}
export type MethodCheck = (v: unknown) => string | null;
export function ok(): null { return null; }
