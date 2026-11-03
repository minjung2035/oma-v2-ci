/** collaboration-v1 host linkage encoding, separate from historical request hashes.
 * These records describe an original call; they never grant effect authority. */
import type { Json, MutationMethod, Receipt } from "@oma/contracts";
import { isValidActor } from "@oma/domain/identifiers";
import { collaborationOmaNames } from "@oma/domain/collaboration-surface";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { sha256Hex } from "@oma/domain/canonical-json";
import { decodeReceipt, isMutationMethod, type Decoded } from "@oma/protocol/receipt-codec";
import { collaborationMutationMethods, collaborationMutationMethod } from "@oma/domain/collaboration-inputs";
import type { InvocationResolution, InvocationRejection } from "@oma/contracts/public-wire";
import type { CreateResolution } from "@oma/contracts/values";
import { decodeInvocationRejection, invocationPreacceptReason } from "@oma/protocol/invocation-rejection";
import { decodeInvocationResolution } from "@oma/protocol/invocation-resolution";
import type { CachedRequest } from "./request-cache-codec.js";

export interface InvocationIdentity {
  readonly societyBirth: string;
  readonly actor: string;
  /** The host-resolved origin session, not a newly invented id on fork/resume. */
  readonly session: string;
  /** Original assistant entry owning this tool call, not the current leaf. */
  readonly branch: string;
  readonly toolCall: string;
}
export interface InvocationBinding extends InvocationIdentity {
  readonly version: "collaboration-v1";
  readonly identityVersion: 1;
  readonly key: string;
  readonly tool: string;
  readonly method: MutationMethod;
  readonly args: Json;
  readonly argsSha256: string;
  readonly createdAtMs: number;
  readonly phase: "bound" | "frozen" | "sending" | "observed" | "resolved" | "rejected";
  readonly frozen: { readonly requestSha256: string } | null;
  readonly receipt: Receipt | null;
  readonly resolution?: InvocationResolution;
  readonly rejection?: InvocationRejection;
  readonly creation?: CreateResolution;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const invalid = (reason: string): Decoded<never> => ({ ok: false, reason });
const scopeKeys = ["societyBirth", "actor", "session", "branch", "toolCall"] as const;
export function invocationKey(identity: InvocationIdentity): string {
  if (!object(identity) || !scopeKeys.every(key => text(identity[key])) || !isValidActor(identity.actor))
    throw new TypeError("invalid host invocation identity shape");
  // Tool/arguments are deliberately excluded: changing either under the original
  // call must conflict, never escape to another request key.
  const tuple = Object.fromEntries(scopeKeys.map(key => [key, identity[key]]));
  return `inv1-${sha256Hex(canonicalCollaborationJson({ version: 1, ...tuple }))}`;
}
export function newInvocationBinding(identity: InvocationIdentity, tool: string, method: MutationMethod,
  args: unknown, createdAtMs = Date.now()): InvocationBinding {
  const encoded = canonicalCollaborationJson(args);
  const value = { version: "collaboration-v1", identityVersion: 1, ...identity, key: invocationKey(identity), tool, method,
    args: JSON.parse(encoded) as Json, argsSha256: sha256Hex(encoded), createdAtMs, phase: "bound", frozen: null, receipt: null };
  const decoded = decodeInvocationBinding(value, value.key);
  if (!decoded.ok) throw new TypeError(decoded.reason);
  return decoded.value;
}
export function invocationFreezeSha256(request: CachedRequest): string {
  return sha256Hex(canonicalCollaborationJson({ version: 1, key: request.key, method: request.method,
    params: request.params, digest: request.digest ?? null }));
}
/** One relationship check for already-decoded protected original metadata. The
 * creation date is intentionally outside historical request/freeze hashes, but
 * must still be the original binding's date. This grants no effect authority. */
export function invocationFreezeMatches(binding: InvocationBinding, request: CachedRequest): boolean {
  return request.key === binding.key && request.method === binding.method && request.createdAtMs === binding.createdAtMs &&
    (binding.frozen === null || binding.frozen.requestSha256 === invocationFreezeSha256(request));
}
export function decodeInvocationBinding(value: unknown, expectedKey: string): Decoded<InvocationBinding> {
  try {
    const encoded = canonicalCollaborationJson(value);
    const row: unknown = JSON.parse(encoded);
    if (!object(row) || !exact(row, ["version", "identityVersion", ...scopeKeys, "key", "tool", "method", "args", "argsSha256", "createdAtMs", "phase", "frozen", "receipt", ...(Object.hasOwn(row, "resolution") ? ["resolution"] : []), ...(Object.hasOwn(row, "creation") ? ["creation"] : []), ...(Object.hasOwn(row, "rejection") ? ["rejection"] : [])]))
      return invalid("invocation binding must be closed");
    if (row.version !== "collaboration-v1" || row.identityVersion !== 1 || !scopeKeys.every(key => text(row[key])))
      return invalid("invalid invocation version or origin");
    if (!text(row.societyBirth) || !text(row.actor) || !text(row.session) || !text(row.branch) || !text(row.toolCall))
      return invalid("invalid original invocation identity");
    const identity: InvocationIdentity = { societyBirth: row.societyBirth, actor: row.actor, session: row.session, branch: row.branch, toolCall: row.toolCall };
    if (invocationKey(identity) !== expectedKey || row.key !== expectedKey) return invalid("invocation origin differs from its key");
    if (!text(row.tool) || !collaborationOmaNames(row.actor === "principal" ? "principal" : "resident").includes(row.tool) || !isMutationMethod(row.method) || !collaborationMutationMethods(row.tool).includes(row.method))
      return invalid("invocation tool/role or mutation method is invalid");
    if (!object(row.args) || typeof row.argsSha256 !== "string" || sha256Hex(canonicalCollaborationJson(row.args)) !== row.argsSha256)
      return invalid("invocation arguments differ from their digest");
    if (collaborationMutationMethod(row.tool, row.args) !== row.method) return invalid("invocation method does not match its exact action arguments");
    if (typeof row.createdAtMs !== "number" || !Number.isSafeInteger(row.createdAtMs) || row.createdAtMs < 0 || !Number.isFinite(new Date(row.createdAtMs).getTime()) ||
        (row.phase !== "bound" && row.phase !== "frozen" && row.phase !== "sending" && row.phase !== "observed" && row.phase !== "resolved" && row.phase !== "rejected"))
      return invalid("invalid invocation observation state");
    let frozen: InvocationBinding["frozen"] = null;
    if (row.frozen !== null) {
      if (!object(row.frozen) || !exact(row.frozen, ["requestSha256"]) || typeof row.frozen.requestSha256 !== "string" ||
          !/^[a-f0-9]{64}$/.test(row.frozen.requestSha256)) return invalid("invalid invocation freeze linkage");
      frozen = { requestSha256: row.frozen.requestSha256 };
    }
    let receipt: Receipt | null = null;
    if (row.receipt !== null) {
      const decoded = decodeReceipt(row.receipt, { expectedKind: row.method });
      if (!decoded.ok) return invalid(`invalid original receipt: ${decoded.reason}`);
      receipt = decoded.value;
    }
    let resolution: InvocationResolution | undefined;
    if (Object.hasOwn(row, "resolution")) {
      const decoded = decodeInvocationResolution(row.resolution);
      if (!decoded.ok) return invalid(decoded.reason);
      const target = decoded.value.target;
      if (row.method !== "attest.record" || (row.tool !== "oma_merge" && row.tool !== "oma_challenge") ||
          !object(target) || target.requester !== row.actor || target.societyBirth !== row.societyBirth ||
          typeof row.args.proposal !== "string" || !row.args.proposal.endsWith(`/reviews/${String(target.request)}/targets/proposal-${sha256Hex(canonicalCollaborationJson(target))}.json`) ||
          typeof target.requestName !== "string" || !target.requestName.startsWith(row.tool === "oma_merge" ? "merge-" : "challenge-") || decoded.value.requestKey === expectedKey)
        return invalid("existing resolution belongs to another original invocation");
      resolution = decoded.value;
    }
    let creation: CreateResolution | undefined;
    if (Object.hasOwn(row, "creation")) {
      if (row.method !== "agent.create" || !object(row.creation) || !exact(row.creation, ["specHash", "policyRevision"]) ||
          typeof row.creation.specHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.creation.specHash) || !text(row.creation.policyRevision))
        return invalid("invalid original creation resolution");
      creation = { specHash: row.creation.specHash, policyRevision: row.creation.policyRevision };
    }
    let rejection: InvocationRejection | undefined;
    if (Object.hasOwn(row, "rejection")) {
      const decoded = decodeInvocationRejection(row.rejection);
      if (!decoded.ok || invocationPreacceptReason(decoded.value.failure, row.tool) !== decoded.value.reason)
        return invalid("preaccept completion has an invalid original diagnostic");
      rejection = decoded.value;
    }
    if ((row.phase === "rejected") !== (rejection !== undefined) || (rejection !== undefined && (frozen !== null || receipt !== null || resolution !== undefined)))
      return invalid("inconsistent original closed-before-send completion");
    if ((row.phase === "resolved") !== (resolution !== undefined) || (row.phase === "resolved" && frozen === null))
      return invalid("inconsistent original no-effect resolution");
    if ((row.phase === "bound" && row.frozen !== null) || ((row.phase === "frozen" || row.phase === "sending") && row.frozen === null) ||
        (row.phase === "observed") !== (receipt !== null)) return invalid("inconsistent invocation phase");
    // Raw args are independent JSON produced by canonical validation above.
    return { ok: true, value: { version: "collaboration-v1", identityVersion: 1, ...identity, key: expectedKey,
      tool: row.tool, method: row.method, args: row.args as Json, argsSha256: row.argsSha256,
      createdAtMs: row.createdAtMs, phase: row.phase, frozen, receipt, ...(resolution === undefined ? {} : { resolution }), ...(creation === undefined ? {} : { creation }), ...(rejection === undefined ? {} : { rejection }) } };
  } catch (error) { return invalid(error instanceof Error ? error.message : "invalid invocation encoding"); }
}
