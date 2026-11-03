import { join } from "node:path";
import { readResult } from "@oma/tool-files/results";
import { createHash } from "node:crypto";
import type { MutationMethod, PublicMethod, PublicMethods, Receipt } from "@oma/contracts";
import { currentContext, inContext, type ClientContext } from "./context.js";
import type { InvocationMailObservation, InvocationLink, InvocationOrigin, InvocationResolution } from "@oma/contracts/public-wire";
import { decodeInvocationRejection, invocationPreacceptReason } from "@oma/protocol/invocation-rejection";
import { decodeInvocationResolution } from "@oma/protocol/invocation-resolution";
import { decodeFrozenSubmission, decodeSubmissionPublication, submissionPublicationKey, submissionPublicationSubject, type SubmissionPublication } from "@oma/protocol/invocation-submission";
import { createRootId, createSourceRequestKey, attachmentRequestKey, mailAttachmentRootId } from "@oma/domain/derived";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { decodeInvocationMail } from "@oma/protocol/invocation-mail";
import type { MailRootFreeze } from "@oma/contracts/values";
import { parseMessageId } from "@oma/domain/identifiers";
import { ClientError, PreacceptRejectionError, fail } from "./errors.js";
import { RequestService, type FreshBuild, type RequestOptions } from "./request-service.js";
import { runtime, type GrantProvider } from "./runtime.js";
import { bundleBytes, frameBytes } from "./settings.js";
import { Transport } from "./transport.js";
export { ClientError, PreacceptRejectionError } from "./errors.js";

/** P0: a complete answer is never refused for its size. Longer than this, the
 * tool result carries a marked head and the path the whole text was saved to;
 * what the caller asked for stays one read away instead of one error away. */
const PREVIEW_BYTES = 1024 * 1024;
const PAGE = 64 * 1024;
const fullOid = (value: unknown): value is string => runtime().fullOid(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function invocationMailFreeze(actor: string, key: string): MailRootFreeze {
  return { version: "mail-root-v1", operation: mailAttachmentRootId(actor, key), dateMs: Math.floor(Date.now() / 1000) * 1000 };
}
function bodyText(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > frameBytes()) fail("file is larger than the request frame", 2);
  return bytes.toString("utf8").replace(/\r\n/g, "\n");
}
/** ID-002's request-key grammar bounds a key at 96 characters. A review
 * request's candidate publication runs under its own frozen request: the
 * caller's key plus `.submit` while that stays inside the grammar, and a
 * 24-character head plus the full SHA-256 of the caller's key when it does
 * not. One original key always derives one valid key, and two original keys
 * never derive the same one -- a retry replays this request's frozen
 * publication instead of colliding with another request's. */
const REQUEST_KEY_LIMIT = 96;
const SUBMIT_SUFFIX = ".submit";
const SUBMIT_HEAD = REQUEST_KEY_LIMIT - SUBMIT_SUFFIX.length - 1 - 64;
function submitRequestKeyFor(key: string): string {
  const derived = `${key}${SUBMIT_SUFFIX}`;
  if (derived.length <= REQUEST_KEY_LIMIT) return derived;
  return `${key.slice(0, SUBMIT_HEAD)}${SUBMIT_SUFFIX}-${sha256(Buffer.from(key, "utf8"))}`;
}
class DeferredReceipt extends ClientError {
  constructor(readonly publication: Receipt, readonly key: string, readonly publicationKey: string) {
    super("candidate publication did not complete", runtime().receiptExit(publication) || 3, key, publication);
  }
}
const INVOCATION_RECOVERY_GUIDANCE = "Preserve the original invocation and its frozen inputs. The host reconnects observations before a later model request; continuation requires an authorized activation and the original owners. Do not create another call or key to escape uncertainty.";
/** Never represents the child's receipt as acceptance of its parent review. */
export class SubmissionPublicationError extends ClientError {
  constructor(key: string, readonly publication: SubmissionPublication, detail: string, original?: ClientError) {
    super(`Original invocation requires observation or recovery: ${detail}; preserve invocation ${key}. Publication and review acceptance are separate.`,
      original?.exitCode ?? 3, key, original?.receipt, original?.contradicted ?? false, original?.code, original?.failure);
  }
}
export interface MergeOpenInput {
  tier: "LOW" | "MEDIUM" | "HIGH"; title: string; reason: string; candidate?: string; base?: string;
}
export interface ChallengeOpenInput {
  merge: string; tier: "LOW" | "HIGH"; title: string; reason: string;
  replacement?: { candidate: string; base: string };
}
export interface ReviewDiffInput {
  name: string; view?: "proposal" | "original" | "applied" | "context"; path?: string; cursor?: number;
}
export interface ReviewResponseInput {
  name: string; action: "comment" | "approve" | "reject"; body: string; approval?: string;
}

export type CollaborationOutcome =
  | { readonly disposition: "new" | "replayed"; readonly receipt: Receipt; readonly mail?: InvocationMailObservation; readonly publication?: SubmissionPublication }
  | { readonly disposition: "existing"; readonly key: string; readonly resolution: InvocationResolution };
/** Internal short-circuit before mutable local freeze publication or transport. */
class ResolvedInvocation extends Error {
  constructor(readonly resolution: InvocationResolution) { super("Original invocation resolved without a new effect"); }
}
/** A concurrent sender's canonical original receipt short-circuits preparation/send.
 * This never substitutes a different call's success for a missing tool result. */
class AcceptedInvocation extends Error {
  constructor(readonly outcome: Extract<CollaborationOutcome, { readonly receipt: Receipt }>) { super("Original invocation was already accepted"); }
}
export interface InvocationObservation {
  readonly link: InvocationLink;
  /** null: explicit REQUEST_NOT_FOUND, or the link's durable no-effect resolution. */
  readonly receipt: Receipt | null;
}
function decodeInvocationLink(value: unknown): InvocationLink {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ClientError("invalid host invocation link", 3);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== ["frozen", "key", "method", "phase", ...(Object.hasOwn(row, "resolution") ? ["resolution"] : []), ...(Object.hasOwn(row, "rejection") ? ["rejection"] : []), ...(Object.hasOwn(row, "mail") ? ["mail"] : []), ...(Object.hasOwn(row, "publication") ? ["publication"] : [])].sort().join(",") ||
      typeof row.key !== "string" || !/^inv1-[a-f0-9]{64}$/u.test(row.key) ||
      typeof row.method !== "string" || !runtime().mutation(row.method) || typeof row.frozen !== "boolean" ||
      (row.phase !== "bound" && row.phase !== "frozen" && row.phase !== "sending" && row.phase !== "observed" && row.phase !== "resolved" && row.phase !== "rejected") ||
      (row.phase === "bound" && row.frozen) || ((row.phase === "frozen" || row.phase === "sending" || row.phase === "resolved") && !row.frozen))
    throw new ClientError("invalid closed host invocation link", 3);
  const decoded = Object.hasOwn(row, "resolution") ? decodeInvocationResolution(row.resolution) : undefined;
  if ((row.phase === "resolved") !== (decoded !== undefined) || (decoded !== undefined &&
      (!decoded.ok || decoded.value.requestKey === row.key || row.method !== "attest.record")))
    throw new ClientError("inconsistent original no-effect resolution", 3, row.key);
  const rejection = Object.hasOwn(row, "rejection") ? decodeInvocationRejection(row.rejection) : undefined;
  if ((row.phase === "rejected") !== (rejection !== undefined) || (rejection !== undefined && (!rejection.ok || row.frozen || decoded !== undefined || Object.hasOwn(row, "mail") || Object.hasOwn(row, "publication"))))
    throw new ClientError("inconsistent original preaccept completion", 3, row.key);
  const publication = Object.hasOwn(row, "publication") ? decodeSubmissionPublication(row.publication, row.key) : undefined;
  if (publication !== undefined && (!publication.ok || !row.frozen || row.method !== "attest.record" || decoded !== undefined))
    throw new ClientError("inconsistent original publication observation", 3, row.key);
  const mail = Object.hasOwn(row, "mail") ? decodeInvocationMail(row.mail) : undefined;
  if (mail !== undefined && (!mail.ok || row.phase !== "observed" || row.method !== "mail.send"))
    throw new ClientError("inconsistent original mail observation", 3, row.key);
  // SAFETY: the closed shape, runtime method predicate and resolution codec validated the values.
  return { key: row.key, method: row.method as MutationMethod, phase: row.phase, frozen: row.frozen,
    ...(mail?.ok ? { mail: mail.value } : {}), ...(decoded?.ok ? { resolution: decoded.value } : {}), ...(rejection?.ok ? { rejection: rejection.value } : {}), ...(publication?.ok ? { publication: publication.value } : {}) };
}

export class Client {
  private readonly transport: Transport;
  private service: RequestService | undefined;
  private readonly context: ClientContext;
  constructor(context: ClientContext, grant: GrantProvider = () => null,
    private readonly prepare?: (signal?: AbortSignal) => Promise<void>) {
    this.context = { ...context, env: Object.freeze({ ...context.env }) };
    this.transport = new Transport(grant);
  }
  /** The trusted adapter reads only its host-bound health file, not history or
   * arbitrary sources. No credential wait, transport, refresh or ACK is involved. */
  collaborationRecordNotice(root: string): string | null {
    return inContext(this.context, () => runtime().collaborationRecordNotice?.(root) ?? null);
  }
  private requests(): RequestService {
    // The context's home is the request cache's root (the local caller's
    // is its agent-owned OMA_AGENT_HOME). A caller whose environment has no
    // HOME has no root; a shared /tmp guessed for it is not one.
    const home = this.context.env.HOME;
    if (home === undefined || home.length === 0)
      throw new ClientError("HOME is not set; the request cache has no root", 4);
    return this.service ??= new RequestService(runtime().cache(home, 2 * frameBytes()),
      (method, params, key, body) => this.transport.call(method, params, key, body));
  }
  private scope<T>(signal: AbortSignal | undefined, action: () => Promise<T>, request?: string): Promise<T> {
    return inContext({ ...this.context, signal }, async () => {
      try {
        await this.prepare?.(signal);
        if (signal?.aborted) throw new ClientError(`Outcome unknown: observation stopped before replying${request === undefined ? "" : `; observe oma_operation_status with key ${request}`}`, 3, request, undefined, false, "BROKER_UNAVAILABLE");
        return await action();
      } catch (error) {
        if (error instanceof ClientError) throw error;
        const failure = runtime().failure(error);
        throw new ClientError(JSON.stringify({ ...failure, ...(request === undefined ? {} : { request }) }),
          runtime().failureExit(failure), request, undefined, false, failure.code, failure);
      }
    });
  }
  requestReceipt(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal, options: RequestOptions = {}): Promise<Receipt> {
    return this.scope(signal, () => this.requests().requestReceipt(method, key, build, comparable, options), key);
  }
  /** Observe/reconnect an original call without executing it or reading sources.
   * Pi's adapter persists the returned observation before its next model request. */
  observeInvocation(tool: string, origin: InvocationOrigin, args: unknown, signal?: AbortSignal): Promise<InvocationObservation> {
    return this.scope(signal, async () => {
      const argumentsSnapshot = runtime().snapshot(args);
      const link = decodeInvocationLink(await this.query("invocation.bind",
        { contract: "collaboration-v1", origin, tool, arguments: argumentsSnapshot }, signal));
      if (link.resolution !== undefined || link.rejection !== undefined) return { link, receipt: null };
      let known: Receipt | undefined;
      try {
        const raw = await this.query("operation.get", { key: link.key }, signal);
        const decoded = runtime().decodeReceipt(raw, { expectedKind: link.method, allowNotFound: true });
        if (!decoded.ok) throw new ClientError(`invalid original receipt: ${decoded.reason}`, 3, link.key);
        if (runtime().notFound(decoded.value)) {
          if (link.phase === "observed") throw new ClientError("broker absence contradicts the original observed receipt", 3, link.key);
          return { link, receipt: null };
        }
        known = decoded.value;
        const checkpoint = decodeInvocationLink(await this.query("invocation.bind",
          { contract: "collaboration-v1", origin, tool, arguments: argumentsSnapshot }, signal));
        if (checkpoint.key !== link.key || checkpoint.method !== link.method || checkpoint.phase !== "observed")
          throw new ClientError("original receipt was not durably linked", 3, link.key, known);
        if (checkpoint.mail !== undefined && parseMessageId(checkpoint.mail.message)?.operationId !== known.operation)
          throw new ClientError("mail observation belongs to another original operation", 3, link.key, known);
        return { link: checkpoint, receipt: known };
      } catch (error) {
        if (error instanceof ClientError) throw new ClientError(error.message, error.exitCode, link.key, known ?? error.receipt,
          error.contradicted, error.code, error.failure);
        throw new ClientError(`Original receipt observation failed: ${error instanceof Error ? error.message : String(error)}`, 3, link.key, known);
      }
    });
  }
  /** Called only by Pi's active-run boundary, never by record/context observation.
   * A completed original freeze may be replayed, but no source builder is available.
   * RequestService independently requires explicit absence before every frozen send;
   * the original domain owner still checks current authority at fresh acceptance. */
  resumeInvocation(tool: string, origin: InvocationOrigin, args: unknown, signal: AbortSignal, continuationPermitted: () => boolean): Promise<CollaborationOutcome | null> {
    return this.scope(signal, async () => {
      if (continuationPermitted() !== true) throw new ClientError("original continuation is outside the current verified role loadout", 3);
      const original = await this.observeInvocation(tool, origin, args, signal);
      if (original.link.rejection !== undefined) return null;
      if (original.link.resolution !== undefined)
        return { disposition: "existing", key: original.link.key, resolution: original.link.resolution };
      if (original.receipt !== null) return { disposition: "replayed", receipt: original.receipt,
        ...(original.link.publication === undefined ? {} : { publication: original.link.publication }),
        ...(original.link.mail === undefined ? {} : { mail: original.link.mail }) };
      if (!original.link.frozen || original.link.phase !== "sending") return null;
      signal.throwIfAborted();
      return this.linkedInvocation(tool, origin, args, () => {
        throw new ClientError("original completed local freeze is unavailable; continuation cannot rebuild its sources", 3, original.link.key);
      }, () => ({}), signal, continuationPermitted);
    });
  }
  invocationReceipt(tool: string, origin: InvocationOrigin, args: unknown,
    build: () => FreshBuild | Promise<FreshBuild>, comparable: () => Record<string, unknown>, signal?: AbortSignal): Promise<Receipt> {
    return this.linkedInvocation(tool, origin, args, build, comparable, signal).then(outcome => {
      if (outcome.disposition === "existing") throw new ClientError("Original invocation resolved without a new operation; observe its existing resolution", 2, outcome.key);
      return outcome.receipt;
    });
  }
  /** Opt-in host linkage. Legacy callers keep requestReceipt/effect unchanged.
   * Origin is captured by the engine adapter, never a model tool parameter. */
  private linkedInvocation(tool: string, origin: InvocationOrigin, args: unknown,
    build: (key: string) => FreshBuild | Promise<FreshBuild>, comparable: () => Record<string, unknown>, signal?: AbortSignal, continuationPermitted?: () => boolean): Promise<CollaborationOutcome> {
    return this.scope(signal, async () => {
      const argumentsSnapshot = runtime().snapshot(args);
      const bind = async (): Promise<InvocationLink> => decodeInvocationLink(await this.query("invocation.bind",
        { contract: "collaboration-v1", origin, tool, arguments: argumentsSnapshot }, signal));
      const original = await bind();
      if (original.rejection !== undefined) throw new PreacceptRejectionError(original.key, original.rejection);
      if (original.resolution !== undefined) return { disposition: "existing", key: original.key, resolution: original.resolution };
      let publication = original.publication;
      let mail = original.mail;
      const checkpoint = async (): Promise<void> => {
        const current = await bind();
        if (current.key !== original.key || current.method !== original.method || current.phase !== "observed")
          throw new ClientError("original receipt was not linked by the host; no new execution", 3, original.key);
        publication = current.publication ?? publication;
        mail = current.mail ?? mail;
      };
      const alreadySettled = async (current: InvocationLink): Promise<void> => {
        if (current.key !== original.key || current.method !== original.method)
          throw new ClientError("original invocation identity changed while observing its outcome", 3, original.key);
        if (current.rejection !== undefined) throw new PreacceptRejectionError(original.key, current.rejection);
        if (current.resolution !== undefined) throw new ResolvedInvocation(current.resolution);
        if (current.phase === "observed") {
          const observed = await this.observeInvocation(tool, origin, argumentsSnapshot, signal);
          if (observed.receipt === null) throw new ClientError("original observed acceptance has no canonical receipt", 3, original.key, undefined, true);
          throw new AcceptedInvocation({ disposition: "replayed", receipt: observed.receipt,
            ...(observed.link.publication === undefined ? {} : { publication: observed.link.publication }),
            ...(observed.link.mail === undefined ? {} : { mail: observed.link.mail }) });
        }
      };
      const prepareOriginal = async (): Promise<FreshBuild> => {
        try {
          const fresh = await build(original.key);
          if (fresh.method !== "mail.send") return fresh;
          const input = decodeMutationPayload("mail.send", fresh.params);
          if (input.collaboration === undefined) throw new ClientError("selected mail requires its collaboration source manifest", 2, original.key);
          // Every selected Mail intent owns its message identity and Date before
          // protection, including text-only and already-shared attachments.
          // Completed originals never enter this fresh-source builder.
          const freeze = input.collaboration.freeze ?? invocationMailFreeze(this.context.env.OMA_ACTOR ?? "", original.key);
          return { ...fresh, params: { ...input, collaboration: { ...input.collaboration, freeze } } };
        }
        catch (error) {
          if (error instanceof PreacceptRejectionError) throw error;
          const failure = error instanceof ClientError && error.failure !== undefined ? error.failure :
            error instanceof ClientError && error.exitCode === 2 && error.receipt === undefined && !error.contradicted
              ? { code: "INVALID_REQUEST" as const, message: error.message, retry: "never" as const } : runtime().failure(error);
          if (invocationPreacceptReason(failure, tool) === null) throw error;
          let closed: InvocationLink;
          try { closed = decodeInvocationLink(await this.query("invocation.prepare", { contract: "collaboration-v1", key: original.key, reject: failure }, signal)); }
          catch (closureError) {
            throw new ClientError(`Source preparation failed: ${failure.message}; original preaccept closure could not be observed: ${closureError instanceof Error ? closureError.message : String(closureError)}. Preserve this original invocation.`,
              3, original.key, undefined, false, failure.code, failure);
          }
          await alreadySettled(closed);
          throw error; // A sending/frozen link is not permission to claim nonacceptance.
        }
      };
      const assertContinuation = (): void => {
        if (continuationPermitted !== undefined && continuationPermitted() !== true)
          throw new ClientError("original continuation is outside the current verified role loadout", 3, original.key);
      };
      try {
        // Independent canonical lookup remains possible even when the mutable
        // local cache is missing/corrupt. Never rebuild a completed host freeze.
        if (original.frozen || original.phase === "observed") {
          const raw = await this.query("operation.get", { key: original.key }, signal);
          const receipt = runtime().decodeReceipt(raw, { expectedKind: original.method, allowNotFound: true });
          if (!receipt.ok) throw new ClientError(`invalid original receipt: ${receipt.reason}`, 3, original.key);
          if (!runtime().notFound(receipt.value)) {
            try { await checkpoint(); }
            catch (error) { throw new ClientError(`Original receipt could not be linked durably: ${error instanceof Error ? error.message : String(error)}`,
              3, original.key, receipt.value); }
            return { disposition: "replayed", receipt: receipt.value, ...(mail === undefined ? {} : { mail }), ...(publication === undefined ? {} : { publication }) };
          }
          if (original.phase === "observed") throw new ClientError("broker absence contradicts the original observed receipt", 3, original.key);
        }
        const receipt = await this.requests().requestReceipt(original.method, original.key, prepareOriginal, comparable, {
          recoveryGuidance: INVOCATION_RECOVERY_GUIDANCE,
          beforePrepare: async () => {
            const current = await bind();
            await alreadySettled(current);
            if (current.key !== original.key || current.method !== original.method || current.frozen || current.phase !== "bound")
              throw new ClientError("original local freeze is missing; no source reconstruction permitted", 3, original.key);
          },
          beforeFreeze: async fresh => {
            const staged = decodeInvocationLink(await this.query("invocation.prepare", { contract: "collaboration-v1", key: original.key,
              params: fresh.params, ...(fresh.digest === undefined ? {} : {
                content: { ...fresh.digest, mediaType: fresh.method === "mail.send" ? "application/vnd.oma.attachments-v1" : fresh.method === "agent.create" || decodeFrozenSubmission(fresh.params, original.key).ok ? "application/x-git-bundle" : "application/vnd.oma.context-v1" } }) }, signal, fresh.stream));
            await alreadySettled(staged);
            if (staged.key !== original.key || staged.method !== original.method || staged.phase !== "sending" || !staged.frozen)
              throw new ClientError("original source bytes were not protected before local freeze publication", 3, original.key);
          },
          needsFrozenBody: async frozen => {
            const compound = decodeFrozenSubmission(frozen.params, original.key);
            if (!compound.ok) return true;
            const current = await bind();
            return current.publication?.key !== compound.value.publication.key || current.publication.receipt?.state !== "succeeded";
          },
          beforeSend: async (frozen, body) => {
            if (frozen.key !== original.key || frozen.method !== original.method)
              throw new ClientError("this protected invocation driver does not accept a different original request", 3, original.key);
            const bound = await bind();
            await alreadySettled(bound);
            // A recovered protected freeze may not yet have its send marker.
            // The existing prepare owner below compares exact protected bytes
            // and performs admission/marker publication before any effect send.
            if (bound.key !== original.key || bound.method !== original.method || !bound.frozen || (bound.phase !== "frozen" && bound.phase !== "sending"))
              throw new ClientError("original protected freeze is missing; a mutable cache cannot establish source ownership", 3, original.key);
            // Compare the existing protected freeze; never establish original
            // source ownership from the model-mutable local cache on replay.
            const linked = decodeInvocationLink(await this.query("invocation.prepare", { contract: "collaboration-v1", key: original.key,
              params: frozen.params }, signal));
            await alreadySettled(linked);
            if (linked.key !== original.key || linked.method !== original.method || linked.phase !== "sending" || linked.frozen !== true)
              throw new ClientError("original send marker was not persisted; no new execution", 3, original.key);
            const compound = decodeFrozenSubmission(frozen.params, original.key);
            if (compound.ok) {
              const child = compound.value.publication;
              let childReceipt: Receipt | null = null;
              try {
                const lookup = runtime().decodeReceipt(await this.query("operation.get", { key: child.key }, signal), { expectedKind: "git.submit", allowNotFound: true });
                if (!lookup.ok) throw new ClientError(`invalid original publication receipt: ${lookup.reason}`, 3, original.key);
                if (!runtime().notFound(lookup.value)) childReceipt = lookup.value;
                if (childReceipt === null) childReceipt = await this.requests().requestReceipt("git.submit", child.key, () => ({
                  method: "git.submit", params: { ...child.params }, ...(frozen.digest === undefined ? {} : { digest: frozen.digest }),
                  ...(body === undefined ? {} : { stream: body }),
                }), () => ({ ...child.params }), { displayKey: original.key, recoveryGuidance: INVOCATION_RECOVERY_GUIDANCE, beforeSend: async () => { assertContinuation(); } });
                publication = { key: child.key, receipt: childReceipt };
                if (childReceipt.state !== "succeeded") throw new SubmissionPublicationError(original.key, publication,
                  childReceipt.state === "failed" ? "the original publication failed; no review receipt is established" : "the original publication is pending; no review receipt is established");
              } catch (error) {
                if (error instanceof SubmissionPublicationError) throw error;
                if (error instanceof ClientError && error.receipt !== undefined) {
                  const known = runtime().decodeReceipt(error.receipt, { expectedKind: "git.submit" });
                  if (known.ok) childReceipt = known.value;
                }
                throw new SubmissionPublicationError(original.key, { key: child.key, receipt: childReceipt }, error instanceof Error ? error.message : String(error));
              }
            }
            assertContinuation();
          },
          transportPayload: (frozen, body) => {
            const compound = decodeFrozenSubmission(frozen.params, original.key);
            if (compound.ok) return { params: { ...compound.value.review } };
            const params = runtime().snapshot(frozen.params);
            if (params === null || typeof params !== "object" || Array.isArray(params)) throw new ClientError("invalid original frozen parameters", 3, original.key);
            return { params, ...(body === undefined ? {} : { body }) };
          },
          onReceipt: checkpoint,
        });
        return { disposition: original.frozen ? "replayed" : "new", receipt, ...(mail === undefined ? {} : { mail }), ...(publication === undefined ? {} : { publication }) };
      } catch (error) {
        if (error instanceof AcceptedInvocation) return error.outcome;
        if (error instanceof ResolvedInvocation) return { disposition: "existing", key: original.key, resolution: error.resolution };
        if (publication !== undefined && error instanceof ClientError && !(error instanceof SubmissionPublicationError))
          throw new SubmissionPublicationError(original.key, publication, error.message, error);
        if (error instanceof ClientError && error.request === undefined)
          throw new ClientError(error.message, error.exitCode, original.key, error.receipt, error.contradicted, error.code, error.failure);
        throw error;
      }
    });
  }
  /** Full source preparation remains in the installed application runtime, not
   * the model extension. Raw original arguments are bound before any reads. */
  collaborationReceipt(tool: string, origin: InvocationOrigin, args: unknown, role: "resident" | "principal", signal?: AbortSignal): Promise<CollaborationOutcome> {
    return this.scope(signal, () => {
      const snapshot = runtime().snapshot(args);
      return this.linkedInvocation(tool, origin, snapshot, async key => {
        const prepare = runtime().collaboration;
        if (!prepare) throw new ClientError("the protected source preparation runtime is unavailable", 2);
        const fresh = prepare(tool, snapshot, role);
        if (fresh.method === "agent.create") {
          if (role !== "resident") throw new ClientError("Worker creation belongs to Workers", 2, key);
          const input = decodeMutationPayload("agent.create", fresh.params);
          const collaboration = { version: "collaboration-v1", freeze: { version: "create-root-v1", operation: createRootId(this.context.env.OMA_ACTOR ?? "", key), dateMs: Math.floor(Date.now() / 1000) * 1000 } };
          const known = await this.query("git.known", { candidate: input.from }, signal);
          if (known.hasCandidate) return { method: "agent.create", params: { ...input, collaboration } };
          const staged = runtime().submit(input.from, createSourceRequestKey(key), known);
          if (!staged.content?.byteLength || staged.content.byteLength > bundleBytes()) throw new ClientError("original create source has no bounded frozen bundle", 3, key);
          const stream = Buffer.from(staged.content), digest = { bytes: stream.byteLength, sha256: sha256(stream) };
          return { method: "agent.create", params: { ...input, collaboration: { ...collaboration, stage: { exportRef: staged.exportRef, prerequisites: [...staged.prerequisites] } },
            content: { ...digest, mediaType: "application/x-git-bundle" } }, digest, stream };
        }
        if (fresh.method === "mail.send") {
          const input = decodeMutationPayload("mail.send", fresh.params), collaboration = input.collaboration;
          if (role === "principal" || !collaboration || collaboration.attachments.length === 0) return fresh;
          const attachments = collaboration.attachments.map(source => ({ ...source })), chunks: Buffer[] = [];
          let total = 0;
          for (const [ordinal, source] of attachments.entries()) {
            const known = await this.query("git.known", { candidate: source.commit, reachable: true }, signal);
            if (known.hasCandidate) continue;
            if (role !== "resident") throw new ClientError("local attachment publication belongs to Workers", 2, key);
            const staged = runtime().submit(source.commit, attachmentRequestKey(key, ordinal), known);
            if (!staged.content?.byteLength) throw new ClientError("unpublished attachment has no original frozen bundle", 3, key);
            if (staged.content.byteLength > bundleBytes() - total) throw new ClientError("attachment bundles exceed their effective ingress bound", 2, key);
            const bytes = Buffer.from(staged.content); chunks.push(bytes); total += bytes.byteLength;
            attachments[ordinal] = { ...source, stage: { exportRef: staged.exportRef, prerequisites: [...staged.prerequisites],
              bundle: { bytes: bytes.byteLength, sha256: sha256(bytes), mediaType: "application/x-git-bundle" } } };
          }
          if (total === 0) return fresh;
          const stream = Buffer.concat(chunks, total), digest = { bytes: total, sha256: sha256(stream) };
          return { method: "mail.send", params: { ...input, collaboration: { ...collaboration, freeze: invocationMailFreeze(this.context.env.OMA_ACTOR ?? "", key), attachments },
            content: { ...digest, mediaType: "application/vnd.oma.attachments-v1" } }, digest, stream };
        }
        if (fresh.method !== "attest.record" || (tool !== "oma_merge" && tool !== "oma_challenge") || fresh.params.kind === "collaboration.existing") return fresh;
        const review = decodeMutationPayload("attest.record", fresh.params);
        if ((review.kind !== "merge.open" && review.kind !== "challenge.open" && review.kind !== "review.revise") || review.candidate === undefined) return fresh;
        const known = await this.query("git.known", { candidate: review.candidate }, signal);
        if (known.hasCandidate) return fresh;
        if (role !== "resident") throw new ClientError("local publication belongs to Workers", 2, key);
        const childKey = submissionPublicationKey(key), staged = runtime().submit(review.candidate, childKey, known);
        if (!staged.content) throw new ClientError("original unpublished source has no frozen bundle", 3, key);
        const bundle = { bytes: staged.content.byteLength, sha256: sha256(staged.content), mediaType: "application/x-git-bundle" };
        const params = { kind: "collaboration.submission", review, publication: { key: childKey, params: {
          candidate: review.candidate, exportRef: staged.exportRef, prerequisites: staged.prerequisites,
          to: [this.context.env.OMA_ACTOR ?? ""], subject: submissionPublicationSubject(review, Number(this.context.env.OMA_SUBJECT_BYTES)),
          body: review.reason, paths: [], bundle,
        } } };
        const checked = decodeFrozenSubmission(params, key);
        if (!checked.ok) throw new ClientError(checked.reason, 2, key);
        return { method: "attest.record", params, digest: { bytes: bundle.bytes, sha256: bundle.sha256 }, stream: staged.content };
      }, () => ({}), signal);
    });
  }
  async effect(method: MutationMethod, key: string, build: () => FreshBuild | Promise<FreshBuild>,
    comparable: () => Record<string, unknown>, signal?: AbortSignal, options: RequestOptions = {}): Promise<string> {
    return this.scope(signal, async () => {
      let receipt: Receipt;
      try { receipt = await this.requests().requestReceipt(method, key, build, comparable, options); }
      catch (error) {
        if (error instanceof DeferredReceipt) return this.present(error.publication, error.key, error.publicationKey);
        if (error instanceof ClientError && error.receipt !== undefined) {
          const receipt = error.receipt as Receipt, observedKey = key;
          const publication = error.request === submitRequestKeyFor(key) ? error.request : undefined;
          const text = this.bounded(`${runtime().receiptText(receipt, observedKey, publication)}\n${error.message}; observe oma_operation_status with key ${observedKey}; preserve the same request key and frozen input`, observedKey);
          if (error.contradicted || runtime().receiptExit(receipt) !== 0)
            throw new ClientError(text, error.exitCode, observedKey, receipt, error.contradicted, error.code);
          return text;
        }
        if (error instanceof ClientError && error.request === undefined)
          throw new ClientError(error.failure === undefined ? `${error.message}; request ${key}` : JSON.stringify({ ...error.failure, request: key }),
            error.exitCode, key, undefined, false, error.code, error.failure);
        throw error;
      }
      return this.present(receipt, key);
    }, key);
  }
  /** Bounded model presentation only; the complete answer uses the existing
   * result spool. Neither its text nor its file is an acceptance ledger. */
  formatInvocation(value: unknown): string {
    return inContext(this.context, () => this.bounded(JSON.stringify(value)));
  }
  private bounded(text: string, key?: string): string {
    return Buffer.byteLength(text) <= PREVIEW_BYTES ? text : this.preview(Buffer.from(text, "utf8"), key);
  }
  /** A marked head of an answer that does not fit one tool result: the
   * `[preview]` notice names the complete answer's size and the path it was
   * saved to, so the head can never be mistaken for the answer. A caller
   * with no usable home still gets the exact size and why it is not saved;
   * a receipt's durable record is untouched either way. */
  private preview(bytes: Buffer, key?: string): string {
    let cut = Math.min(bytes.length, PREVIEW_BYTES);
    while (cut > 0 && (bytes[cut]! & 0xc0) === 0x80) cut--;
    const head = bytes.subarray(0, cut).toString("utf8");
    const home = this.context.env.HOME;
    let where: string;
    if (home !== undefined && home.length > 0) {
      try {
        where = `is at ${runtime().spoolOutput(home, bytes)}`;
      } catch (error) {
        where = `could not be saved (${error instanceof Error ? error.message : String(error)}); its head follows`;
      }
    } else {
      where = "could not be saved (no HOME); its head follows";
    }
    return `${head}\n[preview] the complete ${bytes.length}-byte answer ${where}${key === undefined ? "" : `; request ${key}`}`;
  }
  private present(receipt: Receipt, key: string, publication?: string): string {
    const text = this.bounded(runtime().receiptText(receipt, key, publication), key);
    const code = runtime().receiptExit(receipt);
    if (code !== 0) throw new ClientError(text, code, key, receipt, false, receipt.error?.code);
    return text;
  }
  query<M extends Exclude<PublicMethod, MutationMethod>>(method: M, params: Record<string, unknown>, signal?: AbortSignal, streamBytes?: Uint8Array): Promise<PublicMethods[M]["result"]> {
    return this.scope(signal, async () => {
      if (runtime().mutation(method)) fail("mutation requires a frozen request", 2);
      const reply = (await this.transport.call(method, params, undefined, streamBytes))[0];
      if (!reply?.ok) throw new ClientError(reply === undefined ? "invalid broker response" : runtime().failureText(reply.error),
        reply === undefined ? 3 : runtime().failureExit(reply.error), undefined, undefined, false,
        reply?.ok === false ? reply.error.code : undefined, reply?.ok === false ? reply.error : undefined);
      return reply.result as PublicMethods[M]["result"];
    });
  }
  queryText(method: Exclude<PublicMethod, MutationMethod>, params: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const key = method === "operation.get" && typeof params.key === "string" ? params.key : undefined;
    return this.scope(signal, async () => {
      const value = await this.query(method, params, signal);
      return this.bounded(key === undefined ? JSON.stringify(value) : runtime().receiptText(value as Receipt, key), key);
    }, key);
  }
  sendMail(input: { to: string[]; subject: string; body: string; kind: string; replyFile?: string }, key: string, signal?: AbortSignal): Promise<string> {
    const { replyFile, ...direct } = input;
    return this.effect("mail.send", key, () => ({ method: "mail.send", params: { ...direct, body: bodyText(input.body),
      ...(replyFile === undefined ? {} : runtime().reply(replyFile, false)) } }),
      () => ({ to: input.to, subject: input.subject, kind: input.kind }), signal);
  }
  publishGoal(body: string, expected: string | null, subject: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("context.publish", key, () => {
      if (Buffer.byteLength(body, "utf8") > frameBytes()) fail("file is larger than the request frame", 2);
      const prepared = runtime().goal(body, expected);
      return { method: "context.publish", params: { expected, goalMail: { subject }, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected, goalMail: { subject } }), signal);
  }
  publishContext(directory: string, expected: string | null, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("context.publish", key, () => {
      const prepared = runtime().context(directory);
      return { method: "context.publish", params: { expected, entries: prepared.entries,
        content: { ...prepared.digest, mediaType: "application/vnd.oma.context-v1" } }, digest: prepared.digest, stream: prepared.content };
    }, () => ({ expected }), signal);
  }
  createAgent(input: { name: string; from: string; brief: string }, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("agent.create", key, () => ({ method: "agent.create",
      params: { name: input.name, from: runtime().resolveOid(input.from), brief: bodyText(input.brief) } }),
      () => ({ name: input.name, ...(fullOid(input.from) ? { from: input.from } : {}) }), signal);
  }
  controlAgent(action: "start" | "stop", name: string, key: string, signal?: AbortSignal): Promise<string> {
    const method = action === "start" ? "agent.start" : "agent.stop", params = { agent: name };
    return this.effect(method, key, () => ({ method, params }), () => params, signal);
  }
  continueAgent(note: string, key: string, signal?: AbortSignal): Promise<string> {
    const params = { note: bodyText(note) };
    return this.effect("agent.continue", key, () => ({ method: "agent.continue", params }), () => params, signal);
  }
  subscribe(action: "follow" | "unfollow", topic: string, key: string, signal?: AbortSignal): Promise<string> {
    const method = action === "follow" ? "route.follow" : "route.unfollow", params = { topic };
    return this.effect(method, key, () => ({ method, params }), () => params, signal);
  }
  replyMail(input: { replyFile: string; body: string; to?: string[]; subject?: string; kind?: string }, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("mail.send", key, () => {
      const reply = runtime().reply(input.replyFile, input.subject === undefined, Number(this.context.env.OMA_SUBJECT_BYTES ?? 512));
      return { method: "mail.send", params: { to: input.to ?? [], subject: input.subject ?? reply.inheritedSubject!,
        body: bodyText(input.body), kind: input.kind ?? "message", replyToMessage: reply.replyToMessage } };
    }, () => ({ to: input.to ?? [], kind: input.kind ?? "message", ...(input.subject === undefined ? {} : { subject: input.subject }) }), signal);
  }
  approvalNotice(input: { subject: string; body: string; candidate: string; base: string; policyRevision: string; cc?: string[]; replyFile?: string },
    key: string, signal?: AbortSignal): Promise<string> {
    const params = { to: [...new Set(["principal", ...input.cc ?? []])], subject: input.subject, kind: "approval_required",
      approvalFor: { repo: "project", targetRef: "refs/heads/main", candidate: input.candidate,
        expectedBase: input.base, policyRevision: input.policyRevision } };
    return this.effect("mail.send", key, () => ({ method: "mail.send", params: { ...params, body: bodyText(input.body),
      ...(input.replyFile === undefined ? {} : runtime().reply(input.replyFile, false)) } }), () => params, signal);
  }
  publishCandidate(input: { candidate: string; subject: string; body: string; to?: string[]; paths?: string[] }, key: string, signal?: AbortSignal): Promise<string> {
    const explicit = () => ({ to: input.to ?? ["commons"], subject: input.subject, paths: input.paths ?? [],
      ...(fullOid(input.candidate) ? { candidate: input.candidate } : {}) });
    return this.effect("git.submit", key, async () => {
      const candidate = runtime().resolveOid(input.candidate);
      const known = await this.query("git.known", { candidate }, signal);
      const prepared = runtime().submit(candidate, key, known);
      const params: Record<string, unknown> = { ...explicit(), candidate, body: bodyText(input.body),
        exportRef: prepared.exportRef, prerequisites: prepared.prerequisites };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    }, explicit, signal);
  }
  /** Publish the candidate under `key`'s own frozen request,
   * `submitRequestKeyFor(key)`, while every recovery text names `key` -- the
   * request the caller actually started. The two identities stay apart: the
   * frozen request, its replay and its `operation.get` lookups keep the
   * derived key; only what the model is told to query again wears the
   * parent's. */
  private async ensurePublished(candidate: string, key: string): Promise<void> {
    const known = await this.query("git.known", { candidate }, currentContext().signal);
    if (known.hasCandidate) return;
    const self = this.context.env.OMA_ACTOR ?? "commons";
    const submitKey = submitRequestKeyFor(key);
    const receipt = await this.requests().requestReceipt("git.submit", submitKey, () => {
      const prepared = runtime().submit(candidate, submitKey, known);
      const params: Record<string, unknown> = { candidate, exportRef: prepared.exportRef, prerequisites: prepared.prerequisites,
        to: [self], subject: `merge candidate ${candidate.slice(0, 12)}`,
        body: "Candidate for a merge request; review happens in the request thread.", paths: [] };
      if (prepared.content === undefined) return { method: "git.submit", params };
      const digest = { bytes: prepared.content.length, sha256: sha256(prepared.content) };
      params.bundle = { ...digest, mediaType: "application/x-git-bundle" };
      return { method: "git.submit", params, digest, stream: prepared.content };
    }, () => ({ candidate, to: [self], subject: `merge candidate ${candidate.slice(0, 12)}`,
      body: "Candidate for a merge request; review happens in the request thread.", paths: [] }), { displayKey: key });
    if (receipt.state !== "succeeded") throw new DeferredReceipt(receipt, key, submitKey);
  }
  async reviewDiff(input: ReviewDiffInput, signal?: AbortSignal): Promise<string> {
    const kind = input.name.startsWith("merge-") ? "merge" : "challenge";
    if (!Number.isSafeInteger(input.cursor ?? 0) || (input.cursor ?? 0) < 0) throw new ClientError("invalid cursor", 2);
    return this.scope(signal, async () => {
      const detail = await this.query("review.status", { name: input.name }, signal) as {
        diff?: import("@oma/contracts/files").ReviewDiffArtifact;
        contextDiff?: import("@oma/contracts/files").ReviewDiffArtifact;
        proposal?: { candidate?: string; expectedBase?: string; policyRevision?: string };
        identity?: { candidate?: string; expectedBase?: string; policyRevision?: string };
        target?: { name: string; identity?: { candidate?: string; expectedBase?: string; policyRevision?: string } };
      };
      const view = input.view ?? "proposal";
      if (view === "applied" || view === "context") {
        const diff = view === "applied" ? detail.diff : detail.contextDiff, repository = this.context.env.OMA_PROJECT_GIT;
        if (!diff || !repository) throw new ClientError("no stored integration diff is visible for this request", 2);
        if (input.path !== undefined) throw new ClientError("stored diff pages have no path filter", 2);
        const page = readResult(join(repository, "oma-results"), diff.reference, { byteOffset: input.cursor ?? 0, byteLimit: PAGE, encoding: "base64" });
        if (page.bytes !== diff.bytes || page.sha256 !== diff.sha256) throw new ClientError("stored diff differs from its accepted identity", 2);
        return this.bounded(JSON.stringify({ name: input.name, view, base: diff.base, candidate: diff.candidate, ...page }));
      }
      const identity = view === "original" && kind === "challenge" ? detail.target?.identity : detail.proposal ?? detail.identity;
      if (!fullOid(identity?.candidate) || !fullOid(identity.expectedBase)) throw new ClientError(`${kind} status carries no diff identity for ${input.name}`, 2);
      const repository = this.context.env.OMA_PROJECT_GIT;
      if (!repository) throw new ClientError("no canonical code repository was provided", 2);
      const bytes = Buffer.from(runtime().code(repository, { action: "merge-diff", revision: identity.candidate,
        base: identity.expectedBase, ...(input.path === undefined ? {} : { path: input.path }) }).text);
      const cursor = input.cursor ?? 0;
      if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= Math.max(bytes.length, 1) || (cursor < bytes.length && (bytes[cursor]! & 0xc0) === 0x80))
        throw new ClientError(`cursor is not at a page boundary: ${cursor}`, 2);
      let cut = Math.min(bytes.length, cursor + PAGE);
      while (cut < bytes.length && cut > cursor && (bytes[cut]! & 0xc0) === 0x80) cut--;
      return this.bounded(JSON.stringify({ name: input.name, sourceRequest: view === "original" && kind === "challenge" ? detail.target?.name : input.name,
        view, base: identity.expectedBase, candidate: identity.candidate,
        policyRevision: identity.policyRevision ?? null, sha256: sha256(bytes), bytes: bytes.length,
        cursor, next: cut < bytes.length ? cut : null, text: bytes.subarray(cursor, cut).toString("utf8") }));
    });
  }
  openMerge(input: MergeOpenInput, key: string, signal?: AbortSignal): Promise<string> {
    return this.openReview({ ...input, kind: "merge.open" }, key, signal);
  }
  openChallenge(input: ChallengeOpenInput, key: string, signal?: AbortSignal): Promise<string> {
    return this.openReview({ kind: "challenge.open", merge: input.merge, tier: input.tier, title: input.title,
      reason: input.reason, ...input.replacement }, key, signal);
  }
  private openReview(input: (MergeOpenInput & { kind: "merge.open" }) |
    (Omit<ChallengeOpenInput, "replacement"> & { kind: "challenge.open"; candidate?: string; base?: string }),
    key: string, signal?: AbortSignal): Promise<string> {
    const explicit = () => ({ kind: input.kind, tier: input.tier, title: input.title,
      ...(input.kind === "challenge.open" ? { merge: input.merge } : {}),
      ...(fullOid(input.candidate) ? { candidate: input.candidate } : {}), ...(fullOid(input.base) ? { base: input.base } : {}) });
    return this.effect("attest.record", key, () => {
      const pair = input.kind === "challenge.open" && input.candidate === undefined ? null : {
        candidate: runtime().resolveOid(input.candidate ?? "HEAD"),
        base: input.base === undefined ? runtime().recordedBase() : runtime().resolveOid(input.base),
      };
      if (pair !== null) {
        if (pair.base === null) throw new ClientError("no recorded base: fetch canonical main and build the candidate on it", 2, key);
        if (runtime().workspaceDirty()) process.stderr.write("oma: workspace has uncommitted changes that are not part of the candidate\n");
      }
      return { method: "attest.record", params: { ...explicit(), reason: bodyText(input.reason), ...pair } };
    }, explicit, signal, { beforeSend: async frozen => {
      const params = frozen.params as Record<string, unknown>;
      if (fullOid(params.candidate)) await this.ensurePublished(params.candidate, key);
    } });
  }
  controlReview(input: { name: string; kind: "review.withdraw" | "review.invalidate"; vote: string; reason: string } |
      { name: string; kind: "review.retry"; expectedAttempt: string | null; expectedRevision?: number; reason: string } |
      { name: string; kind: "review.revise"; expectedRevision: number; base: string; candidate: string; reason: string }, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("attest.record", key, () => ({ method: "attest.record", params: input }), () => ({ ...input }), signal, input.kind === "review.revise" ? { beforeSend: async frozen => {
      const params = frozen.params as {candidate:string}; await this.ensurePublished(params.candidate,key);
    } } : undefined);
  }
  respondReview(input: ReviewResponseInput, key: string, signal?: AbortSignal): Promise<string> {
    const params = { name: input.name, ...(input.action === "comment" ? { kind: "review" } : {
      kind: "vote", verdict: input.action, ...(input.approval === undefined ? {} : { approval: input.approval }) }) };
    return this.effect("attest.record", key, () => ({ method: "attest.record", params: { ...params, body: bodyText(input.body) } }), () => params, signal);
  }
  cancelReview(name: string, reason: string, key: string, signal?: AbortSignal): Promise<string> {
    return this.effect("attest.record", key, () => ({ method: "attest.record", params: { kind: "cancel", name, reason: bodyText(reason) } }),
      () => ({ kind: "cancel", name }), signal);
  }
}
