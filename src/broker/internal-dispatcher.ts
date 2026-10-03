// IPC/AUTH: fixed internal channel dispatch. The peer owner supplies current identity proof.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Actor,
  AuthContext,
  BoundaryEvidence,
  RunLease,
  InternalMethods,
  PreparedBatch,
} from "../../implementation/contracts.js";
import type { BoundPeer } from "./peer-authenticator.js";
import { StoreError } from "../domain/errors.js";
import { NO_HOLD, type Release, type ResourceGate } from "../domain/admission.js";
import { assertNever } from "../domain/exhaustive.js";
import { INTERNAL_METHODS, internalEnvelopeProblem, isInternalMethod } from "../protocol/methods.js";
import { errorAnswer, okAnswer } from "./replies.js";

export interface InternalStorePort {
  readonly getAgentIdentity: (
    actor: Actor,
  ) => { readonly incarnation: number } | null;
  readonly pendingDeliveryCount: (agent: Actor) => number;
  readonly getBatchAgent: (id: string) => Actor | null;
  readonly preparedBatchIds: (agent: Actor) => readonly string[];
}
export interface InternalMailPort {
  readonly prepare: (auth: AuthContext) => Promise<PreparedBatch | null>;
  readonly complete: (
    auth: AuthContext,
    evidence: BoundaryEvidence,
  ) => Promise<void>;
  readonly moveToCur: (agent: Actor, ids: readonly string[]) => number;
}
export interface InternalPeerPort {
  readonly requireRunnerUnit: (
    peer: BoundPeer,
    agent: Actor,
    invocationId?: string,
  ) => void;
  readonly requireHostUnit: (
    peer: BoundPeer,
    kind: "principal-relay",
  ) => void;
  readonly runnerActor: (peer: BoundPeer) => Actor;
  readonly runnerAuth: (
    agent: Actor,
    incarnation: number,
    peer: BoundPeer,
  ) => AuthContext;
}
export interface InternalDispatchDependencies {
  readonly store: InternalStorePort;
  readonly mail: InternalMailPort;
  readonly stateRoot: string;
  readonly peers: InternalPeerPort;
  isDraining(): boolean;
  assertAdmission(): void;
  /** D04: refuses what the category would consume beyond the logical limits. */
  admitResource: ResourceGate;
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  openRun(actor: Actor, invocationId: string): Promise<RunLease>;
}
/** What admitting an internal method needs from the broker. */
export type InternalAdmission = Pick<InternalDispatchDependencies, "isDraining" | "assertAdmission" | "admitResource">;
/** P0V-57, P0-2: the admission an internal method takes, whichever endpoint
 * serves it -- the runner channel here, or the Principal host's endpoint for
 * the same `batch.prepare` and `batch.complete`. Only a runner's own pending
 * and observation reads pass a store fenced after corruption. */
export function admitInternal(method: keyof InternalMethods, admission: InternalAdmission): Release {
  if (admission.isDraining() || (method !== "runner.pending" && method !== "runner.observe"))
    admission.assertAdmission();
  const resource = INTERNAL_METHODS[method].resource;
  return admission.admitResource(resource);
}
type ValidatedInternalCall = {
  [M in keyof InternalMethods]: {
    id: string;
    method: M;
    params: InternalMethods[M];
  };
}[keyof InternalMethods];
/** P0V-92 (R6-15): the runner a request comes from, as the ledger knows it.
 * A runner is authenticated from a unit and a row that exist, and no code
 * removes an agent row, so a missing one is the ledger no longer saying who
 * the runner is -- refused by name rather than assumed away. */
function runnerIdentity(store: InternalStorePort, agent: Actor): { readonly incarnation: number } {
  const identity = store.getAgentIdentity(agent);
  if (identity === null) throw new StoreError("AUTH_FAILED", "runner identity missing");
  return identity;
}

export class InternalDispatcher {
  private readonly observations = new Map<Actor, Readonly<{ reason: string; toolName?: string; observedAtMs: number }>>();
  constructor(private readonly deps: InternalDispatchDependencies) {}
  async dispatch(
    raw: Record<string, unknown>,
    peer: BoundPeer,
    stream: AsyncIterable<Uint8Array> | null,
    channel: "runner" | "host",
  ): Promise<object> {
    const { store, mail, peers } = this.deps;
    const id = typeof raw.id === "string" ? raw.id : "x";
    const method = typeof raw.method === "string" ? raw.method : "";
    const problem = internalEnvelopeProblem(raw);
    if (problem !== null)
      return errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: problem,
        retry: "never",
      });
    const params = raw.params as Record<string, unknown>;
    let release: Release = NO_HOLD;
    try {
      if (!isInternalMethod(method))
        throw new StoreError("UNKNOWN_METHOD", `internal ${method}`);
      const descriptor = INTERNAL_METHODS[method];
      if (descriptor.channel !== channel)
        throw new StoreError(
          "AUTH_FAILED",
          `method ${method} is not allowed on ${channel} channel`,
        );
      if (stream)
        throw new StoreError(
          "INVALID_REQUEST",
          "internal methods do not accept stream bodies",
        );
      const invalid = descriptor.paramsCheck(params);
      if (invalid)
        throw new StoreError("INVALID_REQUEST", `${method}: ${invalid}`);
      release = admitInternal(method, this.deps);
      // SAFETY: params passed this method's descriptor check; retain the correlation erased by dynamic indexing.
      const call = { id, method, params } as ValidatedInternalCall;
      const { method: dispatchMethod, params: dispatchParams } = call;
      switch (dispatchMethod) {
        case "runner.open": {
          peers.requireRunnerUnit(
            peer,
            dispatchParams.agent,
            dispatchParams.invocationId,
          );
          return okAnswer(
            id,
            await this.deps.openRun(
              dispatchParams.agent,
              dispatchParams.invocationId,
            ),
          );
        }
        case "runner.pending": {
          const agent = peers.runnerActor(peer);
          peers.runnerAuth(agent, runnerIdentity(store, agent).incarnation, peer);
          return okAnswer(id, {
            pending: store.pendingDeliveryCount(agent),
            recoverableBatchIds: [...store.preparedBatchIds(agent)],
          });
        }
        case "runner.observe": {
          const agent = peers.runnerActor(peer);
          peers.runnerAuth(agent, runnerIdentity(store, agent).incarnation, peer);
          this.observations.set(agent, Object.freeze({
            reason: dispatchParams.reason,
            ...(dispatchParams.toolName === undefined ? {} : { toolName: dispatchParams.toolName }),
            observedAtMs: dispatchParams.observedAtMs,
          }));
          return okAnswer(id, { accepted: true });
        }
        case "batch.prepare": {
          const agent = peers.runnerActor(peer);
          return okAnswer(
            id,
            await mail.prepare(
              peers.runnerAuth(agent, runnerIdentity(store, agent).incarnation, peer),
            ),
          );
        }
        case "batch.complete": {
          const evidence = dispatchParams;
          const agent = store.getBatchAgent(evidence.batchId);
          if (!agent)
            throw new StoreError(
              "BATCH_CONFLICT",
              `unknown batch ${evidence.batchId}`,
            );
          peers.requireRunnerUnit(peer, agent);
          const identity = store.getAgentIdentity(agent);
          if (!identity || identity.incarnation !== evidence.incarnation)
            throw new StoreError(
              "BATCH_CONFLICT",
              "runner incarnation mismatch",
            );
          await mail.complete(
            peers.runnerAuth(agent, identity.incarnation, peer),
            evidence,
          );
          return okAnswer(id, { completed: true });
        }
        case "host.principalRelay": {
          peers.requireHostUnit(peer, "principal-relay");
          const principal = store.getAgentIdentity("principal");
          if (!principal) return okAnswer(id, { moved: 0, pending: 0 });
          const newFiles = readdirSync(
            join(this.deps.stateRoot, "mail", "inboxes", "principal", "new"),
          );
          return okAnswer(id, {
            moved: mail.moveToCur("principal", newFiles),
            pending: store.pendingDeliveryCount("principal"),
          });
        }
        case "batch.read":
        case "principal.attach":
        case "principal.detach":
          throw new StoreError(
            "AUTH_FAILED",
            `method ${dispatchMethod} is not available on broker channel`,
          );
        default:
          return assertNever(dispatchMethod);
      }
    } catch (error) {
      return this.deps.failureAnswer(id, error);
    } finally { release(); }
  }
}
