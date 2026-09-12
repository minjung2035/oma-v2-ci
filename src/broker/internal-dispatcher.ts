// IPC/AUTH: fixed internal channel dispatch. The peer owner supplies current identity proof.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Actor, BoundaryEvidence, RunLease } from "../../implementation/contracts.js";
import type { Store } from "../store.js";
import type { MailModule } from "../mail.js";
import type { ReconcileModule } from "../reconcile.js";
import { StoreError } from "../domain/errors.js";
import { INTERNAL_METHODS, isInternalMethod } from "../protocol/methods.js";
import type { BoundPeer, PeerAuthenticator } from "./peer-authenticator.js";
import { errorAnswer, okAnswer } from "./replies.js";

export interface InternalDispatchDependencies {
  readonly store: Store; readonly mail: MailModule; readonly reconcile: ReconcileModule | null;
  readonly stateRoot: string;
  readonly peers: Pick<PeerAuthenticator, "requireRunnerUnit" | "requireHostUnit" | "runnerActor" | "runnerAuth">;
  isDraining(): boolean;
  assertAdmission(): void;
  failureAnswer(id: string, error: unknown): object;
  refreshViews(): void;
  openRun(actor: Actor, invocationId: string): RunLease;
}
export class InternalDispatcher {
  constructor(private readonly deps: InternalDispatchDependencies) {}
  async dispatch(raw: Record<string, unknown>, peer: BoundPeer, stream: AsyncIterable<Uint8Array> | null, channel: "runner" | "host"): Promise<object> {
    const { store, mail, peers, reconcile } = this.deps;
    const id = typeof raw.id === "string" ? raw.id : "x"; const method = typeof raw.method === "string" ? raw.method : "";
    const paramsRaw = raw.params;
    if (raw.v !== 1 || typeof raw.id !== "string" || typeof raw.method !== "string" || typeof paramsRaw !== "object" || paramsRaw === null || Array.isArray(paramsRaw) || !Object.keys(raw).every(key => ["v", "id", "method", "params"].includes(key))) return errorAnswer(id, { code: "INVALID_REQUEST", message: "invalid internal envelope", retry: "never" });
    const params = paramsRaw as Record<string, unknown>;
    try {
      if (!isInternalMethod(method)) throw new StoreError("UNKNOWN_METHOD", `internal ${method}`);
      const descriptor = INTERNAL_METHODS[method];
      if (descriptor.channel !== channel) throw new StoreError("AUTH_FAILED", `method ${method} is not allowed on ${channel} channel`);
      if (stream) throw new StoreError("INVALID_REQUEST", "internal methods do not accept stream bodies");
      const invalid = descriptor.paramsCheck(params);
      if (invalid) throw new StoreError("INVALID_REQUEST", `${method}: ${invalid}`);
      if (this.deps.isDraining() || (method !== "runner.pending" && method !== "runner.observe")) this.deps.assertAdmission();
      switch (method) {
        case "runner.open": {
          const input = params as { agent: string; invocationId: string };
          peers.requireRunnerUnit(peer, input.agent, input.invocationId); return okAnswer(id, this.deps.openRun(input.agent, input.invocationId));
        }
        case "runner.pending": {
          const agent = peers.runnerActor(peer); peers.runnerAuth(agent, store.getAgent(agent)!.incarnation, peer);
          return okAnswer(id, { pending: store.pendingDeliveries(agent).length, recoverableBatchIds: store.preparedBatches(agent).map(batch => batch.id) });
        }
        case "runner.observe": {
          const agent = peers.runnerActor(peer); peers.runnerAuth(agent, store.getAgent(agent)!.incarnation, peer);
          throw new StoreError("SPIKE_UNRESOLVED", "S-03 observation adapter is not pinned");
        }
        case "batch.prepare": {
          const agent = peers.runnerActor(peer); const row = store.getAgent(agent);
          if (!row) throw new StoreError("AUTH_FAILED", "runner identity missing");
          return okAnswer(id, await mail.prepare(peers.runnerAuth(agent, row.incarnation, peer)));
        }
        case "batch.complete": {
          const evidence = params as unknown as BoundaryEvidence; const batch = store.getBatch(evidence.batchId);
          if (!batch) throw new StoreError("BATCH_CONFLICT", `unknown batch ${evidence.batchId}`);
          const agent = batch.agent; peers.requireRunnerUnit(peer, agent); const row = store.getAgent(agent);
          if (!row || row.incarnation !== evidence.incarnation) throw new StoreError("BATCH_CONFLICT", "runner incarnation mismatch");
          await mail.complete(peers.runnerAuth(agent, row.incarnation, peer), evidence); return okAnswer(id, { completed: true });
        }
        case "host.principalRelay": {
          peers.requireHostUnit(peer, "principal-relay"); const principal = store.getAgent("principal");
          if (!principal) return okAnswer(id, { moved: 0, pending: 0 });
          const newFiles = readdirSync(join(this.deps.stateRoot, "mail", "inboxes", "principal", "new"));
          return okAnswer(id, { moved: mail.moveToCur("principal", newFiles), pending: store.pendingDeliveries("principal").length });
        }
        case "host.reconcile": {
          peers.requireHostUnit(peer, "reconcile"); const report = reconcile ? await reconcile.sweep() : await mail.reconcilePending();
          this.deps.refreshViews(); return okAnswer(id, report);
        }
        default: return errorAnswer(id, { code: "UNKNOWN_METHOD", message: `internal ${method}`, retry: "never" });
      }
    } catch (error) { return this.deps.failureAnswer(id, error); }
  }
}
