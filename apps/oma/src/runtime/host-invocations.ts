/** MCS-X02: protected original-call linkage on the authenticated broker boundary.
 * Acceptance and physical recovery stay with the existing effect owners. This
 * adapter verifies source linkage and canonical observations; it owns no engine,
 * session writer, credentials, effect executor or work queue. */
import { basename, dirname, join } from "node:path";
import type { Address, AuthContext, Json, MailInput, PublicMethods, Receipt, Failure } from "@oma/contracts";
import type { InvocationMailObservation, InvocationLink, InvocationOrigin, InvocationResolution, InvocationRejection } from "@oma/contracts/public-wire";
import type { PublicInvocationPort } from "@oma/broker/ports";
import type { Store } from "@oma/storage";
import { expandAddresses } from "@oma/mail/routing";
import { assertActorIdentity, assertCurrentActor } from "@oma/domain/authority";
import { assertNewAcceptance } from "@oma/domain/admission";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { StoreError, publicFailure, unobserved } from "@oma/domain/errors";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { collaborationOmaNames } from "@oma/domain/collaboration-surface";
import { collaborationInputProblem, collaborationMutationMethod, collaborationInlineParameters } from "@oma/domain/collaboration-inputs";
import { sha256Hex } from "@oma/domain/canonical-json";
import { requestHash } from "@oma/domain/request-identity";
import { agentRootPathAt, assertModelScope, sessionDirPathAt, modelWorkspacePathAt } from "@oma/domain/paths";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { invocationPreacceptReason } from "@oma/protocol/invocation-rejection";
import { decodeFrozenInvocationResolution } from "@oma/protocol/invocation-resolution";
import { decodeFrozenSubmission, type SubmissionPublication } from "@oma/protocol/invocation-submission";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { receiptFactConflict } from "@oma/protocol/receipt-codec";
import { sessionInvocationEvidence } from "@oma/engine/pi-compat/session";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import { CacheError, RequestCache } from "../request-cache.js";
import { invocationKey, invocationFreezeMatches, type InvocationBinding } from "./invocation-codec.js";
import { collaborationSocietyBirth } from "./session-mode.js";
import { readUserFile } from "./user-files.js";
import type { FreshBuild } from "@oma/client/request-service";

export interface InvocationSourcePort {
  readonly streamBytes: number;
  readonly bundleBytes?: number;
  validate(auth: AuthContext, tool: string, args: Json, societyBirth?: string): void;
  prepare(auth: AuthContext, tool: string, args: Json, frozen: Json, bytes?: Uint8Array, societyBirth?: string, originalKey?: string): FreshBuild & { readonly resolution?: InvocationResolution };
  reviewGuard?(auth: AuthContext, tool: string, args: Json, societyBirth: string): () => undefined;
  freezeCreation?(auth: AuthContext, params: unknown): import("@oma/contracts/values").CreateResolution;
}

/** Actor-scoped observations only. Never expose original source arguments or
 * the protected cache path as ordinary model-readable records. */
export interface InvocationRecordObservation {
  readonly actor: string;
  readonly societyBirth: string;
  readonly key: string;
  readonly tool: string;
  readonly method: InvocationBinding["method"];
  readonly session: string;
  readonly branch: string;
  readonly toolCall: string;
  readonly phase: InvocationBinding["phase"];
  readonly receipt: Receipt | null;
  readonly resolution?: InvocationResolution;
  readonly rejection?: InvocationRejection;
  readonly publication?: SubmissionPublication;
}

const object = (value: Json): value is { [key: string]: Json } => value !== null && typeof value === "object" && !Array.isArray(value);
const link = (binding: InvocationBinding): InvocationLink => ({ key: binding.key, method: binding.method,
  phase: binding.phase, frozen: binding.frozen !== null, ...(binding.resolution === undefined ? {} : { resolution: binding.resolution }), ...(binding.rejection === undefined ? {} : { rejection: binding.rejection }) });

/** Retained exported adapter; the shared domain driver owns exact normalization. */
export function invocationTextMail(args: Json): MailInput {
  try {
    const { method, params } = collaborationInlineParameters("oma_send", args);
    if (method !== "mail.send") throw new TypeError("invalid normalized inline mail");
    return decodeMutationPayload("mail.send", params);
  } catch (cause) {
    if (cause instanceof StoreError) throw cause;
    throw new StoreError("UNSUPPORTED_PROFILE", "this invocation driver currently supports explicit inline text mail only", { cause });
  }
}
function invocationParameters(tool: string, args: Json, society?: string, role?: "resident" | "principal", subjectBytes?: number): Json {
  return collaborationInlineParameters(tool, args, {
    ...(society === undefined ? {} : { society }), ...(role === undefined ? {} : { role }),
    ...(subjectBytes === undefined ? {} : { subjectBytes }),
  }).params;
}

export class HostInvocations implements PublicInvocationPort {
  constructor(private readonly store: Store, private readonly stateRoot: string, private readonly society: string,
    private readonly selected: (actor: string) => boolean, private readonly metadataBytes: number, private readonly subjectBytes = 512,
    private readonly isPublished: (oid: string) => boolean = () => false, private readonly sources?: InvocationSourcePort,
    private readonly freshMutations?: "closed") {
    if (freshMutations !== undefined && freshMutations !== "closed")
      throw new StoreError("UNSUPPORTED_PROFILE", "unknown collaboration fresh-mutation admission policy");
  }

  /** This immutable broker-lifetime closure is separate from shutdown/corruption.
   * It fences new model intents only. Accepted effect owners, receipt observation,
   * diagnostics, legacy sessions and authenticated Human operations are unchanged. */
  private assertFreshAdmission(): void {
    assertNewAcceptance(this.store); // Original corruption/drain fences take precedence over this narrower policy.
    if (this.freshMutations === "closed") throw new StoreError("BROKER_UNAVAILABLE",
      "collaboration-v1 fresh model mutations are closed for this broker lifetime; preserve original calls and receipts. Accepted work and supervising-host controls retain their original owners. Reopening requires an explicit configuration change and broker restart, not a replacement key.",
      { details: { reason: "collaboration-admission-closed" } });
  }

  private publication(cache: RequestCache, binding: InvocationBinding): SubmissionPublication | undefined {
    if (binding.method !== "attest.record" || binding.frozen === null) return undefined;
    if (binding.tool !== "oma_merge" && binding.tool !== "oma_challenge") return undefined;
    const frozen = cache.read(binding.key);
    // Receipt observation never depends on opening or reconstructing source bytes.
    // A damaged freeze cannot establish a child relationship, but does not erase
    // an independently observed parent receipt.
    if (frozen.kind !== "present" || !invocationFreezeMatches(binding, frozen.value)) return undefined;
    const compound = decodeFrozenSubmission(frozen.value.params, binding.key);
    if (!compound.ok) return undefined;
    const child = compound.value.publication, operation = this.store.getOperation(binding.actor, child.key);
    if (operation !== null && (operation.kind !== "git.submit" || operation.requestHash !== requestHash("git.submit", child.params)))
      throw new CacheError("CACHE_CORRUPT", "original publication operation contradicts its frozen submission");
    return { key: child.key, receipt: operation === null ? null : receiptOfOperation(operation) };
  }
  private hasCompletedPublication(cache: RequestCache, binding: InvocationBinding): boolean {
    return binding.phase === "sending" && this.publication(cache, binding)?.receipt?.state === "succeeded";
  }
  private seal(cache: RequestCache, binding: InvocationBinding): InvocationBinding {
    if (this.hasCompletedPublication(cache, binding)) {
      // The already-sealed metadata and the exact canonical child receipt prove
      // original source ownership. Review transport never needs that bundle again.
      // No missing byte is rebuilt, sent or used to authorize fresh publication.
      return binding;
    }
    return cache.sealInvocation(binding.key);
  }
  private linked(cache: RequestCache, binding: InvocationBinding): InvocationLink {
    const publication = this.publication(cache, binding);
    const operation = binding.phase === "observed" && binding.method === "mail.send" ? this.store.getOperation(binding.actor, binding.key) : null;
    const base = { ...link(binding), ...(publication === undefined ? {} : { publication }) };
    if (operation?.kind !== "mail.send") return base;
    const input = decodeMutationPayload("mail.send", operation.payload), deliveries = this.store.deliveriesForOperation(operation.id);
    const materialized = deliveries.filter(row => row.materialized === 1).length;
    const sources = operation.plan.attachments?.sources ?? [], attachments: InvocationMailObservation["attachments"][number][] = [];
    const summary = { message: operation.plan.message.id, emlSha256: operation.plan.message.sha256,
      bodySha256: sha256Hex(input.body), bodyBytes: Buffer.byteLength(input.body, "utf8"), attachmentCount: sources.length,
      delivery: { recipientCount: deliveries.length, materialized, presented: deliveries.filter(row => row.presented === 1).length },
      source: "accepted-plan-and-delivery-facts; no fresh ref observation" as const };
    const mail = (): InvocationMailObservation => ({ ...summary, attachments, omittedAttachments: sources.length - attachments.length });
    // This is a preview, not a manifest quota. Full accepted dependency facts
    // remain in the ordinary receipt records, even when none fit this response.
    const budget = Math.max(0, Math.min(16 * 1024, Math.floor(this.metadataBytes / 2) - 512));
    for (const source of sources) {
      attachments.push({ commit: source.commit, objectFormat: source.objectFormat, publishedRef: source.publishedRef,
        sourcePublication: source.publication, ...(source.publicationOrdinal === undefined ? {} : { sourcePublicationOrdinal: source.publicationOrdinal }),
        ...(source.reachableFrom === undefined ? {} : { reachableFrom: source.reachableFrom }),
        publication: source.publication === null ? "canonical-before-acceptance" : source.local === undefined ? "shared-before-acceptance" : materialized > 0 || operation.state === "succeeded" ? "published-before-delivery" : "accepted-dependency" });
      if (Buffer.byteLength(canonicalCollaborationJson({ ...base, mail: mail() })) > budget) { attachments.pop(); break; }
    }
    const result = { ...base, mail: mail() };
    return Buffer.byteLength(canonicalCollaborationJson(result)) <= budget ? result : base;
  }
  /** Projection source: no bind, freeze, send-marker, resolution checkpoint or
   * receipt settlement. Canonical receipts remain observable without source I/O. */
  *records(auth: AuthContext): IterableIterator<InvocationRecordObservation> {
    const { cache, birth } = this.scope(auth, "records");
    for (const binding of cache.invocationRecords()) {
      assertActorIdentity(this.store, auth);
      if (binding.actor !== auth.actor || binding.societyBirth !== birth)
        throw new StoreError("STORE_CORRUPT", "protected invocation observations mix authenticated scopes");
      const receipt = this.canonicalReceipt(binding);
      if (binding.resolution !== undefined || binding.rejection !== undefined) this.assertNoEffectOperation(binding);
      const publication = this.publication(cache, binding);
      yield { actor: binding.actor, societyBirth: binding.societyBirth, key: binding.key, tool: binding.tool, method: binding.method,
        session: binding.session, branch: binding.branch, toolCall: binding.toolCall, phase: binding.phase, receipt,
        ...(binding.resolution === undefined ? {} : { resolution: binding.resolution }),
        ...(binding.rejection === undefined ? {} : { rejection: binding.rejection }),
        ...(publication === undefined ? {} : { publication }) };
    }
  }
  private scope(auth: AuthContext, purpose: "model" | "records" = "model"): { cache: RequestCache; birth: string } {
    const actor = assertActorIdentity(this.store, auth);
    if (!this.selected(auth.actor) || !(purpose === "records" ? ["actor", "principal-extension", "trusted-runner", "host"] : ["actor", "principal-extension"]).includes(auth.channel))
      throw new StoreError("CAPABILITY_DENIED", "this authenticated session did not select collaboration-v1");
    const identity = collaborationSocietyBirth(this.stateRoot, this.society, this.store.getAgent("principal"));
    // Outside every actor tree: workspace, cache/home, records and SDK sessions.
    const home = join(this.stateRoot, "host-invocations", actor.name);
    for (const name of this.store.agentNames()) assertModelScope(agentRootPathAt(this.stateRoot, name), [home]);
    ensureOwnedDurableDirectory(home, this.stateRoot, 0o700);
    return { cache: new RequestCache(home, undefined, this.metadataBytes).prepare(), birth: identity };
  }
  private io<T>(key: string, action: () => T): T {
    try { return action(); }
    catch (error) {
      if (!(error instanceof CacheError)) throw unobserved(error, "host invocation linkage") ?? error;
      if (error.code === "REQUEST_KEY_REUSED" || error.code === "INVALID_REQUEST") throw new StoreError(error.code, error.message, { cause: error });
      throw new StoreError("BROKER_UNAVAILABLE", `${error.code}: preserve original invocation ${key}; no new execution: ${error.message}`, { cause: error });
    }
  }
  /** Reconnect a missing ordinary transport cache from the already complete,
   * protected original. Never derive input from SDK arguments, caller files,
   * current defaults or an unprotected cache, and never repair conflicting or
   * unreadable local evidence. This is an authenticated cache handoff only:
   * no effect dispatch, receipt, send marker or acceptance is created here. */
  private restoreCallerFreeze(auth: AuthContext, cache: RequestCache, binding: InvocationBinding): void {
    if (binding.receipt !== null || binding.resolution !== undefined || binding.rejection !== undefined || binding.frozen === null) return;
    if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "original cache handoff cannot publish in T");
    // These are the launch owners' fixed HOME locations, never a caller path.
    const home = auth.role === "principal" ? modelWorkspacePathAt(this.stateRoot, auth.actor) : join(agentRootPathAt(this.stateRoot, auth.actor), "home");
    const local = new RequestCache(home, undefined, this.metadataBytes);
    if (local.read(binding.key).kind !== "absent") return;
    const frozen = cache.read(binding.key);
    if (frozen.kind !== "present" || frozen.value.lastReceipt !== null || !invocationFreezeMatches(binding, frozen.value))
      throw new CacheError("CACHE_CORRUPT", "original protected freeze cannot supply its exact transport cache");
    const { lastReceipt: _receipt, ...original } = frozen.value;
    if (this.hasCompletedPublication(cache, binding)) {
      // Only the original child owner establishes that Review no longer needs
      // this bundle. Preserve its exact descriptor without opening or recreating
      // bytes; this handoff does not prepare, send or accept the parent.
      local.restorePublishedSubmissionMetadata(original);
      return;
    }
    let bytes: Uint8Array | undefined;
    if (frozen.value.digest !== undefined) {
      const body = cache.readBody(binding.key, frozen.value.digest);
      if (body.kind !== "present") throw new CacheError(body.kind === "unavailable" ? "CACHE_UNAVAILABLE" : "CACHE_CORRUPT",
        "original protected body cannot supply its exact transport cache");
      bytes = body.value;
    }
    local.freeze(original, bytes);
  }
  private binding(cache: RequestCache, birth: string, auth: AuthContext, key: string): InvocationBinding {
    const found = cache.readInvocation(key);
    if (found.kind !== "present") throw new CacheError(found.kind === "unavailable" ? "CACHE_UNAVAILABLE" : "CACHE_CORRUPT",
      `original invocation is ${found.kind}`);
    if (found.value.actor !== auth.actor || found.value.societyBirth !== birth)
      throw new CacheError("CACHE_CORRUPT", "original invocation belongs to a different authenticated scope");
    return found.value;
  }
  private assertNoEffectOperation(binding: InvocationBinding): undefined {
    if (this.store.getOperation(binding.actor, binding.key) !== null ||
        ((binding.tool === "oma_merge" || binding.tool === "oma_challenge") && this.store.getOperation(binding.actor, `${binding.key}.submit`) !== null))
      throw new CacheError("CACHE_CORRUPT", "an accepted original or publication contradicts preaccept completion");
    return undefined;
  }
  /** Both model observations and ordinary record projections compare the same
   * protected acceptance with the canonical ledger. A synchronous host lookup
   * cannot regress a receipt that this host previously observed; disappearance,
   * another operation or a regressed state is corruption, not fresh absence. */
  private canonicalReceipt(binding: InvocationBinding): Receipt | null {
    const operation = this.store.getOperation(binding.actor, binding.key);
    if (operation !== null && (operation.kind !== binding.method || binding.resolution !== undefined || binding.rejection !== undefined))
      throw new StoreError("STORE_CORRUPT", "canonical operation contradicts its protected original invocation");
    const receipt = operation === null ? null : receiptOfOperation(operation);
    if (binding.receipt !== null && (receipt === null || receiptFactConflict(binding.receipt, receipt)))
      throw new StoreError("STORE_CORRUPT", "canonical receipt contradicts protected original acceptance");
    return receipt;
  }
  private observe(cache: RequestCache, binding: InvocationBinding): InvocationBinding {
    const receipt = this.canonicalReceipt(binding);
    if (binding.resolution !== undefined || binding.rejection !== undefined) {
      this.assertNoEffectOperation(binding);
      return binding;
    }
    if (receipt !== null) return cache.recordInvocationReceipt(binding.key, receipt);
    if ((binding.tool === "oma_merge" || binding.tool === "oma_challenge") && binding.frozen === null &&
        this.store.getOperation(binding.actor, `${binding.key}.submit`) !== null)
      throw new CacheError("CACHE_CORRUPT", "accepted publication lost its original completed source linkage");
    const frozen = cache.read(binding.key);
    if (frozen.kind === "present") {
      if (frozen.value.method === "attest.record" && decodeFrozenInvocationResolution(frozen.value.params).ok) return cache.resolveInvocation(binding.key);
      // Recover only linkage to already protected bytes. Never rerun a builder
      // after a crash between protected metadata publication and its checkpoint.
      if (binding.phase === "bound") return this.seal(cache, binding);
      if (!invocationFreezeMatches(binding, frozen.value))
        throw new CacheError("CACHE_CORRUPT", "original protected metadata differs from its completed source linkage");
      return binding; // Receipt observation does not reread a completed source body.
    }
    if (frozen.kind !== "absent") throw new CacheError(frozen.kind === "unavailable" ? "CACHE_UNAVAILABLE" : "CACHE_CORRUPT", "original protected freeze is not safely observable");
    if (binding.frozen !== null || binding.phase !== "bound") throw new CacheError("CACHE_CORRUPT", "original completed protected freeze disappeared; no source reconstruction permitted");
    return binding;
  }
  private reject(cache: RequestCache, binding: InvocationBinding, failure: Failure, source: InvocationRejection["source"]): InvocationBinding {
    const reason = invocationPreacceptReason(failure, binding.tool);
    if (reason === null || binding.phase !== "bound" || binding.frozen !== null) return binding;
    return cache.rejectInvocation(binding.key, { proof: "protected-invocation-closed-before-send", source, reason, failure, observedAtMs: Date.now() }, (): undefined => {
      if (this.store.inTransaction) throw new StoreError("INTERNAL_ERROR", "preaccept completion cannot publish in T");
      this.assertNoEffectOperation(binding);
      return undefined;
    });
  }
  private async origin(auth: AuthContext, origin: InvocationOrigin, tool: string, args: Json): Promise<string> {
    const root = sessionDirPathAt(this.stateRoot, auth.actor), visited = new Set<string>();
    let file = origin.file, session: string | null = origin.session, original = origin.session;
    const expected = canonicalCollaborationJson(args);
    for (;;) {
      if (basename(file) !== file || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.jsonl$/u.test(file) || visited.has(file))
        throw new StoreError("BROKER_UNAVAILABLE", "original Pi session lineage is invalid; no new execution");
      visited.add(file);
      // No history is injected into model context. This is only an actor-scoped
      // read of raw original tool-call evidence, with no migration or writes.
      const text = readUserFile(join(root, file), Number.MAX_SAFE_INTEGER);
      if (text === null) throw new StoreError("BROKER_UNAVAILABLE", "original Pi session is missing; no new execution");
      const evidence = await sessionInvocationEvidence(text, { ...origin, session }, tool, expected, canonicalCollaborationJson);
      if (!evidence.containsCall) {
        if (visited.size === 1) throw new StoreError("BROKER_UNAVAILABLE", "original call is not in this actor's Pi session; no new execution");
        return original;
      }
      original = evidence.session;
      if (evidence.parent === null) return original;
      const parentRoot = dirname(evidence.parent);
      if (parentRoot !== root && !(auth.role === "resident" && parentRoot === RESIDENT_PATHS.sessions))
        throw new StoreError("BROKER_UNAVAILABLE", "Pi parent session is outside this actor's session root; no new execution");
      file = basename(evidence.parent); session = null;
    }
  }
  async bind(auth: AuthContext, params: PublicMethods["invocation.bind"]["params"]): Promise<InvocationLink> {
    assertActorIdentity(this.store, auth);
    if (!this.selected(auth.actor) || !["actor", "principal-extension"].includes(auth.channel))
      throw new StoreError("CAPABILITY_DENIED", "this authenticated session did not select collaboration-v1");
    const problem = collaborationInputProblem(params.tool, params.arguments);
    if (problem !== null || !collaborationOmaNames(auth.role).includes(params.tool))
      throw new StoreError("INVALID_REQUEST", problem ?? "this role cannot use that collaboration action");
    let session: string;
    try { session = await this.origin(auth, params.origin, params.tool, params.arguments); }
    catch (cause) {
      if (cause instanceof StoreError) throw cause;
      throw new StoreError("BROKER_UNAVAILABLE", "original Pi invocation evidence could not be verified; no new execution", { cause });
    }
    const { cache, birth } = this.scope(auth); // Recheck identity after the SDK await.
    const identity = { societyBirth: birth, actor: auth.actor, session, branch: params.origin.branch, toolCall: params.origin.toolCall };
    const key = invocationKey(identity);
    return this.io(key, () => {
      const original = cache.readInvocation(key);
      if (original.kind === "absent") {
        if (this.store.getOperation(auth.actor, key) !== null)
          throw new CacheError("CACHE_CORRUPT", "accepted original binding disappeared; it cannot be recreated");
        if ((params.tool === "oma_merge" || params.tool === "oma_challenge") && this.store.getOperation(auth.actor, `${key}.submit`) !== null)
          throw new CacheError("CACHE_CORRUPT", "original binding disappeared beside its accepted publication; it cannot be recreated");
        if (cache.read(key).kind !== "absent")
          throw new CacheError("CACHE_CORRUPT", "original binding disappeared beside a protected freeze; it cannot be recreated");
        this.assertFreshAdmission(); // No new protected binding while operator closure is active.
      }
      const binding = cache.bindInvocation(identity, params.tool, collaborationMutationMethod(params.tool, params.arguments), params.arguments);
      if (original.kind === "absent") {
        try {
          // Bind the authenticated original before current-effect preflight. A
          // refusal may close that unprepared call, never fabricate a receipt.
          const method = collaborationMutationMethod(params.tool, params.arguments);
          if (method === "mail.send" || method === "agent.continue") assertCurrentActor(this.store, auth, "mail.send");
          if (this.sources) this.sources.validate(auth, params.tool, params.arguments, birth);
          else invocationParameters(params.tool, params.arguments, this.society, auth.role, this.subjectBytes);
          if (params.tool === "oma_spawn" && !this.sources && (!object(params.arguments) || typeof params.arguments.from !== "string" || !this.isPublished(params.arguments.from)))
            throw new StoreError("CANDIDATE_NOT_PUBLISHED", "the selected spawn source is not already published; protected source publication is required");
        } catch (error) {
          const failure = publicFailure(error);
          if (invocationPreacceptReason(failure, binding.tool) === null) throw error;
          return this.linked(cache, this.reject(cache, this.observe(cache, binding), failure, "host-preflight"));
        }
      }
      const observed = this.observe(cache, binding);
      this.restoreCallerFreeze(auth, cache, observed);
      return this.linked(cache, observed);
    });
  }
  prepare(auth: AuthContext, params: PublicMethods["invocation.prepare"]["params"], stream?: AsyncIterable<Uint8Array> | null): InvocationLink | Promise<InvocationLink> {
    const { cache, birth } = this.scope(auth);
    const current = this.io(params.key, () => this.observe(cache, this.binding(cache, birth, auth, params.key)));
    if (current.resolution !== undefined || current.rejection !== undefined || current.phase === "observed") return this.linked(cache, current);
    if (params.reject === undefined) this.assertFreshAdmission(); // No stream/source work for a fresh closed intent.
    if (params.content === undefined) {
      if (stream) throw new StoreError("STREAM_INVALID", "unexpected original invocation stream");
      if (params.reject !== undefined) return this.io(params.key, () => {
        const binding = this.observe(cache, this.binding(cache, birth, auth, params.key));
        if (binding.rejection !== undefined || binding.resolution !== undefined || binding.phase === "observed") return this.linked(cache, binding);
        return this.linked(cache, this.reject(cache, binding, params.reject, "caller-preparation"));
      });
      return this.prepareFrozen(auth, params);
    }
    const maximum = (params.content.mediaType === "application/x-git-bundle" || params.content.mediaType === "application/vnd.oma.attachments-v1") ? this.sources?.bundleBytes :
      params.content.mediaType === "application/vnd.oma.context-v1" ? this.sources?.streamBytes : undefined;
    if (!stream || maximum === undefined || params.content.bytes > maximum)
      throw new StoreError("STREAM_INVALID", "original invocation stream is missing, unsupported or exceeds its effective bound");
    // Snapshot metadata before awaiting. The connection spool owns the transport
    // copy; the original binding already owns any resulting protected freeze.
    const copied: PublicMethods["invocation.prepare"]["params"] = { contract: "collaboration-v1", key: params.key,
      params: JSON.parse(canonicalCollaborationJson(params.params)), content: { ...params.content } };
    const descriptor = { ...params.content };
    return (async () => {
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of stream) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > descriptor.bytes - received)
          throw new StoreError("STREAM_INVALID", "original invocation stream exceeds its descriptor");
        chunks.push(Buffer.from(chunk)); received += chunk.byteLength;
      }
      const bytes = Buffer.concat(chunks, received);
      if (received !== descriptor.bytes || sha256Hex(bytes) !== descriptor.sha256)
        throw new StoreError("STREAM_INVALID", "original invocation stream differs from its descriptor");
      return this.prepareFrozen(auth, copied, bytes); // Rechecks authenticated scope after await.
    })();
  }
  private prepareFrozen(auth: AuthContext, params: Extract<PublicMethods["invocation.prepare"]["params"], { params: Json }>, bytes?: Uint8Array): InvocationLink {
    const { cache, birth } = this.scope(auth);
    return this.io(params.key, () => {
      const binding = this.observe(cache, this.binding(cache, birth, auth, params.key));
      if (binding.resolution !== undefined || binding.rejection !== undefined || binding.phase === "observed") return this.linked(cache, binding);
      this.assertFreshAdmission(); // Settled originals were observed above; no source freeze/send is created.
      const submitted = decodeFrozenSubmission(params.params, binding.key);
      if (params.content !== undefined) {
        const mediaType = binding.method === "mail.send" ? "application/vnd.oma.attachments-v1" : binding.method === "agent.create" || submitted.ok ? "application/x-git-bundle" : "application/vnd.oma.context-v1";
        if (params.content.mediaType !== mediaType) throw new StoreError("STREAM_INVALID", "source stream media type differs from its original intent");
      }
      const previous = cache.read(binding.key);
      const digest = params.content === undefined ? (previous.kind === "present" ? previous.value.digest : undefined) :
        { bytes: params.content.bytes, sha256: params.content.sha256 };
      if (previous.kind === "present") {
        this.seal(cache, binding);
        if (previous.value.method !== binding.method || canonicalCollaborationJson(previous.value.params) !== canonicalCollaborationJson(params.params) ||
            canonicalCollaborationJson(previous.value.digest ?? null) !== canonicalCollaborationJson(digest ?? null))
          throw new CacheError("REQUEST_KEY_REUSED", "original frozen request cannot change");
      } else {
        if (previous.kind !== "absent" || binding.phase !== "bound")
          throw new CacheError("CACHE_CORRUPT", "completed original freeze disappeared or is unreadable; no source reconstruction permitted");
        try {
          const prepared = this.sources?.prepare(auth, binding.tool, binding.args, params.params, bytes, birth, binding.key) ?? { method: binding.method,
            params: invocationParameters(binding.tool, binding.args, this.society, auth.role, this.subjectBytes) };
          if (binding.method !== collaborationMutationMethod(binding.tool, binding.args) || prepared.method !== binding.method ||
              canonicalCollaborationJson(prepared.params) !== canonicalCollaborationJson(params.params) ||
              canonicalCollaborationJson(("digest" in prepared ? prepared.digest : undefined) ?? null) !== canonicalCollaborationJson(digest ?? null))
            throw new CacheError("REQUEST_KEY_REUSED", "frozen request does not match the original action arguments and stream");
          if (submitted.ok) assertCurrentActor(this.store, auth, "git.submit");
          // The mail owner's own routing answers an unknown address before
          // acceptance. Asked here, it closes the original before send; asked
          // only after the send marker, its definite refusal would leave a sent
          // original that no later send of this actor may pass.
          if (binding.method === "mail.send") {
            const to = (prepared.params as { to?: unknown }).to;
            if (Array.isArray(to) && to.length > 0) expandAddresses(this.store, to as Address[], this.society);
          }
          const resolution = "resolution" in prepared ? prepared.resolution : undefined;
          const frozenParams: Json = resolution === undefined ? params.params : JSON.parse(canonicalCollaborationJson({ ...JSON.parse(canonicalCollaborationJson(prepared.params)), resolution }));
          if (binding.method === "agent.create") {
            if (!this.sources?.freezeCreation) throw new StoreError("UNSUPPORTED_PROFILE", "original creation resolution owner is unavailable");
            const creation = this.sources.freezeCreation(auth, prepared.params);
            if (binding.creation !== undefined && canonicalCollaborationJson(binding.creation) !== canonicalCollaborationJson(creation))
              throw new StoreError("POLICY_CHANGED", "original frozen child spec or policy changed before source protection");
            cache.pinInvocationCreation(binding.key, creation);
          }
          cache.freezeInvocation({ key: binding.key, method: binding.method, params: frozenParams, createdAtMs: binding.createdAtMs,
            ...(digest === undefined ? {} : { digest }) }, "stream" in prepared ? prepared.stream : undefined);
          if (resolution !== undefined) return link(cache.resolveInvocation(binding.key));
        } catch (error) {
          if (error instanceof CacheError) throw error;
          const failure = publicFailure(error);
          if (invocationPreacceptReason(failure, binding.tool) === null) throw error;
          return this.linked(cache, this.reject(cache, this.observe(cache, binding), failure, "host-preflight"));
        }
      }
      for (const pending of cache.pendingInvocations()) this.observe(cache, this.binding(cache, birth, auth, pending.key));
      return this.linked(cache, binding.phase === "sending" ? binding : cache.markInvocationSending(binding.key));
    });
  }
  /** Linkage is only a guard: the existing owner still decides acceptance and current authority. */
  guardMutation(auth: AuthContext, key: string, method: InvocationBinding["method"], params: unknown): boolean {
    if (!this.selected(auth.actor) || !["actor", "principal-extension"].includes(auth.channel) || this.store.getOperation(auth.actor, key) !== null) return false;
    this.assertFreshAdmission(); // The original Store/gate still owns every actual acceptance.
    const child = method === "git.submit" && /^inv1-[a-f0-9]{64}\.submit$/u.test(key);
    const parentKey = child ? key.slice(0, -".submit".length) : key;
    if (!/^inv1-[a-f0-9]{64}$/u.test(parentKey))
      throw new StoreError("CAPABILITY_DENIED", "fresh mutations in this selected model session require their original Pi invocation");
    const { cache, birth } = this.scope(auth);
    this.io(parentKey, () => {
      const binding = this.binding(cache, birth, auth, parentKey), frozen = cache.read(parentKey);
      if (binding.phase !== "sending" || binding.frozen === null || frozen.kind !== "present")
        throw new CacheError("CACHE_CORRUPT", "fresh mutation has no matching protected original send marker");
      const compound = decodeFrozenSubmission(frozen.value.params, binding.key);
      if (child && (!compound.ok || compound.value.publication.key !== key || auth.role !== "resident"))
        throw new CacheError("CACHE_CORRUPT", "publication has no matching original submission freeze");
      const expectedMethod = child ? "git.submit" : binding.method;
      const expectedParams = compound.ok ? child ? compound.value.publication.params : compound.value.review : frozen.value.params;
      if (expectedMethod !== method || canonicalCollaborationJson(expectedParams) !== canonicalCollaborationJson(params))
        throw new CacheError("REQUEST_KEY_REUSED", "original invocation cannot change its frozen effect input");
      if (compound.ok && !child) {
        const publication = this.publication(cache, binding);
        if (publication?.receipt?.state !== "succeeded")
          throw new StoreError("BROKER_UNAVAILABLE", "original candidate publication must succeed before review acceptance");
      }
      this.seal(cache, binding);
    });
    return true;
  }
  createExpectation(auth: AuthContext, key: string): import("@oma/lifecycle/ports").CreateAcceptance {
    const { cache, birth } = this.scope(auth);
    return this.io(key, () => {
      const binding = this.binding(cache, birth, auth, key), expected = binding.creation;
      if (binding.method !== "agent.create" || expected === undefined)
        throw new StoreError("UNSUPPORTED_PROFILE", "original creation lost its frozen child spec and policy resolution");
      return (spec, policyRevision): undefined => {
        if (resolvedSpecDigest(spec) !== expected.specHash || policyRevision !== expected.policyRevision)
          throw new StoreError("POLICY_CHANGED", "original frozen child spec or policy changed before create acceptance");
        return undefined;
      };
    });
  }
  reviewExpectation(auth: AuthContext, key: string): () => undefined {
    const { cache, birth } = this.scope(auth);
    return this.io(key, () => {
      const binding = this.binding(cache, birth, auth, key);
      if (binding.method !== "attest.record" || !this.sources?.reviewGuard)
        throw new StoreError("UNSUPPORTED_PROFILE", "the exact review acceptance driver is unavailable");
      return this.sources.reviewGuard(auth, binding.tool, binding.args, birth);
    });
  }
  guardMail(auth: AuthContext, key: string, params: MailInput, requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }): boolean {
    if (!this.selected(auth.actor) || !["actor", "principal-extension"].includes(auth.channel) || this.store.getOperation(auth.actor, key) !== null) return false;
    if (requestContext !== undefined) {
      if (requestContext.kind !== "agent.continue") throw new StoreError("REQUEST_KEY_REUSED", "original mail cannot change to an alternate method");
      return this.guardMutation(auth, key, "agent.continue", requestContext.params);
    }
    return this.guardMutation(auth, key, "mail.send", params);
  }
  recordMutation(auth: AuthContext, key: string, method: InvocationBinding["method"], receipt: Receipt): void {
    if (!this.selected(auth.actor)) return;
    if (method === "git.submit" && /^inv1-[a-f0-9]{64}\.submit$/u.test(key)) {
      const { cache, birth } = this.scope(auth);
      this.io(key, () => {
        const binding = this.binding(cache, birth, auth, key.slice(0, -".submit".length));
        const observed = this.publication(cache, binding);
        if (observed?.key !== key || observed.receipt?.operation !== receipt.operation)
          throw new CacheError("CACHE_CORRUPT", "publication receipt lost its original submission relationship");
      });
      return; // The canonical Git owner retains this receipt, not the parent binding.
    }
    const { cache, birth } = this.scope(auth);
    this.io(key, () => {
      const binding = this.binding(cache, birth, auth, key);
      if (binding.method !== method) throw new CacheError("CACHE_CORRUPT", "receipt method changed");
      cache.recordInvocationReceipt(key, receipt);
    });
  }
  recordMail(auth: AuthContext, key: string, receipt: Receipt): void {
    this.recordMutation(auth, key, "mail.send", receipt);
  }
}
