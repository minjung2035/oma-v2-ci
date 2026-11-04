/** collaboration-v1 exact observational addresses. These are not bearer tokens,
 * approvals or a replacement for re-derivation/current authority at acceptance.
 * This encoding is separate from every historical request/fact hash recipe. */
import { JSON_NESTING_LIMIT, sha256Hex } from "./canonical-json.js";
import { StoreError } from "./errors.js";
import { isReviewRequestName, isValidActor, isValidFullOid, isValidMessageId, isValidOperationId } from "./identifiers.js";

type Source = { readonly base: string; readonly candidate: string };
export type SettledFailure = null | { readonly kind: "integration" | "preparation"; readonly operation: string; readonly evidenceSha256: string };
interface Common {
  readonly version: "collaboration-v1";
  readonly societyBirth: string;
  readonly request: string;
  readonly requestName: string;
  readonly revision: number;
  readonly policyRevision: string;
}
export type CollaborationTarget = Common & (
  | { readonly kind: "proposal"; readonly requester: string; readonly source: Source; readonly tier: "LOW" | "MEDIUM" | "HIGH";
      readonly attemptNumber: number; readonly expectedAttempt: string | null; readonly settledFailure: SettledFailure }
  | { readonly kind: "review"; readonly scope: "source" | "integration"; readonly source: Source; readonly preparation: string | null;
      readonly actor: string; readonly expectedOwnVote: string | null; readonly approval: string | null }
  | { readonly kind: "submission"; readonly requester: string; readonly submission: string; readonly source: Source;
      readonly attemptNumber: number; readonly expectedAttempt: string | null }
  | { readonly kind: "vote"; readonly actor: string; readonly vote: string; readonly scope: string | null;
      readonly approval: string | null; readonly expectedCurrentVote: string }
  | { readonly kind: "applied"; readonly integration: string; readonly expectedBase: string; readonly candidate: string;
      readonly manifestSha256: string; readonly sourceRevision: number }
);
export type CollaborationTargetKind = CollaborationTarget["kind"];
const kinds = ["proposal", "review", "submission", "vote", "applied"] as const;
const invalid = (message: string): never => { throw new StoreError("INVALID_REQUEST", message); };
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const operationOrNull = (value: unknown) => value === null || isValidOperationId(value);
const messageOrNull = (value: unknown) => value === null || isValidMessageId(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const common = ["version", "kind", "societyBirth", "request", "requestName", "revision", "policyRevision"];
const extras: Record<CollaborationTargetKind, readonly string[]> = {
  proposal: ["requester", "source", "tier", "attemptNumber", "expectedAttempt", "settledFailure"],
  review: ["scope", "source", "preparation", "actor", "expectedOwnVote", "approval"],
  submission: ["requester", "submission", "source", "attemptNumber", "expectedAttempt"],
  vote: ["actor", "vote", "scope", "approval", "expectedCurrentVote"],
  applied: ["integration", "expectedBase", "candidate", "manifestSha256", "sourceRevision"],
};
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => {
    const entry = descriptors[key]; return entry !== undefined && entry.enumerable && "value" in entry;
  });
}
function source(value: unknown): boolean {
  return closed(value, ["base", "candidate"]) && isValidFullOid(value.base) && isValidFullOid(value.candidate) && value.base.length === value.candidate.length;
}
function failure(value: unknown): boolean {
  return value === null || closed(value, ["kind", "operation", "evidenceSha256"]) &&
    (value.kind === "integration" || value.kind === "preparation") && isValidOperationId(value.operation) && digest(value.evidenceSha256);
}
function valid(value: unknown): value is CollaborationTarget {
  if (value === null || typeof value !== "object") return false;
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor) || !kinds.includes(kindDescriptor.value)) return false;
  const kind = kindDescriptor.value as CollaborationTargetKind;
  if (!closed(value, [...common, ...extras[kind]])) return false;
  const v = value;
  if (v.version !== "collaboration-v1" || !text(v.societyBirth) || !isValidOperationId(v.request) ||
      !isReviewRequestName(v.requestName) || !v.requestName.endsWith(v.request.slice(3)) || !integer(v.revision) || !text(v.policyRevision)) return false;
  switch (kind) {
    case "proposal": return isValidActor(v.requester) && v.requester !== "principal" && source(v.source) &&
      ["LOW", "MEDIUM", "HIGH"].includes(v.tier as string) && integer(v.attemptNumber) && operationOrNull(v.expectedAttempt) && failure(v.settledFailure) &&
      !(v.settledFailure && (v.settledFailure as Exclude<SettledFailure, null>).kind === "integration" &&
        (v.settledFailure as Exclude<SettledFailure, null>).operation !== v.expectedAttempt);
    case "review": return isValidActor(v.actor) && (v.scope === "source" || v.scope === "integration") && source(v.source) &&
      operationOrNull(v.preparation) && operationOrNull(v.expectedOwnVote) && messageOrNull(v.approval) &&
      (v.scope === "source" ? v.preparation === null : isValidOperationId(v.preparation)) &&
      (v.actor === "principal" ? isValidMessageId(v.approval) : v.approval === null);
    case "submission": return isValidActor(v.requester) && v.requester !== "principal" && isValidOperationId(v.submission) &&
      source(v.source) && integer(v.attemptNumber) && operationOrNull(v.expectedAttempt);
    case "vote": return isValidActor(v.actor) && isValidOperationId(v.vote) && operationOrNull(v.scope) &&
      messageOrNull(v.approval) && isValidOperationId(v.expectedCurrentVote) && v.vote === v.expectedCurrentVote &&
      (v.actor === "principal" ? isValidMessageId(v.approval) : v.approval === null);
    case "applied": return isValidOperationId(v.integration) && isValidFullOid(v.expectedBase) && isValidFullOid(v.candidate) &&
      v.expectedBase.length === v.candidate.length && digest(v.manifestSha256) && integer(v.sourceRevision);
  }
}
/** Unicode codepoint comparison, not JavaScript's default UTF-16 key order. */
function compare(a: string, b: string): number {
  const aa = Array.from(a), bb = Array.from(b);
  for (let index = 0; index < Math.min(aa.length, bb.length); index++) {
    const delta = aa[index]!.codePointAt(0)! - bb[index]!.codePointAt(0)!; if (delta) return delta;
  }
  return aa.length - bb.length;
}
export function canonicalCollaborationJson(value: unknown): string {
  const parents = new Set<object>();
  const string = (value: string) => {
    for (const char of value) { const cp = char.codePointAt(0)!; if (cp >= 0xd800 && cp <= 0xdfff) invalid("canonical text has an unpaired surrogate"); }
    return JSON.stringify(value);
  };
  const encode = (value: unknown): string => {
    if (value === null) return "null";
    if (typeof value === "string") return string(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") { if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid("canonical numbers must be safe integers, not negative zero"); return String(value); }
    if (typeof value !== "object") return invalid("canonical JSON cannot contain undefined or non-JSON values");
    if (parents.has(value)) return invalid("canonical JSON cannot contain cycles");
    if (parents.size >= JSON_NESTING_LIMIT) return invalid(`JSON nesting exceeds ${JSON_NESTING_LIMIT}`);
    parents.add(value);
    try {
      if (Array.isArray(value)) {
        if (Reflect.ownKeys(value).length !== value.length + 1) return invalid("canonical arrays must be dense with no extra properties");
        const descriptors = Object.getOwnPropertyDescriptors(value);
        return `[${Array.from({ length: value.length }, (_, index) => {
          const entry = descriptors[String(index)]; if (!entry || !("value" in entry)) return invalid("canonical arrays cannot contain accessors or holes");
          return encode(entry.value);
        }).join(",")}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid("canonical objects must be plain JSON objects");
      const keys = Object.keys(value), descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(value).length !== keys.length) return invalid("canonical objects cannot contain hidden or symbol keys");
      return `{${keys.sort(compare).map(key => {
        const entry = descriptors[key]!; if (!("value" in entry)) return invalid("canonical objects cannot contain accessors");
        return `${string(key)}:${encode(entry.value)}`;
      }).join(",")}}`;
    } finally { parents.delete(value); }
  };
  return encode(value);
}
export function encodeCollaborationTarget(value: CollaborationTarget): { readonly bytes: Buffer; readonly sha256: string; readonly name: string } {
  if (!valid(value)) return invalid("invalid closed collaboration target");
  const bytes = Buffer.from(canonicalCollaborationJson(value), "utf8"), sha256 = sha256Hex(bytes);
  return Object.freeze({ bytes, sha256, name: `${value.kind}-${sha256}.json` });
}
export function decodeCollaborationTarget(bytes: Uint8Array, name: string, expectedKind?: CollaborationTargetKind): CollaborationTarget {
  let value: unknown;
  try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return invalid("target is not canonical UTF-8 JSON"); }
  if (!valid(value)) return invalid("invalid closed collaboration target");
  const encoded = encodeCollaborationTarget(value);
  if (!encoded.bytes.equals(bytes) || encoded.name !== name) return invalid("target bytes, digest or path kind do not match");
  if (expectedKind !== undefined && value.kind !== expectedKind) return invalid("wrong exact target kind for this action");
  // Decode returns an independent deeply frozen tuple. Authority and ledger
  // correspondence are deliberately not asserted by a successful byte decode.
  const freeze = (value: object): void => { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); };
  freeze(value); return value;
}
