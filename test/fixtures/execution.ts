/** Policy-only feature fixture. It owns no OS execution and cannot issue a
 * scope pin, authorize a peer, launch a Resident or qualify any native gate.
 * Actual scope/Resident tests use the production backend in native-*.test.mjs.
 */
import type { Actor, ExecutionObservation } from "@oma/contracts";
import type { ExecutionScopePin } from "@oma/contracts/runtime";
import type { BrokerExecution } from "#oma-test/app/broker/broker-composition";
import type { LifecycleExecution } from "#oma-test/app/broker/lifecycle-composition";
import type { ReconcileUnits } from "@oma/reconcile/ports";
import { StoreError } from "@oma/domain/errors";
export type FeatureExecution = BrokerExecution & LifecycleExecution & ReconcileUnits;
export class PolicyExecution implements FeatureExecution {
  private incarnation: (actor: Actor) => number | null = () => null;
  private revoke: ((actor: Actor) => void) | undefined;
  bindIncarnationReader(reader: (actor: Actor) => number | null): void { this.incarnation = reader; }
  bindRunRevoker(revoke: (actor: Actor) => void): void { this.revoke = revoke; }
  revokeRun(actor: Actor): void { this.revoke?.(actor); }
  assertResidentNamesFree(_actor: Actor): void {}
  ensureResident(_actor: Actor, profile: string, modelProfile: string): void {
    if (!profile || !modelProfile) throw new StoreError("STORE_CORRUPT", "policy fixture requires explicit frozen references");
  }
  observe(_actor: Actor): ExecutionObservation {
    return { activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, invocationId: "", scope: "" };
  }
  observeAsync(actor: Actor): Promise<ExecutionObservation> { return Promise.resolve(this.observe(actor)); }
  observeStatus(actors: readonly Actor[]): Promise<ReadonlyMap<Actor, ExecutionObservation | "no-unit">> {
    return Promise.resolve(new Map(actors.map(actor => [actor, this.observe(actor)])));
  }
  confirmDead(actor: Actor, incarnation: number): boolean {
    const current = this.incarnation(actor);
    return current !== null && Number.isSafeInteger(incarnation) && incarnation >= 0 && incarnation <= current &&
      this.observe(actor).activeState === "inactive";
  }
  start(_actor: Actor, _repair: boolean, _authorize?: () => void): void | Promise<void> {
    throw new StoreError("UNSUPPORTED_PROFILE", "this policy fixture owns no native launch");
  }
  stop(actor: Actor, incarnation: number): ExecutionObservation | Promise<ExecutionObservation> {
    if (!this.confirmDead(actor, incarnation)) throw new StoreError("RUN_TERMINATION_UNKNOWN", "policy fixture has no death observation for this incarnation");
    return this.observe(actor);
  }
  startLimitStatus(_actor: Actor): string | null { return null; }
  scopeRoot(_actor: Actor): { pid: number; startTime: string } | null { return null; }
  runnerAlive(_actor: Actor): boolean { return false; }
  pin(_scope: string): ExecutionScopePin { throw new StoreError("AUTH_FAILED", "policy fixture owns no kernel scope"); }
  readLogs(_actor: Actor, _since: number, _limit: number): Promise<{ text: string; truncated: boolean; observedAtMs: number }> {
    return Promise.reject(new StoreError("UNSUPPORTED_PROFILE", "policy fixture owns no operational logs"));
  }
}
