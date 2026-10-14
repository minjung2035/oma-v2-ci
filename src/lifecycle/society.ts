/** DR27 / LIFE-006: society execution is distinct from each Resident's desired
 * state. Acceptance closes activation first; physical death is proved before
 * a close receipt or reopening. History is never replayed as current intent. */
import type { AuthContext, Receipt } from "../../implementation/contracts.js";
import { Store, reused } from "../store.js";
import { StoreError, acceptedFailure, errorCodeOf } from "../domain/errors.js";
import { assertCurrentActor, resolvedSpecOf } from "../authority.js";
import { generateOperationId } from "../ids.js";
import { requestHash } from "../hash.js";
import { decodeMutationPayload } from "../protocol/request-codec.js";
import { receiptOfOperation } from "../storage/receipt-projector.js";
import type { OperationOf } from "../storage/operation-codec.js";
import type { UnitsModule } from "../units.js";

/** Every Resident's path is disabled, even if its service is already dead.
 * Otherwise a queued mail/path activation can outlive an observed empty cgroup. */
export function quiesceResidents(store: Store, units: UnitsModule): void {
  const failures: unknown[] = [];
  for (const agent of store.listAgents()) {
    if (agent.role !== "resident") continue;
    try {
      units.stop(agent.name, agent.incarnation);
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
  constructor(private readonly store: Store, private readonly units: UnitsModule) {}
  private requirePrincipal(auth: AuthContext): void {
    assertCurrentActor(this.store, auth, "agent.manage.descendants");
    if (auth.actor !== "principal" || auth.role !== "principal")
      throw new StoreError("CAPABILITY_DENIED", "only the Principal can open or close the society");
  }
  set(auth: AuthContext, state: "open" | "closed", key: string): Receipt {
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
        this.reconcile(previous, () => this.requirePrincipal(auth));
        return this.receipt(previous.id);
      } catch (error) { throw acceptedFailure(error); }
    }
    const wasOpen = this.store.societyOpen();
    const id = generateOperationId();
    const accepted = this.store.transaction(tx => {
      this.requirePrincipal(auth);
      return tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: hash, kind: "society.set",
        payloadJson: JSON.stringify(payload), planJson: JSON.stringify({ kind: "society.set", ...payload }) });
    });
    if (accepted === "retry") return receiptOfOperation(this.store.retriedOperation(auth.actor, key));
    try {
      this.apply(id, state, wasOpen && state === "open", () => this.requirePrincipal(auth));
      return this.receipt(id);
    } catch (error) { throw acceptedFailure(error); }
  }
  reconcileById(id: string): void {
    const operation = this.store.operations.getById(id);
    if (!operation || operation.kind !== "society.set") throw new StoreError("STORE_CORRUPT", "society recovery identity changed");
    this.reconcile(operation);
  }
  reconcile(operation: OperationOf<"society.set">, liveAuthority?: () => void): void {
    if (operation.state !== "pending" && operation.state !== "unknown") return;
    if (this.store.operations.latestSociety()?.id !== operation.id) {
      this.store.transaction(tx => tx.setOperationUnknown(operation.id)); return;
    }
    this.apply(operation.id, operation.plan.state, false, liveAuthority);
  }
  private requireOpeningAuthority(): void {
    const principal = this.store.getAgent("principal");
    if (!principal || principal.role !== "principal") throw new StoreError("STORE_CORRUPT", "society Principal is missing");
    const spec = resolvedSpecOf(principal);
    if (principal.desired !== "enabled" || !spec.capabilities.includes("agent.manage.descendants"))
      throw new StoreError("CAPABILITY_DENIED", "Principal cannot reopen society execution now");
  }
  private apply(id: string, state: "open" | "closed", alreadyOpen: boolean, liveAuthority?: () => void): void {
    try {
      // Pending open is fenced too: an unconfirmed close cannot be bypassed by
      // another key. Reopening re-proves quiescence before releasing activation.
      if (!alreadyOpen) quiesceResidents(this.store, this.units);
      this.store.transaction(tx => {
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
    const operation = this.store.operations.getById(id);
    if (!operation) throw new StoreError("STORE_CORRUPT", "accepted society action is missing");
    return receiptOfOperation(operation);
  }
}
