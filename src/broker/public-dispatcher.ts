// IPC-004/AUTH-003: public preflight and method dispatch; no socket or lease ownership.
import type { AuthContext, ProtocolLimits, Request } from "../../implementation/contracts.js";
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
export class PublicDispatcher {
  constructor(private readonly deps: PublicDispatchDependencies) {}
  private checkParams(method: string, rawParams: unknown): Record<string, unknown> | null {
    if (!isPublicMethod(method)) return null;
    return decodePublicParams(method, rawParams, { actorNames: new Set(this.deps.store.listAgents().map(agent => agent.name)), limits: this.deps.limits }) as Record<string, unknown> | null;
  }
  preflight(auth: AuthContext, envelope: Record<string, unknown>): void {
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" || !Object.keys(envelope).every(key => ["v", "id", "method", "params", "request"].includes(key))) throw new StoreError("INVALID_REQUEST", "invalid request envelope");
    if (envelope.v !== 1) throw new StoreError("UNSUPPORTED_VERSION", "unsupported protocol version");
    if (!isPublicMethod(method) || PUBLIC_METHODS[method].stream === "none") throw new StoreError("INVALID_REQUEST", "method does not accept a stream body");
    const descriptor = PUBLIC_METHODS[method];
    if (descriptor.key === "required" && !isValidRequestKey(envelope.request)) throw new StoreError("INVALID_REQUEST", "mutation requires a request key");
    const actor = this.deps.store.getAgent(auth.actor);
    if (auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")) throw new StoreError("STALE_RUN", "actor incarnation is stale");
    const need = descriptor.capability;
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) throw new StoreError("CAPABILITY_DENIED", `missing capability ${need}`);
    if (!this.checkParams(method, envelope.params)) throw new StoreError("INVALID_REQUEST", `invalid params for ${method}`);
    this.deps.assertAdmission();
  }
  async dispatch(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    try { return await this.dispatchChecked(auth, request, stream); }
    catch (error) { return this.deps.failureAnswer(typeof request.id === "string" ? request.id : "x", error); }
  }
  private async dispatchChecked(auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null): Promise<object> {
    const { store, mail, units, views, lifecycle, git } = this.deps;
    const envelope = request as unknown as Record<string, unknown>;
    const id = typeof envelope.id === "string" ? envelope.id : "x";
    const method = typeof envelope.method === "string" ? envelope.method : "";
    if (typeof envelope.id !== "string" || typeof envelope.method !== "string" || !Object.keys(envelope).every(key => ["v", "id", "method", "params", "request"].includes(key))) return errorAnswer(id, { code: "INVALID_REQUEST", message: "invalid request envelope", retry: "never" });
    const actor = store.getAgent(auth.actor);
    if (auth.channel === "actor" && (actor?.incarnation !== auth.incarnation || actor.desired !== "enabled")) return errorAnswer(id, { code: "STALE_RUN", message: "actor incarnation is stale", retry: "never" });
    if (envelope.v !== 1) return errorAnswer(id, { code: "UNSUPPORTED_VERSION", message: "unsupported protocol version", retry: "never" });
    if (!isPublicMethod(method)) return errorAnswer(id, { code: "UNKNOWN_METHOD", message: `unknown method ${method}`, retry: "never" });
    const descriptor = PUBLIC_METHODS[method];
    if (descriptor.key === "required" && !isValidRequestKey(envelope.request)) return errorAnswer(id, { code: "INVALID_REQUEST", message: "mutation requires a valid request key", retry: "never" });
    if (descriptor.key === "forbidden" && Object.prototype.hasOwnProperty.call(envelope, "request")) return errorAnswer(id, { code: "INVALID_REQUEST", message: "read/ephemeral requests forbid a top-level request key", retry: "never" });
    const need = descriptor.capability;
    if (need && (!auth.capabilities.has(need) || !actor || !capabilitiesOf(actor).has(need))) return errorAnswer(id, { code: "CAPABILITY_DENIED", message: `missing capability ${need}`, retry: "never" });
    const params = this.checkParams(method, envelope.params);
    if (!params) return errorAnswer(id, { code: "INVALID_REQUEST", message: `invalid params for ${method}`, retry: "never" });
    if (stream && (descriptor.stream === "none" || (descriptor.stream === "optional-bundle" && !Object.hasOwn(params, "bundle")))) return errorAnswer(id, { code: "INVALID_REQUEST", message: "method does not accept this stream body", retry: "never" });
    if (this.deps.isDraining() || descriptor.mode === "mutation") this.deps.assertAdmission();
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
