// IPC-004/AUTH-003: public preflight and method dispatch; no socket or lease ownership.
import type { AuthContext, Failure, ProtocolLimits, PublicMethod, PublicMethods, Request, RequestKey, Actor, AgentCreateInput, Oid, MessageId, MailInput, Receipt, Json, AgentStatus } from "../../implementation/contracts.js";
import type { UnitObserve } from "../ports/runtime.js";
import { StoreError } from "../domain/errors.js";
import { assertNever } from "../domain/exhaustive.js";
import type { ResourceGate } from "../domain/admission.js";
import { capabilitiesOf } from "../authority.js";
import { isValidRequestKey } from "../ids.js";
import { receiptNotFound } from "../protocol/receipts.js";
import { PUBLIC_METHODS, isPublicMethod, decodePublicParams } from "../protocol/methods.js";
import { errorAnswer, okAnswer } from "./replies.js";
import { boundedLogResponse } from "../protocol/log-response.js";


export interface PublicAgentView {
  readonly name: Actor;
  readonly incarnation: number;
  readonly desired: AgentStatus["desired"];
  readonly specJson: string;
}
export interface PublicStorePort {
  readonly listAgents: () => readonly { readonly name: Actor }[];
  readonly getAgent: (actor: Actor) => PublicAgentView | null;
  readonly getReceipt: (actor: Actor, key: RequestKey) => Receipt | null;
  readonly hasOperation: (actor: Actor, key: RequestKey) => boolean;
}
export interface PublicMailPort {
  readonly send: (auth: AuthContext, key: RequestKey, input: MailInput, requestContext?: { kind: "mail.send" | "agent.continue"; params: Json }) => Promise<Receipt>;
}
export interface PublicUnitsPort {
  readonly observe: (agent: Actor) => NonNullable<ReturnType<UnitObserve>>;
}
export interface PublicViewsPort {
  readonly status: (agent: Actor | undefined, observe: UnitObserve) => AgentStatus[];
}
export interface PublicLifecyclePort {
  readonly create: (auth: AuthContext, input: AgentCreateInput, key: RequestKey) => Promise<Receipt>;
  readonly start: (auth: AuthContext, agent: Actor, key: RequestKey) => Receipt;
  readonly stop: (auth: AuthContext, agent: Actor, key: RequestKey) => Receipt;
  readonly ack: (auth: AuthContext, message: MessageId, key: RequestKey) => Receipt;
  readonly follow: (auth: AuthContext, topic: string, subscribe: boolean, key: RequestKey) => Receipt;
}
export interface PublicGitPort {
  readonly knownRefs: () => { main: string; published: string[] };
  readonly isPublished: (oid: Oid) => boolean;
  readonly submit: (auth: AuthContext, key: RequestKey, input: PublicMethods["git.submit"]["params"], bytes: AsyncIterable<Uint8Array>) => Promise<Receipt>;
  readonly integrate: (auth: AuthContext, key: RequestKey, input: { candidate: Oid; expected: Oid }) => Promise<Receipt>;
  readonly publishContext: (auth: AuthContext, key: RequestKey, input: PublicMethods["context.publish"]["params"], bytes: AsyncIterable<Uint8Array>) => Promise<Receipt>;
}
export interface PublicDispatchDependencies {
  readonly store: PublicStorePort;
  readonly mail: PublicMailPort;
  readonly units: PublicUnitsPort;
  readonly views: PublicViewsPort;
  readonly lifecycle: PublicLifecyclePort;
  readonly git: PublicGitPort | null;
  readonly limits: ProtocolLimits;
  isDraining(): boolean;
  assertAdmission(): void;
  /** D04: refuses what the category would consume beyond the logical limits. */
  admitResource: ResourceGate;
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
}
type ValidatedPublicCall = {
  [M in PublicMethod]: { ok: true; id: string; method: M; descriptor: (typeof PUBLIC_METHODS)[M]; params: PublicMethods[M]["params"] }
}[PublicMethod];
type PublicValidation = ValidatedPublicCall | { ok: false; id: string; failure: Failure };

export class PublicDispatcher {
  constructor(private readonly deps: PublicDispatchDependencies) {}
  private checkParams<M extends PublicMethod>(method: M, rawParams: unknown): PublicMethods[M]["params"] | null {
    return decodePublicParams(method, rawParams, { actorNames: new Set(this.deps.store.listAgents().map(agent => agent.name)), limits: this.deps.limits });
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
    const fail = (code: Failure["code"], message: string): PublicValidation => ({ ok: false, id, failure: { code, message, retry: "never" } });
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
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) return fail("CAPABILITY_DENIED", `missing capability ${need}`);
    const params = this.checkParams(method, envelope.params);
    if (!params) return fail("INVALID_REQUEST", `invalid params for ${method}`);
    if (hasStream && (descriptor.stream === "none" || (descriptor.stream === "optional-bundle" && !Object.hasOwn(params, "bundle")))) return fail("INVALID_REQUEST", "method does not accept this stream body");
    if (phase === "stream-preflight" || this.deps.isDraining() || descriptor.mode === "mutation") this.deps.assertAdmission();
    // Resources are judged once the action is known. Stream bytes are reserved by transport.
    if (phase === "dispatch") {
      try { this.deps.admitResource(descriptor.resource); }
      catch (error) {
        // An accepted same-key lookup is not new consumption; the ledger is read only when refused.
        if (!(descriptor.key === "required" && isValidRequestKey(envelope.request) &&
          this.deps.store.hasOperation(auth.actor, envelope.request))) throw error;
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
          const observe = (agent: string) => { const value = units.observe(agent); return { activeState: value.activeState, subState: value.subState, result: value.result, execMainStatus: value.execMainStatus }; };
          const agents = views.status(params.agent, observe);
          return okAnswer(id, { observedAtMs: Date.now(), agents });
        }
        case "operation.get": {
          const receipt = store.getReceipt(auth.actor, params.key);
          return okAnswer(id, receipt ?? receiptNotFound);
        }
        case "mail.send": {
          if (params.approvalFor) {
            const hasOperation = store.hasOperation(auth.actor, keyOf(request));
            if (!hasOperation && !git?.isPublished(params.approvalFor.candidate)) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "approval request requires a published candidate");
          }
          return okAnswer(id, await mail.send(auth, keyOf(request), params));
        }
        case "mail.ack": return okAnswer(id, lifecycle.ack(auth, params.message, keyOf(request)));
        case "route.follow": return okAnswer(id, lifecycle.follow(auth, params.topic, true, keyOf(request)));
        case "route.unfollow": return okAnswer(id, lifecycle.follow(auth, params.topic, false, keyOf(request)));
        case "agent.start": return okAnswer(id, lifecycle.start(auth, params.agent, keyOf(request)));
        case "agent.stop": return okAnswer(id, lifecycle.stop(auth, params.agent, keyOf(request)));
        case "agent.create": return okAnswer(id, await lifecycle.create(auth, params, keyOf(request)));
        case "agent.continue": return okAnswer(id, await mail.send(auth, keyOf(request), { to: [auth.actor], subject: "continue", kind: "message", body: params.note }, { kind: "agent.continue", params: { note: params.note } }));
        case "agent.wait": return okAnswer(id, { accepted: true });
        case "git.known": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const refs = git.knownRefs();
          const known = [...new Set([refs.main, ...refs.published])];
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
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          return okAnswer(id, await git.submit(auth, keyOf(request), params, stream ?? emptyStream()));
        }
        case "git.integrate": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          return okAnswer(id, await git.integrate(auth, keyOf(request), params));
        }
        case "context.publish": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "context module unavailable");
          return okAnswer(id, await git.publishContext(auth, keyOf(request), params, stream ?? emptyStream()));
        }
        case "logs.read": return boundedLogResponse(id, await this.deps.readLogs(params.agent, params.sinceSeconds), this.deps.limits.frameBytes);
        default: return assertNever(method);
      }
    } catch (error) { return this.deps.failureAnswer(id, error); }
    finally { if (descriptor.mode === "mutation") this.deps.refreshViews(); }
  }
}
function emptyStream(): AsyncIterable<Uint8Array> { return (async function* () {})(); }
function keyOf(request: { request?: string }): string {
  if (!isValidRequestKey(request.request)) throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
  return request.request;
}
