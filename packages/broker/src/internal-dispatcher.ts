// IPC/AUTH: fixed internal channel dispatch. The peer owner supplies current identity proof.
import type {
  Actor,
  AuthContext,
  BoundaryEvidence,
  RunLease,
  InternalMethods,
  PreparedBatch,
} from "@oma/contracts";
import type { BoundPeer } from "./ports.js";
import { StoreError } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import { INTERNAL_METHODS, internalEnvelopeProblem, isInternalMethod } from "@oma/protocol/methods";
import { errorAnswer, okAnswer } from "./replies.js";

import type { InternalStorePort, InternalMailPort, InternalPeerPort, InternalDispatchDependencies, InternalAdmission } from "./ports.js";

/** The Broker projects its own live peer authenticator into dispatch capabilities. */
export function projectInternalPeers(peers: InternalPeerPort): InternalPeerPort {
  return {
    requireRunnerPeer: (peer, agent, invocationId) => peers.requireRunnerPeer(peer, agent, invocationId),
    runnerActor: peer => peers.runnerActor(peer),
    runnerAuth: (agent, incarnation, peer) => peers.runnerAuth(agent, incarnation, peer),
  };
}
/** P0V-57, P0-2: the admission an internal method takes, whichever endpoint
 * serves it -- the runner channel here, or the Principal host's endpoint for
 * the same `batch.prepare` and `batch.complete`. Only a runner's own pending
 * and observation reads pass a store fenced after corruption. */
export function assertInternalAdmission(method: keyof InternalMethods, admission: InternalAdmission): void {
  if (admission.isDraining() || (method !== "runner.pending" && method !== "runner.observe"))
    admission.assertAdmission();
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

import type { RunnerObservation } from "@oma/contracts/runtime";

export class InternalDispatcher {
  private readonly observations = new Map<Actor, RunnerObservation>();
  constructor(private readonly deps: InternalDispatchDependencies) {}
  /** The latest diagnostic a runner volunteered, tagged with the run it was
   * authenticated under. The status view is the consumer; it is display
   * data, not evidence a lifecycle or admission decision may rest on. */
  runnerObservation(agent: Actor): RunnerObservation | null {
    return this.observations.get(agent) ?? null;
  }
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
      assertInternalAdmission(method, this.deps);
      // SAFETY: params passed this method's descriptor check; retain the correlation erased by dynamic indexing.
      const call = { id, method, params } as ValidatedInternalCall;
      const { method: dispatchMethod, params: dispatchParams } = call;
      switch (dispatchMethod) {
        case "runner.open": {
          peers.requireRunnerPeer(
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
          const identity = runnerIdentity(store, agent);
          peers.runnerAuth(agent, identity.incarnation, peer);
          this.observations.set(agent, Object.freeze({
            // The run an observation belongs to is the one the caller was
            // authenticated as -- the wire payload cannot claim another.
            incarnation: identity.incarnation,
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
          peers.requireRunnerPeer(peer, agent);
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
    }
  }
}
