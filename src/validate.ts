// MUST [M-003]: runtime schema validation at trust boundaries; unknown fields are
// rejected; `as SomeType` is never validation. Validators return an error string
// or null; they do not coerce.
import type { Json, RequestKey } from '../implementation/contracts.js';
import {
  isValidActorName, isValidRequestKey, isValidFullOid, isValidTopicName, isValidWirePath,
} from './ids.js';

export type Check = (v: unknown) => string | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Unknown-field-rejecting object check. `spec` keys are the only allowed fields. */
export function checkObject(spec: Readonly<Record<string, Check>>): Check {
  return (v) => {
    if (!isPlainObject(v)) return `expected object, got ${typeName(v)}`;
    for (const key of Object.keys(v)) {
      const c = spec[key];
      if (!c) return `unknown field "${key}"`;
      const err = c(v[key]);
      if (err) return `field "${key}": ${err}`;
    }
    return null;
  };
}

export function checkOptional(spec: Check): Check {
  return (v) => (v === undefined ? null : spec(v));
}

export function checkString(opts?: { min?: number; max?: number; re?: RegExp }): Check {
  return (v) => {
    if (typeof v !== 'string') return `expected string, got ${typeName(v)}`;
    if (opts?.min !== undefined && v.length < opts.min) return `too short (min ${opts.min})`;
    if (opts?.max !== undefined && v.length > opts.max) return `too long (max ${opts.max})`;
    if (opts?.re && !opts.re.test(v)) return `invalid format`;
    return null;
  };
}

export function checkInt(opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) return `expected safe integer, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

export function checkBool(): Check {
  return (v) => (typeof v === 'boolean' ? null : `expected boolean, got ${typeName(v)}`);
}

export function checkEnum<T extends string>(values: readonly T[]): Check {
  return (v) => (typeof v === 'string' && (values as readonly string[]).includes(v)
    ? null : `expected one of ${values.join('|')}, got ${typeName(v)}`);
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
  return (v) => ((v as Json) !== undefined ? null : 'missing JSON value');
}

/** MUST [IPC-001]: reject NaN/Infinity at the JSON root (JSON.parse already forbids them). */
export function checkFiniteNumber(opts?: { min?: number; max?: number }): Check {
  return (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `expected finite number, got ${typeName(v)}`;
    if (opts?.min !== undefined && v < opts.min) return `below min ${opts.min}`;
    if (opts?.max !== undefined && v > opts.max) return `above max ${opts.max}`;
    return null;
  };
}

// ---------------------------------------------------------------------------
// domain values
// ---------------------------------------------------------------------------

export const checkActor: Check = (v) => (typeof v === 'string' && isValidActorName(v) ? null : `invalid actor name`);
export const checkTopic: Check = (v) => (typeof v === 'string' && isValidTopicName(v) ? null : `invalid topic name`);
export const checkOid: Check = (v) => (typeof v === 'string' && isValidFullOid(v) ? null : `invalid full OID`);
export const checkRequestKey: Check = (v) => (isValidRequestKey(v) ? null : `invalid request key`);

/** logical address: registered resident name, principal, commons, residents, or topic/<name> */
export function checkAddress(actorNames: ReadonlySet<string>): Check {
  return (v) => {
    if (typeof v !== 'string') return `expected address string, got ${typeName(v)}`;
    if (v.startsWith('topic/')) return isValidTopicName(v.slice(6)) ? null : `invalid topic address`;
    if (v === 'principal' || v === 'commons' || v === 'residents') return null;
    return actorNames.has(v) ? null : `unknown address "${v}"`;
  };
}

export function checkBlobDescriptor(maxBytes: number): Check {
  return checkObject({
    bytes: checkInt({ min: 0, max: maxBytes }),
    sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
    mediaType: checkEnum(['text/plain; charset=utf-8', 'application/x-git-bundle', 'application/vnd.oma.context-v1', 'application/vnd.oma.provider-v1'] as const),
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

export function mailParamsCheck(actorNames: ReadonlySet<string>, l: ParamsLimits): Check {
  return checkObject({
    to: checkArray(checkAddress(actorNames), { min: 1, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }),
    kind: checkEnum(['message', 'question', 'result', 'alert', 'context'] as const),
    body: checkString({ max: l.mailBodyBytes }),
    replyToMessage: checkOptional(checkString({ re: /^m-[0-9a-f-]{36}-\d+$/ })),
    refs: checkOptional(checkArray(checkObject({
      repo: checkEnum(['project', 'context'] as const),
      oid: checkOid,
      path: checkOptional((v) => (typeof v === 'string' && isValidWirePath(v) ? null : `invalid wire path`)),
    }), { max: l.replyReferences })),
  });
}

export const agentCreateParamsCheck: Check = checkObject({
  name: checkActor,
  from: checkOid,
  brief: checkString({ min: 1, max: 8 * 1024 }),
});

export function gitSubmitParamsCheck(actorNames: ReadonlySet<string>, l: ParamsLimits): Check {
  return checkObject({
    candidate: checkOid,
    exportRef: checkString({ re: /^refs\/oma\/export\/[A-Za-z0-9._-]{1,96}$/ }),
    prerequisites: checkArray(checkOid, { max: 1024 }),
    to: checkArray(checkAddress(actorNames), { min: 0, max: l.addresses }),
    subject: checkString({ max: l.subjectBytes }),
    body: checkString({ max: l.mailBodyBytes }),
    paths: checkArray((v) => (typeof v === 'string' && isValidWirePath(v) ? null : `invalid wire path`), { max: 1024 }),
    bundle: checkOptional(checkBlobDescriptor(l.bundleBytes)),
  });
}

export const gitIntegrateParamsCheck: Check = checkObject({
  candidate: checkOid,
  expected: checkOid,
});

export function contextPublishParamsCheck(l: ParamsLimits): Check {
  return checkObject({
    expected: checkOptional(checkOid),
    entries: checkArray(checkObject({
      path: (v) => (typeof v === 'string' && isValidWirePath(v) ? null : `invalid wire path`),
      bytes: checkInt({ min: 0, max: l.contextBytes }),
      sha256: checkString({ re: /^[0-9a-f]{64}$/ }),
    }), { min: 1, max: l.contextFiles }),
    content: checkBlobDescriptor(l.contextBytes),
  });
}

export const operationGetParamsCheck: Check = checkObject({ key: checkRequestKey });
export const statusGetParamsCheck: Check = checkObject({ agent: checkOptional(checkActor) });
export const logsReadParamsCheck: Check = checkObject({
  agent: checkActor,
  sinceSeconds: checkInt({ min: 1, max: 31536000 }),
});
export const mailAckParamsCheck: Check = checkObject({ message: checkString({ re: /^m-[0-9a-f-]{36}-\d+$/ }) });
export const routeParamsCheck: Check = checkObject({ topic: checkTopic });
export const agentActionParamsCheck: Check = checkObject({ agent: checkActor });
export const agentContinueParamsCheck: Check = checkObject({ note: checkString({ min: 1, max: 64 * 1024 }) });
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