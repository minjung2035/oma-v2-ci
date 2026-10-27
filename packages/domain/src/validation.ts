// MUST [M-003]: runtime schema validation at trust boundaries; unknown fields are
// rejected; `as SomeType` is never validation. Validators return an error string
// or null; they do not coerce.
export { attestationInputProblem as attestationParamsCheck } from "./attestation.js";
import type { Json, RequestKey } from "@oma/contracts/identity";
import { contextEntriesCheck } from "./context-policy.js";
import {
  isExportRef,
  isPublishedRef,
  isMailObjectRelativePath,
} from "./derived.js";
export { contextPathCheck, contextFileCheck } from "./context-policy.js";
import {
  exactCandidateCheck,
  mailHeaderValueCheck,
  headerMessageIdCheck,
  messageKindCheck,
  logicalAddressCheck as checkLogicalAddress,
} from "./mail-values.js";
export {
  exactCandidateCheck,
  logicalAddressCheck as checkLogicalAddress,
} from "./mail-values.js";
import {
  isValidActorName,
  isValidRequestKey,
  isValidFullOid,
  isValidTopicName,
  isValidWirePath,
  isValidMessageId,
  isValidOperationId,
  isReviewRequestName,
} from "./identifiers.js";

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
      if (!Object.prototype.hasOwnProperty.call(spec, key))
        return `unknown field "${key}"`;
    }
    return null;
  };
}

export function checkOptional(spec: Check): Check {
  const check = ((v: unknown) =>
    v === undefined ? null : spec(v)) as OptionalCheck;
  check[OPTIONAL] = true;
  return check;
}

export function checkString(opts?: {
  min?: number;
  max?: number;
  re?: RegExp;
}): Check {
  return (v) => {
    if (typeof v !== "string") return `expected string, got ${typeName(v)}`;
    if (/\p{Cs}/u.test(v)) return "unpaired Unicode surrogate";
    const bytes = Buffer.byteLength(v, "utf8");
    if (opts?.min !== undefined && bytes < opts.min)
      return `too short (min ${opts.min} UTF-8 bytes)`;
    if (opts?.max !== undefined && bytes > opts.max)
      return `too long (max ${opts.max} UTF-8 bytes)`;
    if (opts?.re && !opts.re.test(v)) return "invalid format";
    return null;
  };
}

export function checkInt(opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v))
      return `expected safe integer, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

export function checkBool(): Check {
  return (v) =>
    typeof v === "boolean" ? null : `expected boolean, got ${typeName(v)}`;
}

export function checkEnum<T extends string>(values: readonly T[]): Check {
  return (v) =>
    typeof v === "string" && (values as readonly string[]).includes(v)
      ? null
      : `expected one of ${values.join("|")}, got ${typeName(v)}`;
}

export function checkArray(
  item: Check,
  opts?: { min?: number; max?: number },
): Check {
  return (v) => {
    if (!Array.isArray(v)) return `expected array, got ${typeName(v)}`;
    if (opts?.min !== undefined && v.length < opts.min)
      return `too few items (min ${opts.min})`;
    if (opts?.max !== undefined && v.length > opts.max)
      return `too many items (max ${opts.max})`;
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
export function checkFiniteNumber(opts?: {
  min?: number;
  max?: number;
}): Check {
  return (v) => {
    if (typeof v !== "number" || !Number.isFinite(v))
      return `expected finite number, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

// ---------------------------------------------------------------------------
// domain values
// ---------------------------------------------------------------------------
export const checkActor: Check = (v) =>
  typeof v === "string" && isValidActorName(v) ? null : "invalid actor name";
export const checkTopic: Check = (v) =>
  typeof v === "string" && isValidTopicName(v) ? null : "invalid topic name";
export const checkOid: Check = (v) =>
  typeof v === "string" && isValidFullOid(v) ? null : "invalid full OID";
export const checkRequestKey: Check = (v) =>
  isValidRequestKey(v) ? null : "invalid request key";
export const checkExportRef: Check = (v) =>
  isExportRef(v) ? null : "invalid export ref";

/** Structural logical grammar comes from mail-values; this adds only the
 * caller-supplied registered-resident set, never a display-address fallback.
 */
/** An address's grammar. SCN-F04, P0-2: whether it names an agent -- and
 * whether that agent can receive now -- is the routing owner's
 * (`expandAddresses`), which answers ADDRESS_NOT_FOUND, AGENT_NOT_READY or
 * AGENT_RETIRED before the request is accepted. Deciding existence here as
 * well answered the same question a second way ("invalid params"), which told
 * a caller neither that the name was unknown nor which one. */
export const checkAddress: Check = (v) => checkLogicalAddress(v);

export function checkBlobDescriptor(maxBytes: number): Check {
  return checkObject({
    bytes: checkInt({ min: 0, max: maxBytes }),
    sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
    mediaType: checkEnum([
      "text/plain; charset=utf-8",
      "application/x-git-bundle",
      "application/vnd.oma.context-v1",
      "application/vnd.oma.provider-v1",
    ] as const),
  });
}

// ---------------------------------------------------------------------------
// method params (public API). Limits come from the host profile (CFG-003).
// ---------------------------------------------------------------------------
export interface ParamsLimits {
  frameBytes: number;
  mailBodyBytes: number;
  subjectBytes: number;
  addresses: number;
  replyReferences: number;
  contextFiles: number;
  contextBytes: number;
  bundleBytes: number;
}
const messageIdCheck: Check = (value) =>
  isValidMessageId(value) ? null : "invalid message id";
const operationIdCheck: Check = (value) =>
  isValidOperationId(value) ? null : "invalid operation id";

const requestNameCheck: Check = (value) =>
  isReviewRequestName(value) ? null : "invalid review request name";
/** The durable review-mail metadata grammar; role fixes kind, audience and
 * logical addressing in the cross-field checks below. */
const reviewMailMetaCheck: Check = (value) => {
  if (!isPlainObject(value)) return `expected object, got ${typeName(value)}`;
  switch ((value as { role?: unknown }).role) {
    case "thread":
      return checkObject({ role: checkEnum(["thread"] as const), request: operationIdCheck,
        name: requestNameCheck, revision: checkInt({ min: 0 }) })(value);
    case "approval": {
      const invalid = checkObject({ role: checkEnum(["approval"] as const), request: operationIdCheck,
        name: requestNameCheck, votes: checkArray(operationIdCheck, { min: 1 }) })(value);
      if (invalid !== null) return invalid;
      const votes = (value as { votes: string[] }).votes;
      return new Set(votes).size === votes.length ? null : "duplicate approval votes";
    }
    case "withdrawn":
      return checkObject({ role: checkEnum(["withdrawn"] as const), request: operationIdCheck,
        name: requestNameCheck, approval: messageIdCheck })(value);
    case "decision":
      return checkObject({ role: checkEnum(["decision"] as const), request: operationIdCheck,
        name: requestNameCheck, approval: messageIdCheck })(value);
    case "notice": {
      const invalid = checkObject({ role: checkEnum(["notice"] as const), request: operationIdCheck,
        name: requestNameCheck, part: checkInt({ min: 1 }), parts: checkInt({ min: 1 }),
        sha256: checkString({ re: /^[0-9a-f]{64}$/ }), bytes: checkInt({ min: 0 }) })(value);
      if (invalid !== null) return invalid;
      const meta = value as { part: number; parts: number };
      return meta.part <= meta.parts ? null : "notice part exceeds parts";
    }
    default: return "invalid review mail role";
  }
};
const messagePlanShapeCheck = checkObject({
  id: messageIdCheck,
  objectPath: (value) =>
    isMailObjectRelativePath(value) ? null : "invalid mail object path",
  sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
  bytes: checkInt({ min: 1 }),
  dateMs: checkInt({ min: 0 }),
  to: checkArray(checkLogicalAddress),
  recipients: checkArray((v) => (v === "principal" ? null : checkActor(v))),
  kind: messageKindCheck,
  approvalFor: checkOptional(exactCandidateCheck),
  audience: checkOptional(checkEnum(["workers"] as const)),
  review: checkOptional(reviewMailMetaCheck),
  contextRevision: (v) => (v === null ? null : checkOid(v)),
  replyHeaders: checkObject({
    replyTo: checkArray(checkLogicalAddress),
    inReplyTo: (v) => (v === null ? null : headerMessageIdCheck(v)),
    references: checkArray(headerMessageIdCheck),
  }),
});
/** Review mail roles pin the frozen kind, logical addressing and audience. */
export const messagePlanCheck: Check = (value) => {
  const invalid = messagePlanShapeCheck(value);
  if (invalid !== null) return invalid;
  const plan = value as {
    kind: string; to: string[]; audience?: string; approvalFor?: unknown;
    review?: { role: string };
  };
  const toIs = (expected: readonly string[]) =>
    plan.to.length === expected.length && expected.every((address, index) => plan.to[index] === address);
  if (plan.review === undefined)
    return plan.audience === undefined ? null : "workers audience requires review metadata";
  const hidden = plan.audience === undefined;
  switch (plan.review.role) {
    case "thread":
      return plan.kind === "message" && plan.audience === "workers" && toIs(["residents"])
        ? null : "thread review mail is a workers-audience message to residents";
    case "approval":
      return plan.kind === "approval_required" && hidden && plan.approvalFor !== undefined && toIs(["principal"])
        ? null : "approval review mail is an approval_required to the Principal";
    case "withdrawn":
      return plan.kind === "message" && hidden && toIs(["principal"])
        ? null : "withdrawn review mail is a message to the Principal";
    case "decision":
      return plan.kind === "result" && hidden && toIs(["principal"])
        ? null : "decision review mail is a result to the Principal";
    case "notice":
      return plan.kind === "result" && hidden && toIs(["commons", "principal"])
        ? null : "notice review mail is a result to commons and the Principal";
    default: return "invalid review mail role";
  }
};

/** MUST [DB-009/M-003]: result_json is a closed result variant keyed by kind. */
export function operationResultCheck(kind: string): Check {
  switch (kind) {
    case "society.set":
      return checkObject({ kind: checkEnum([kind]), state: checkEnum(["open", "closed"]) });
    case "attest.record":
      return checkObject({ kind: checkEnum(["attest.record"] as const), request: requestNameCheck,
        messages: checkArray(messageIdCheck), recipientCount: checkInt({ min: 0 }) });
    case "mail.send":
    case "agent.continue":
      return checkObject({
        kind: checkEnum([kind]),
        message: messageIdCheck,
        recipientCount: checkInt({ min: 0 }),
        archivePath: checkString({ min: 1 }),
      });
    case "mail.ack":
      return checkObject({
        kind: checkEnum(["mail.ack"]),
        message: messageIdCheck,
        acknowledged: (v) => (v === true ? null : "expected true"),
      });
    case "route.follow":
    case "route.unfollow":
      return checkObject({
        kind: checkEnum([kind]),
        topic: checkTopic,
        subscribed: checkBool(),
      });
    case "agent.create":
    case "agent.start":
    case "agent.stop":
      return checkObject({
        kind: checkEnum([kind]),
        agent: checkActor,
        desired: checkEnum([
          "provisioning",
          "enabled",
          "stopped",
          "retired",
        ] as const),
        remainingOperations: checkArray(operationIdCheck),
      });
    case "git.submit":
      return checkObject({
        kind: checkEnum(["git.submit"]),
        candidate: checkOid,
        publishedRef: (value) =>
          isPublishedRef(value) ? null : "invalid published ref",
        message: messageIdCheck,
        recipientCount: checkInt({ min: 0 }),
      });
    case "git.integrate":
      return checkObject({
        kind: checkEnum(["git.integrate"]),
        base: checkOid,
        candidate: checkOid,
        target: checkEnum(["refs/heads/main"]),
        policyRevision: checkString({ min: 1 }),
        changed: checkBool(),
        merge: checkOptional(checkObject({ name: requestNameCheck, notices: checkArray(messageIdCheck),
          recipientCount: checkInt({ min: 0 }) })),
      });
    case "context.publish":
      return checkObject({
        kind: checkEnum(["context.publish"]),
        previous: (v) => (v === null ? null : checkOid(v)),
        revision: checkOid,
        message: messageIdCheck,
        recipientCount: checkInt({ min: 0 }),
      });
    default:
      return () => `unknown operation kind ${kind}`;
  }
}

export function mailParamsCheck(
  l: ParamsLimits,
): Check {
  const shape = checkObject({
    to: checkArray(checkAddress, { min: 0, max: l.addresses }),
    subject: value => checkString({ max: l.subjectBytes })(value) ?? mailHeaderValueCheck(value),
    kind: messageKindCheck,
    body: checkString({ max: l.mailBodyBytes }),
    approvalFor: checkOptional(exactCandidateCheck),
    replyToMessage: checkOptional(messageIdCheck),
    refs: checkOptional(
      checkArray(
        checkObject({
          repo: checkEnum(["project", "context"] as const),
          oid: checkOid,
          path: checkOptional((v) =>
            typeof v === "string" && isValidWirePath(v)
              ? null
              : "invalid wire path",
          ),
        }),
        { max: l.replyReferences },
      ),
    ),
  });
  return (value) => {
    const error = shape(value);
    if (error) return error;
    const mail = value as { kind: string; to: string[]; approvalFor?: unknown };
    if (mail.kind === "approval_required")
      return mail.approvalFor && mail.to.includes("principal")
        ? null
        : "approval_required needs approvalFor and explicit principal recipient";
    return mail.approvalFor === undefined
      ? null
      : "approvalFor is only allowed for approval_required";
  };
}

export const agentCreateParamsCheck: Check = checkObject({
  name: checkActor,
  from: checkOid,
  brief: checkString({ min: 1, max: 8 * 1024 }),
});
export function gitSubmitParamsCheck(
  l: ParamsLimits,
): Check {
  return checkObject({
    candidate: checkOid,
    exportRef: checkExportRef,
    prerequisites: checkArray(checkOid, { max: 1024 }),
    to: checkArray(checkAddress, { min: 0, max: l.addresses }),
    subject: value => checkString({ max: l.subjectBytes })(value) ?? mailHeaderValueCheck(value),
    body: checkString({ max: l.mailBodyBytes }),
    paths: checkArray(
      (v) =>
        typeof v === "string" && isValidWirePath(v)
          ? null
          : "invalid wire path",
      { max: 1024 },
    ),
    bundle: checkOptional(checkBlobDescriptor(l.bundleBytes)),
  });
}
export const gitIntegrateParamsCheck: Check = checkObject({
  tier: checkOptional(checkEnum(["LOW", "MEDIUM", "HIGH"])),
  candidate: checkOid,
  expected: checkOid,
});

/** CTX-002: input and accepted plans use the same ordered manifest policy.
 * Metadata is rejected before spooling; the stream handler still verifies bytes.
 */
export function contextPublishParamsCheck(l: ParamsLimits): Check {
  const shape = checkObject({
    expected: (v) => (v === null ? null : checkOid(v)),
    entries: (value) =>
      contextEntriesCheck(value, {
        requireSorted: true,
        maxFiles: l.contextFiles,
        maxBytes: l.contextBytes,
      }),
    content: checkBlobDescriptor(l.contextBytes),
    goalMail: checkOptional(checkObject({ subject: value => checkString({ min: 1, max: l.subjectBytes })(value) ?? mailHeaderValueCheck(value) })),
  });
  return (value) => {
    const invalid = shape(value);
    if (invalid) return invalid;
    const input = value as { entries: { path: string; bytes: number }[]; content: { bytes: number }; goalMail?: unknown };
    if (input.goalMail !== undefined && input.entries.find(entry => entry.path === "GOAL.md")!.bytes > l.mailBodyBytes)
      return "GOAL mail body exceeds host mail limit";
    return contextEntriesCheck(input.entries, {
      requireSorted: true,
      contentBytes: input.content.bytes,
    });
  };
}
export const operationGetParamsCheck: Check = checkObject({
  key: checkRequestKey,
});
export const operationReadParamsCheck: Check = checkObject({
  key: checkRequestKey,
  offset: checkInt({ min: 0 }),
  sha256: checkOptional(checkString({ re: /^[0-9a-f]{64}$/ })),
});
export const statusGetParamsCheck: Check = checkObject({
  agent: checkOptional(checkActor),
  after: checkOptional(checkActor),
});
export const reviewStatusParamsCheck: Check = checkObject({
  name: checkOptional(requestNameCheck),
});
export const logsReadParamsCheck: Check = checkObject({
  agent: checkActor,
  sinceSeconds: checkInt({ min: 1, max: 31536000 }),
});
export const mailAckParamsCheck: Check = checkObject({
  message: messageIdCheck,
});
export const routeParamsCheck: Check = checkObject({ topic: checkTopic });
export const societySetParamsCheck: Check = checkObject({ state: checkEnum(["open", "closed"]) });
export const agentActionParamsCheck: Check = checkObject({ agent: checkActor });
export const agentContinueParamsCheck: Check = checkObject({
  note: checkString({ min: 1, max: 64 * 1024 }),
});
export const agentWaitParamsCheck: Check = checkObject({
  observe: checkOptional(value => value === true ? null : "observe must be true"),
});

/** Validated, normalized wire values ready for the domain layer. */
export interface ValidatedEnvelope<M> {
  v: 1;
  id: string;
  method: M;
  params: unknown;
  request: RequestKey | undefined;
}
export type MethodCheck = (v: unknown) => string | null;
export function ok(): null {
  return null;
}
