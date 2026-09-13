// IPC-004/AUTH-003: public preflight and method dispatch; no socket or lease ownership.
import type { AuthContext, Failure, ProtocolLimits, PublicMethod, Request } from "../../implementation/contracts.js";
import type { Store } from "../store.js";
import type { MailModule } from "../mail.js";
import type { UnitsModule } from "../units.js";
import type { ViewsModule } from "../views.js";
import type { LifecycleModule } from "../lifecycle.js";
import type { GitModule } from "../git.js";
import { StoreError } from "../domain/errors.js";
import { capabilitiesOf } from "../authority.js";
import { isValidRequestKey } from "../ids.js";
import { receiptOfOperation, receiptNotFound } from "../protocol/receipts.js";
import { PUBLIC_METHODS, isPublicMethod, decodePublicParams } from "../protocol/methods.js";
import { errorAnswer, okAnswer } from "./replies.js";

export interface PublicDispatchDependencies {
  readonly store: Store; readonly mail: MailModule; readonly units: UnitsModule;
  readonly views: ViewsModule; readonly lifecycle: LifecycleModule; readonly git: GitModule | null;
  readonly limits: ProtocolLimits;
  isDraining(): boolean;
  assertAdmission(): void;
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  readLogs(agent: string, sinceSeconds: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }>;
}
type PublicValidation =
  | { ok: true; id: string; method: PublicMethod; descriptor: (typeof PUBLIC_METHODS)[PublicMethod]; params: Record<string, unknown> }
  | { ok: false; id: string; failure: Failure };

export class PublicDispatcher {
  constructor(private readonly deps: PublicDispatchDependencies) {}
  private checkParams(method: string, rawParams: unknown): Record<string, unknown> | null {
    if (!isPublicMethod(method)) return null;
    return decodePublicParams(method, rawParams, { actorNames: new Set(this.deps.store.listAgents().map(agent => agent.name)), limits: this.deps.limits }) as Record<string, unknown> | null;
  }
  private readAuthority(auth: AuthContext): { actor: ReturnType<Store["getAgent"]>; failure: Failure | null } {
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
    return { ok: true, id, method, descriptor, params };
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
    const validation = this.validatePublicRequest(auth, request as unknown as Record<string, unknown>, "dispatch", Boolean(stream));
    if (!validation.ok) return errorAnswer(validation.id, validation.failure);
    const { id, method, descriptor, params } = validation;
    try {
      switch (method) {
        case "status.get": {
          const observe = (agent: string) => { const value = units.observe(agent); return { activeState: value.activeState, subState: value.subState, result: value.result, execMainStatus: value.execMainStatus }; };
          const agents = views.status((params as { agent?: string }).agent, observe);
          return okAnswer(id, { observedAtMs: Date.now(), agents });
        }
        case "operation.get": {
          const operation = store.getOperation(auth.actor, (params as { key: string }).key);
          return okAnswer(id, operation ? receiptOfOperation(operation) : receiptNotFound);
        }
        case "mail.send": {
          const input = params as unknown as import("../../implementation/contracts.js").MailInput;
          if (input.approvalFor && !store.getOperation(auth.actor, keyOf(request)) && !git?.isPublished(input.approvalFor.candidate)) throw new StoreError("CANDIDATE_NOT_PUBLISHED", "approval request requires a published candidate");
          return okAnswer(id, await mail.send(auth, keyOf(request), input));
        }
        case "mail.ack": return okAnswer(id, lifecycle.ack(auth, (params as { message: string }).message, keyOf(request)));
        case "route.follow": return okAnswer(id, lifecycle.follow(auth, (params as { topic: string }).topic, true, keyOf(request)));
        case "route.unfollow": return okAnswer(id, lifecycle.follow(auth, (params as { topic: string }).topic, false, keyOf(request)));
        case "agent.start": return okAnswer(id, lifecycle.start(auth, (params as { agent: string }).agent, keyOf(request)));
        case "agent.stop": return okAnswer(id, lifecycle.stop(auth, (params as { agent: string }).agent, keyOf(request)));
        case "agent.create": return okAnswer(id, await lifecycle.create(auth, params as never, keyOf(request)));
        case "agent.continue": return okAnswer(id, await mail.send(auth, keyOf(request), { to: [auth.actor], subject: "continue", kind: "message", body: (params as { note: string }).note }, { kind: "agent.continue", params: { note: (params as { note: string }).note } }));
        case "agent.wait": return okAnswer(id, { accepted: true });
        case "git.known": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const refs = git.knownRefs();
          return okAnswer(id, { hasCandidate: refs.published.includes((params as { candidate: string }).candidate), prerequisites: [...refs.published] });
        }
        case "git.submit": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          return okAnswer(id, await git.submit(auth, keyOf(request), params as never, stream ?? emptyStream()));
        }
        case "git.integrate": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "git module unavailable");
          const input = params as { candidate: string; expected: string };
          return okAnswer(id, await git.integrate(auth, keyOf(request), { candidate: input.candidate, expected: input.expected }));
        }
        case "context.publish": {
          if (!git) throw new StoreError("SPIKE_UNRESOLVED", "context module unavailable");
          return okAnswer(id, await git.publishContext(auth, keyOf(request), params as never, stream ?? emptyStream()));
        }
        case "logs.read": { const input = params as { agent: string; sinceSeconds: number }; return okAnswer(id, await this.deps.readLogs(input.agent, input.sinceSeconds)); }
        default: return errorAnswer(id, { code: "UNKNOWN_METHOD", message: `unhandled method ${method}`, retry: "never" });
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
