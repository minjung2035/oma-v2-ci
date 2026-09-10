// MUST [M-003]: runtime schema validation at trust boundaries; unknown fields are
// rejected; `as SomeType` is never validation. Validators return an error string
// or null; they do not coerce.
import type { Json, RequestKey } from "../implementation/contracts.js";
import {
  isValidActorName,
  isValidRequestKey,
  isValidFullOid,
  isValidTopicName,
  isValidWirePath,
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
    if (opts?.re && !opts.re.test(v)) return `invalid format`;
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
  typeof v === "string" && isValidActorName(v) ? null : `invalid actor name`;
export const checkTopic: Check = (v) =>
  typeof v === "string" && isValidTopicName(v) ? null : `invalid topic name`;
export const checkOid: Check = (v) =>
  typeof v === "string" && isValidFullOid(v) ? null : `invalid full OID`;
export const checkRequestKey: Check = (v) =>
  isValidRequestKey(v) ? null : `invalid request key`;

/** Structurally valid logical address for persisted MessagePlan DTOs. */
export const checkLogicalAddress: Check = (v) => {
  if (typeof v !== "string")
    return `expected address string, got ${typeName(v)}`;
  if (v.startsWith("topic/"))
    return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;
  if (v === "principal" || v === "commons" || v === "residents") return null;
  return isValidActorName(v) ? null : `invalid logical address`;
};

/** logical address: registered resident name, principal, commons, residents, or topic/<name> */
export function checkAddress(actorNames: ReadonlySet<string>): Check {
  return (v) => {
    const structural = checkLogicalAddress(v);
    if (structural) return structural;
    if (
      v === "principal" ||
      v === "commons" ||
      v === "residents" ||
      (typeof v === "string" && v.startsWith("topic/"))
    ) return null;
    return actorNames.has(v as string) ? null : `unknown address "${String(v)}"`;
  };
}

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

const exactCandidateShape = checkObject({
  repo: checkEnum(["project"]),
  targetRef: checkEnum(["refs/heads/main"]),
  expectedBase: checkOid,
  candidate: checkOid,
  policyRevision: checkString({ min: 1, max: 128, re: /^[^\p{Cc}\p{Cf}]+$/u }),
});
export const exactCandidateCheck: Check = (value) => {
  const error = exactCandidateShape(value);
  if (error) return error;
  const identity = value as { expectedBase: string; candidate: string };
  return identity.expectedBase.length === identity.candidate.length ? null : "approval OIDs must use the same object format";
};

const messageKindCheck = checkEnum(["message", "question", "result", "alert", "context", "approval_required", "critical"]);
const messageIdCheck = checkString({ re: /^m-[0-9a-f-]{36}-\d+$/ });

export const messagePlanCheck = checkObject({
  id: messageIdCheck,
  objectPath: checkString({ min: 1 }),
  sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
  bytes: checkInt({ min: 0 }),
  dateMs: checkInt({ min: 0 }),
  to: checkArray(checkLogicalAddress),
  recipients: checkArray(v => v === "principal" ? null : checkActor(v)),
  kind: messageKindCheck,
  approvalFor: checkOptional(exactCandidateCheck),
  contextRevision: v => v === null ? null : checkOid(v),
  replyHeaders: checkObject({
    replyTo: checkArray(checkLogicalAddress),
    inReplyTo: v => v === null ? null : messageIdCheck(v),
    references: checkArray(messageIdCheck),
  }),
});

export function mailParamsCheck(
  actorNames: ReadonlySet<string>,
  l: ParamsLimits,
): Check {
  const shape = checkObject({
    to: checkArray(checkAddress(actorNames), { min: 0, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }),
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
              : `invalid wire path`,
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
        ? null : "approval_required needs approvalFor and explicit principal recipient";
    return mail.approvalFor === undefined ? null : "approvalFor is only allowed for approval_required";
  };
}

export const agentCreateParamsCheck: Check = checkObject({
  name: checkActor,
  from: checkOid,
  brief: checkString({ min: 1, max: 8 * 1024 }),
});

export function gitSubmitParamsCheck(
  actorNames: ReadonlySet<string>,
  l: ParamsLimits,
): Check {
  return checkObject({
    candidate: checkOid,
    exportRef: checkString({ re: /^refs\/oma\/export\/[A-Za-z0-9._-]{1,96}$/ }),
    prerequisites: checkArray(checkOid, { max: 1024 }),
    to: checkArray(checkAddress(actorNames), { min: 0, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }),
    body: checkString({ max: l.mailBodyBytes }),
    paths: checkArray(
      (v) =>
        typeof v === "string" && isValidWirePath(v)
          ? null
          : `invalid wire path`,
      { max: 1024 },
    ),
    bundle: checkOptional(checkBlobDescriptor(l.bundleBytes)),
  });
}

export const gitIntegrateParamsCheck: Check = checkObject({
  candidate: checkOid,
  expected: checkOid,
});

export const contextPathCheck: Check = (value) =>
  typeof value === "string" && isValidWirePath(value) &&
  (value === "GOAL.md" || value === "RATIONALE.md" || /^decisions\/[^/]+\.md$/.test(value))
    ? null : "unsupported context path";

export function contextFileCheck(path: string, data: Uint8Array): string | null {
  const pathError = contextPathCheck(path);
  if (pathError) return pathError;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { return "context must be UTF-8 text"; }
  if (path === "GOAL.md" && text.length === 0) return "GOAL.md must not be empty";
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? "binary context is forbidden" : null;
}

export function contextPublishParamsCheck(l: ParamsLimits): Check {
  return checkObject({
    expected: (v) => (v === null ? null : checkOid(v)),
    entries: checkArray(
      checkObject({
        path: contextPathCheck,
        bytes: checkInt({ min: 0, max: l.contextBytes }),
        sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
      }),
      { min: 1, max: l.contextFiles },
    ),
    content: checkBlobDescriptor(l.contextBytes),
  });
}

export const operationGetParamsCheck: Check = checkObject({
  key: checkRequestKey,
});
export const statusGetParamsCheck: Check = checkObject({
  agent: checkOptional(checkActor),
});
export const logsReadParamsCheck: Check = checkObject({
  agent: checkActor,
  sinceSeconds: checkInt({ min: 1, max: 31536000 }),
});
export const mailAckParamsCheck: Check = checkObject({
  message: messageIdCheck,
});
export const routeParamsCheck: Check = checkObject({ topic: checkTopic });
export const agentActionParamsCheck: Check = checkObject({ agent: checkActor });
export const agentContinueParamsCheck: Check = checkObject({
  note: checkString({ min: 1, max: 64 * 1024 }),
});
export const agentWaitParamsCheck: Check = checkObject({});

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
