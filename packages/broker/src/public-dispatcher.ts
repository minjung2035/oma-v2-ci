// IPC-004/AUTH-003: public preflight and method dispatch; no socket or lease ownership.
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { AuthContext, Failure, ProtocolLimits, PublicMethod, PublicMethods, Request, RequestKey, Actor, AgentCreateInput, Oid, MessageId, MailInput, Receipt, Json, AgentStatus } from "@oma/contracts";
import type { StatusSnapshot } from "@oma/contracts/runtime";
import { StoreError, publicDetails } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import { capabilitiesOf } from "@oma/domain/authority";
import { isValidRequestKey } from "@oma/domain/identifiers";
import { receiptNotFound } from "@oma/protocol/receipts";
import { PUBLIC_METHODS, isPublicMethod, decodePublicParams, principalRequestAllowed, UNBOUNDED_PUBLIC_LIMITS } from "@oma/protocol/methods";
import { errorAnswer, okAnswer } from "./replies.js";
import { statusPage } from "@oma/protocol/status-page";
import { receiptChunk } from "@oma/protocol/receipt-chunks";
import { boundedLogResponse } from "@oma/protocol/log-response";


import type { PublicAgentView, PublicStorePort, PublicMailPort, PublicUnitsPort, PublicViewsPort, PublicLifecyclePort, PublicReviewPort, PublicGitPort, PublicDispatchDependencies } from "./ports.js";

type ValidatedPublicCall = {
  [M in PublicMethod]: { ok: true; id: string; method: M; descriptor: (typeof PUBLIC_METHODS)[M]; params: PublicMethods[M]["params"] }
}[PublicMethod];
type PublicValidation = ValidatedPublicCall | { ok: false; id: string; failure: Failure };

export class PublicDispatcher {
  constructor(private readonly deps: PublicDispatchDependencies) {}
  private checkParams<M extends PublicMethod>(method: M, rawParams: unknown): PublicMethods[M]["params"] | null {
    return decodePublicParams(method, rawParams, { limits: this.deps.limits });
  }
  /** Whether the ledger holds a minted terminal receipt under this key --
   * the only rows whose replay is a read. A decode failure on the durable
   * row is corruption and is answered as STORE_CORRUPT, not silently fenced. */
  private terminalReceiptHeld(actor: Actor, key: RequestKey): boolean {
    const receipt = this.deps.store.getReceipt(actor, key);
    return receipt !== null && (receipt.state === "succeeded" || receipt.state === "failed");
  }
  private readAuthority(auth: AuthContext): { actor: PublicAgentView | null; failure: Failure | null } {
    const actor = this.deps.store.getAgent(auth.actor);
    const stale = auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled");
    return { actor, failure: stale ? { code: "STALE_RUN", message: "actor incarnation is stale", retry: "never" } : null };
  }
  /** Share rules, never a retained authorization result. Every call reads current authority.
   * The phase selects the existing error precedence and admission/stream policy.
   */
  private validatePublicRequest(auth: AuthContext, envelope: Record<string, unknown>, phase: "stream-preflight" | "dispatch", hasStream: boolean): PublicValidation {
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    const fail = (code: Failure["code"], message: string, details?: Readonly<Record<string, unknown>>): PublicValidation => {
      // DR3: an authored validation sentence, and only the facts its code may carry.
      const facts = details === undefined ? undefined : publicDetails(code, details);
      return { ok: false, id, failure: { code, message, retry: "never", ...(facts === undefined ? {} : { details: facts }) } };
    };
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" || !Object.keys(envelope).every(key => ["v", "id", "method", "params", "request"].includes(key))) return fail("INVALID_REQUEST", "invalid request envelope");
    // Dispatch historically fences stale actors before version/method errors.
    // Stream preflight rejects invalid metadata before querying current authority.
    const earlyAuthority = phase === "dispatch" ? this.readAuthority(auth) : null;
    if (earlyAuthority?.failure) return { ok: false, id, failure: earlyAuthority.failure };
    if (envelope.v !== 1) return fail("UNSUPPORTED_VERSION", "unsupported protocol version");
    if (!isPublicMethod(method)) return phase === "stream-preflight"
      ? fail("INVALID_REQUEST", "method does not accept a stream body") : fail("UNKNOWN_METHOD", `unknown method ${method}`);
    const descriptor = PUBLIC_METHODS[method];
    if (phase === "stream-preflight" && descriptor.stream === "none") return fail("INVALID_REQUEST", "method does not accept a stream body");
    if (descriptor.key === "required" && !isValidRequestKey(envelope.request)) return fail("INVALID_REQUEST",
      phase === "stream-preflight" ? "mutation requires a request key" : "mutation requires a valid request key");
    if (descriptor.key === "forbidden" && Object.prototype.hasOwnProperty.call(envelope, "request")) return fail("INVALID_REQUEST", "read/ephemeral requests forbid a top-level request key");
    const authority = earlyAuthority ?? this.readAuthority(auth);
    if (authority.failure) return { ok: false, id, failure: authority.failure };
    const need = descriptor.capability, actor = authority.actor;
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) return fail("CAPABILITY_DENIED", `missing capability ${need}`, { capability: need });
    let params = this.checkParams(method, envelope.params);
    if (params === null && descriptor.key === "required") {
      // Live limits bound only new work. The wire's limit checks must not
      // re-judge a durable accepted fact: a same-key request the ledger holds
      // is classified by grammar alone and answered by the owning claim -- the
      // recorded receipt for a true replay, REQUEST_KEY_REUSED for a different
      // payload under that key. Malformed params stay refused before the
      // ledger is read at all, and read/ephemeral methods have no such lookup.
      const grammar = decodePublicParams(method, envelope.params, { limits: UNBOUNDED_PUBLIC_LIMITS });
      if (grammar !== null && this.deps.store.hasOperation(auth.actor, envelope.request as RequestKey))
        params = grammar;
    }
    if (params === null) return fail("INVALID_REQUEST", `invalid params for ${method}`);
    if (auth.role === "principal" && auth.channel === "actor" && !principalRequestAllowed(method, params))
      return fail("CAPABILITY_DENIED", "the Principal delegates routine work to Workers");
    if (hasStream && (descriptor.stream === "none" || (descriptor.stream === "optional-bundle" && !Object.hasOwn(params, "bundle")))) return fail("INVALID_REQUEST", "method does not accept this stream body");
    if (phase === "stream-preflight" || this.deps.isDraining() || descriptor.mode === "mutation") {
      try { this.deps.assertAdmission(); }
      catch (error) {
        // P0: a replay of an already-minted terminal receipt is a read, not a
        // new claim. When the fence refuses but the ledger holds a
        // succeeded/failed row for this actor's key, the owning method answers
        // the recorded receipt (same payload) or REQUEST_KEY_REUSED (a
        // different payload) -- neither mints acceptance. Pending and unknown
        // rows are not minted receipts and keep the refusal. The lookup is a
        // durable read, safe without admission-held resources, and runs only
        // once the fence actually fired: a healthy mutation never inspects
        // the operation ledger (P11).
        if (!(descriptor.key === "required" && descriptor.mode === "mutation" &&
          isValidRequestKey(envelope.request) && this.terminalReceiptHeld(auth.actor, envelope.request))) throw error;
      }
    }
    // SAFETY: this method's decoder validated params; TS cannot express that dynamic key/union correlation.
    return { ok: true, id, method, descriptor, params } as ValidatedPublicCall;
  }
  preflight(auth: AuthContext, envelope: Record<string, unknown>): void {
    const validation = this.validatePublicRequest(auth, envelope, "stream-preflight", true);
    if (!validation.ok) throw new StoreError(validation.failure.code, validation.failure.message);
  }
  async dispatch(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    try { return await this.dispatchChecked(auth, request, stream); }
    catch (error) { return this.deps.failureAnswer(typeof request.id === "string" ? request.id : "x", error); }
  }
  private async dispatchChecked(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    const { store, mail, units, views, lifecycle, git } = this.deps;
    // SAFETY: expose only raw envelope fields to validation; this cast grants no schema or authority fact.
    const validation = this.validatePublicRequest(auth, request as unknown as Record<string, unknown>, "dispatch", Boolean(stream));
    if (!validation.ok) return errorAnswer(validation.id, validation.failure);
    const { id, method, descriptor, params } = validation;
    try {
      switch (method) {
        case "status.get": {
          // A named agent is an address like the one logs.read checks: absent
          // is an error, not an empty list (NB-20).
          if (params.agent !== undefined && this.deps.store.getAgent(params.agent) === null)
            throw new StoreError("ADDRESS_NOT_FOUND", `agent ${params.agent} does not exist in this society`);
          // WP23: observed off the event loop by the shared refresh; the
          // registry rows and pending counts are read after it, current.
          const snapshot = await units.statusSnapshot();
          if (this.deps.isDraining()) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
          const agents = await views.status(params.agent, snapshot);
          if (this.deps.isDraining()) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
          const current = this.validatePublicRequest(auth, request as unknown as Record<string, unknown>, "dispatch", false);
          if (!current.ok) return errorAnswer(current.id, current.failure);
          return statusPage(id, snapshot.observedAtMs, agents, this.deps.limits.frameBytes, params.after);
        }
        case "operation.read":
          return receiptChunk(id, store.getReceipt(auth.actor, params.key) ?? receiptNotFound, params, this.deps.limits.frameBytes);
        case "operation.get": {
          const receipt = store.getReceipt(auth.actor, params.key);
          return okAnswer(id, receipt ?? receiptNotFound);
        }
        case "society.set": {
          if (!lifecycle.setSociety) throw new StoreError("UNSUPPORTED_PROFILE", "society control owner unavailable");
          return okAnswer(id, await lifecycle.setSociety(auth, params.state, keyOf(request)));
        }
        case "mail.send": {
          if (params.approvalFor) {
            const hasOperation = store.hasOperation(auth.actor, keyOf(request));
            if (!hasOperation && !git?.isPublished(params.approvalFor.candidate)) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "approval request requires a published candidate");
          }
          return okAnswer(id, await mail.send(auth, keyOf(request), params));
        }
        case "attest.record": {
          if (!this.deps.review) throw new StoreError("UNSUPPORTED_PROFILE", "tiered attestation owner is unavailable");
          return okAnswer(id, await this.deps.review.record(auth, keyOf(request), params));
        }
        case "mail.ack": return okAnswer(id, lifecycle.ack(auth, params.message, keyOf(request)));
        case "route.follow": return okAnswer(id, lifecycle.follow(auth, params.topic, true, keyOf(request)));
        case "route.unfollow": return okAnswer(id, lifecycle.follow(auth, params.topic, false, keyOf(request)));
        case "agent.start": return okAnswer(id, await lifecycle.start(auth, params.agent, keyOf(request)));
        case "agent.stop": return okAnswer(id, await lifecycle.stop(auth, params.agent, keyOf(request)));
        case "agent.create": return okAnswer(id, await lifecycle.create(auth, params, keyOf(request)));
        case "agent.continue": return okAnswer(id, await mail.send(auth, keyOf(request), { to: [auth.actor], subject: "continue", kind: "message", body: params.note }, { kind: "agent.continue", params: { note: params.note } }));
        case "agent.wait": return okAnswer(id, { accepted: this.deps.waitRun(auth, params.observe === true) });
        case "git.known": {
          if (!git) throw new StoreError("UNSUPPORTED_PROFILE", "git module unavailable");
          const refs = git.knownRefs();
          const known = [...new Set([refs.main, ...refs.published])];
          // A bounded subset, main first (the contract says so): a bundle built on
          // fewer prerequisites is still complete, only larger.
          const result = { hasCandidate: known.includes(params.candidate), prerequisites: [] as Oid[] };
          let bytes = Buffer.byteLength(JSON.stringify(okAnswer(id, result)));
          for (const oid of known) {
            const extra = Buffer.byteLength(JSON.stringify(oid)) + (result.prerequisites.length ? 1 : 0);
            if (bytes + extra > this.deps.limits.frameBytes) break;
            result.prerequisites.push(oid); bytes += extra;
          }
          return okAnswer(id, result);
        }
        case "git.submit": {
          if (!git) throw new StoreError("UNSUPPORTED_PROFILE", "git module unavailable");
          return okAnswer(id, await git.submit(auth, keyOf(request), params, stream ?? emptyStream()));
        }
        case "git.integrate": {
          if (!git) throw new StoreError("UNSUPPORTED_PROFILE", "git module unavailable");
          return okAnswer(id, await git.integrate(auth, keyOf(request), params));
        }
        case "context.publish": {
          if (!git) throw new StoreError("UNSUPPORTED_PROFILE", "context module unavailable");
          return okAnswer(id, await git.publishContext(auth, keyOf(request), params, stream ?? emptyStream()));
        }
        case "review.status": {
          if (!this.deps.review) throw new StoreError("UNSUPPORTED_PROFILE", "review status owner is unavailable");
          return okAnswer(id, this.deps.review.status(auth, params.name, this.deps.limits.frameBytes, id));
        }
        case "logs.read": {
          if (this.deps.store.getAgent(params.agent) === null)
            throw new StoreError("ADDRESS_NOT_FOUND", `agent ${params.agent} does not exist in this society`);
          return boundedLogResponse(id, await this.deps.readLogs(params.agent, params.sinceSeconds), this.deps.limits.frameBytes);
        }
        default: return assertNever(method);
      }
    } catch (error) { return this.deps.failureAnswer(id, error); }
    finally {
      if (descriptor.mode === "mutation") {
        this.deps.refreshViews();
        // NATIVE-021: completed writes must let timers and other admitted work run.
        // The accepted result is already fixed; this turn grants no new authority.
        await yieldToEventLoop();
      }
    }
  }
}
function emptyStream(): AsyncIterable<Uint8Array> { return (async function* () {})(); }
function keyOf(request: { request?: string }): string {
  if (!isValidRequestKey(request.request)) throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
  return request.request;
}
