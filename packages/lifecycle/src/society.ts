import type { LifecycleEffects } from "./ports.js";
import { encodeOperationPlan } from "@oma/protocol/operation-codec";
/** DR27 / LIFE-006: society execution is distinct from each Resident's desired
 * state. Acceptance closes activation first; physical death is proved before
 * a close receipt or reopening. History is never replayed as current intent. */
import type { AuthContext, Receipt } from "@oma/contracts";
import type { LifecycleLedger } from "./ports.js";
import { reused } from "@oma/domain/request-identity";
import { StoreError, acceptedFailure, errorCodeOf } from "@oma/domain/errors";
import { assertCurrentActor } from "@oma/domain/authority";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { requestHash } from "@oma/domain/request-identity";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import type { OperationOf } from "@oma/protocol/operation-codec";
import type { LifecycleUnits } from "./ports.js";

/** Every Resident's path is disabled, even if its service is already dead.
 * Otherwise a queued mail wake can outlive an observed empty execution scope. */
export async function quiesceResidents(store: Pick<LifecycleLedger, "listAgents">, units: Pick<LifecycleUnits, "stop" | "confirmDead">): Promise<void> {
  const failures: unknown[] = [];
  for (const agent of store.listAgents()) {
    if (agent.role !== "resident") continue;
    try {
      await units.stop(agent.name, agent.incarnation);
      if (!units.confirmDead(agent.name, agent.incarnation))
        throw new StoreError("RUN_TERMINATION_UNKNOWN", `cannot prove ${agent.name} terminated`);
    } catch (error) { failures.push(error); }
  }
  if (failures.length === 0) return;
  const primary = failures.find(error => errorCodeOf(error) === "STORE_CORRUPT") ?? failures[0];
  if (failures.length === 1) throw primary;
  throw new StoreError(errorCodeOf(primary), "cannot confirm every Resident stopped",
    { cause: new AggregateError(failures, "society quiescence failed") });
}

export class SocietyControl {
  constructor(private readonly store: LifecycleLedger, private readonly units: Pick<LifecycleUnits, "stop" | "confirmDead">, private readonly effects: Pick<LifecycleEffects, "nextOperationId">) {}
  private requirePrincipal(auth: AuthContext): void {
    assertCurrentActor(this.store, auth, "agent.manage.descendants");
    if (auth.actor !== "principal" || auth.role !== "principal")
      throw new StoreError("CAPABILITY_DENIED", "only the Principal can open or close the society");
  }
  async set(auth: AuthContext, state: "open" | "closed", key: string): Promise<Receipt> {
    this.requirePrincipal(auth);
    let payload: { state: "open" | "closed" };
    try { payload = decodeMutationPayload("society.set", { state }); }
    catch { throw new StoreError("INVALID_REQUEST", "invalid society state"); }
    const hash = requestHash("society.set", payload);
    const claim = this.store.claimKey(auth.actor, key, hash);
    if (claim === "reused") throw reused(auth.actor, key);
    if (claim === "retry") {
      const previous = this.store.retriedOperation(auth.actor, key);
      if (previous.kind !== "society.set") throw new StoreError("STORE_CORRUPT", "society request changed kind");
      try {
        await this.reconcile(previous, () => this.requirePrincipal(auth));
        return this.receipt(previous.id);
      } catch (error) { throw acceptedFailure(error); }
    }
    const wasOpen = this.store.societyOpen();
    const id = this.effects.nextOperationId();
    const accepted = this.store.transaction(tx => {
      this.requirePrincipal(auth);
      return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "society.set",
        payloadJson: JSON.stringify(payload), planJson: encodeOperationPlan({ kind: "society.set", ...payload }) });
    });
    if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    try {
      await this.apply(id, state, wasOpen && state === "open", () => this.requirePrincipal(auth));
      return this.receipt(id);
    } catch (error) { throw acceptedFailure(error); }
  }
  async reconcileById(id: string): Promise<void> {
    const operation = this.store.getOperationById(id);
    if (!operation || operation.kind !== "society.set") throw new StoreError("STORE_CORRUPT", "society recovery identity changed");
    await this.reconcile(operation);
  }
  async reconcile(operation: OperationOf<"society.set">, liveAuthority?: () => void): Promise<void> {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    if (this.store.latestSocietyAction()?.id !== operation.id) {
      this.store.transaction(tx => tx.setOperationUnknown(operation.id)); return;
    }
    await this.apply(operation.id, operation.plan.state, false, liveAuthority);
  }
  private requireOpeningAuthority(): void {
    const principal = this.store.getAgent("principal");
    if (!principal || principal.role !== "principal") throw new StoreError("STORE_CORRUPT", "society Principal is missing");
    const spec = resolvedSpecOf(principal);
    if (principal.desired !== "enabled" || !spec.capabilities.includes("agent.manage.descendants"))
      throw new StoreError("CAPABILITY_DENIED", "Principal cannot reopen society execution now");
  }
  private async apply(id: string, state: "open" | "closed", alreadyOpen: boolean, liveAuthority?: () => void): Promise<void> {
    try {
      // Pending open is fenced too: an unconfirmed close cannot be bypassed by
      // another key. Reopening re-proves quiescence before releasing activation.
      if (!alreadyOpen) await quiesceResidents(this.store, this.units);
      this.store.transaction(tx => {
        if (this.store.latestSocietyAction()?.id !== id)
          throw new StoreError("STALE_RUN", "society intent changed while executions were stopping");
        // Reopening is a new permission to execute, not settlement of a past
        // physical effect. A recovered close still finishes its accepted fence.
        if (state === "open") { this.requireOpeningAuthority(); liveAuthority?.(); }
        tx.setOperationSucceeded(id, JSON.stringify({ kind: "society.set", state }));
      });
    } catch (error) {
      if (errorCodeOf(error) === "STORE_CORRUPT") throw error;
      this.store.transaction(tx => tx.setOperationUnknown(id));
    }
  }
  private receipt(id: string): Receipt {
    const operation = this.store.getOperationById(id);
    if (!operation) throw new StoreError("STORE_CORRUPT", "accepted society action is missing");
    return receiptOfOperation(operation);
  }
}
