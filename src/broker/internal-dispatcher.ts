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
import type { ReconcileMetrics } from "../ports/runtime.js";
import type { BoundPeer } from "./peer-authenticator.js";
import { StoreError } from "../domain/errors.js";
import { NO_HOLD, type Release, type ResourceGate } from "../domain/admission.js";
import { assertNever } from "../domain/exhaustive.js";
import { INTERNAL_METHODS, isInternalMethod } from "../protocol/methods.js";
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
  readonly reconcilePending: () => Promise<ReconcileMetrics>;
}
export interface InternalReconcilePort {
  readonly sweep: () => Promise<ReconcileMetrics>;
}
export interface InternalPeerPort {
  readonly requireRunnerUnit: (
    peer: BoundPeer,
    agent: Actor,
    invocationId?: string,
  ) => void;
  readonly requireHostUnit: (
    peer: BoundPeer,
    kind: "principal-relay" | "reconcile",
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
  readonly reconcile: InternalReconcilePort | null;
  readonly stateRoot: string;
  readonly peers: InternalPeerPort;
  isDraining(): boolean;
  assertAdmission(): void;
  /** D04: refuses what the category would consume beyond the logical limits. */
  admitResource: ResourceGate;
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  openRun(actor: Actor, invocationId: string): RunLease;
}
type ValidatedInternalCall = {
  [M in keyof InternalMethods]: {
    id: string;
    method: M;
    params: InternalMethods[M];
  };
}[keyof InternalMethods];
export class InternalDispatcher {
  private readonly observations = new Map<Actor, Readonly<{ reason: string; toolName?: string; observedAtMs: number }>>();
  constructor(private readonly deps: InternalDispatchDependencies) {}
  async dispatch(
    raw: Record<string, unknown>,
    peer: BoundPeer,
    stream: AsyncIterable<Uint8Array> | null,
    channel: "runner" | "host",
  ): Promise<object> {
    const { store, mail, peers, reconcile } = this.deps;
    const id = typeof raw.id === "string" ? raw.id : "x";
    const method = typeof raw.method === "string" ? raw.method : "";
    const paramsRaw = raw.params;
    if (
      raw.v !== 1 ||
      typeof raw.id !== "string" ||
      typeof raw.method !== "string" ||
      typeof paramsRaw !== "object" ||
      paramsRaw === null ||
      Array.isArray(paramsRaw) ||
      !Object.keys(raw).every((key) =>
        ["v", "id", "method", "params"].includes(key),
      )
    )
      return errorAnswer(id, {
        code: "INVALID_REQUEST",
        message: "invalid internal envelope",
        retry: "never",
      });
    const params = paramsRaw as Record<string, unknown>;
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
      if (
        this.deps.isDraining() ||
        (method !== "runner.pending" && method !== "runner.observe")
      )
        this.deps.assertAdmission();
      // A composite recovery pass admits each of its stages itself.
      release = descriptor.resource === "staged" ? NO_HOLD : this.deps.admitResource(descriptor.resource);
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
            this.deps.openRun(
              dispatchParams.agent,
              dispatchParams.invocationId,
            ),
          );
        }
        case "runner.pending": {
          const agent = peers.runnerActor(peer);
          peers.runnerAuth(
            agent,
            store.getAgentIdentity(agent)!.incarnation,
            peer,
          );
          return okAnswer(id, {
            pending: store.pendingDeliveryCount(agent),
            recoverableBatchIds: [...store.preparedBatchIds(agent)],
          });
        }
        case "runner.observe": {
          const agent = peers.runnerActor(peer);
          peers.runnerAuth(
            agent,
            store.getAgentIdentity(agent)!.incarnation,
            peer,
          );
          this.observations.set(agent, Object.freeze({
            reason: dispatchParams.reason,
            ...(dispatchParams.toolName === undefined ? {} : { toolName: dispatchParams.toolName }),
            observedAtMs: dispatchParams.observedAtMs,
          }));
          return okAnswer(id, { accepted: true });
        }
        case "batch.prepare": {
          const agent = peers.runnerActor(peer);
          const identity = store.getAgentIdentity(agent);
          if (!identity)
            throw new StoreError("AUTH_FAILED", "runner identity missing");
          return okAnswer(
            id,
            await mail.prepare(
              peers.runnerAuth(agent, identity.incarnation, peer),
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
        case "host.reconcile": {
          peers.requireHostUnit(peer, "reconcile");
          let report;
          if (reconcile) report = await reconcile.sweep();
          else {
            // Without the recovery owner only ordinary mail is settled.
            const settlement = this.deps.admitResource("settle");
            try { report = await mail.reconcilePending(); } finally { settlement(); }
          }
          this.deps.refreshViews();
          return okAnswer(id, report);
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
