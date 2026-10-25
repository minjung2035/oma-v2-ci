/** Shared start/stop ordering. Lifecycle still owns desired/incarnation and
 * accepted intent. Backends perform narrow effects and provide independent
 * scope death proof; neither command completion nor status creates that proof. */
import type { ExecutionObservation } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";

export interface ResidentExecutionBackend<Observation extends ExecutionObservation> {
  assertStartOwner(actor: string): void;
  observe(actor: string): Observation;
  repairStartFailure(actor: string): void;
  enableWake(actor: string): void;
  launch(actor: string, authorize: () => void): void | Promise<void>;
  disableWake(actor: string): void;
  revoke(actor: string): void;
  terminate(actor: string): void | Promise<void>;
  verifyWakeDisabled(actor: string): void;
  confirmDead(actor: string, incarnation: number): boolean;
}

export class ResidentSupervisor<Observation extends ExecutionObservation> {
  constructor(private readonly backend: ResidentExecutionBackend<Observation>) {}

  async start(actor: string, explicitRepair: boolean, authorize: () => void = () => {}): Promise<void> {
    const backend = this.backend;
    backend.assertStartOwner(actor);
    const before = backend.observe(actor);
    if (explicitRepair && before.activeState === "failed") backend.repairStartFailure(actor);
    backend.enableWake(actor);
    try { await backend.launch(actor, authorize); }
    catch (error) {
      // A fresh explicit result may explain a completed refusal. It cannot
      // settle a command whose outcome is still unknown.
      if (error instanceof StoreError && error.code === "INTERNAL_ERROR" && this.startLimitStatus(actor) !== null)
        throw new StoreError("START_LIMIT", `start limit reached for ${actor}`, { cause: error });
      throw error;
    }
    const after = backend.observe(actor);
    const endedNewInvocation = before.activeState !== "unknown" && after.activeState === "inactive" &&
      after.result === "success" && after.execMainStatus === 0 && /^[0-9a-f]{32}$/.test(after.invocationId) &&
      after.invocationId !== before.invocationId;
    if (!["active", "activating"].includes(after.activeState) && !endedNewInvocation)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `execution activation not observed for ${actor}`);
  }

  async stop(actor: string, incarnation: number): Promise<Observation> {
    const backend = this.backend, failures: unknown[] = [];
    // The lifecycle has committed stop intent. Disable hints first, revoke
    // endpoint/provider authority, then terminate and independently prove all
    // descendants ended. Every attempted cleanup retains its own failure.
    for (const action of [() => backend.disableWake(actor), () => backend.revoke(actor),
      () => backend.terminate(actor), () => backend.verifyWakeDisabled(actor)]) {
      try { await action(); } catch (error) { failures.push(error); }
    }
    let observation: Observation | undefined;
    try { observation = backend.observe(actor); } catch (error) { failures.push(error); }
    let dead = false;
    try { dead = backend.confirmDead(actor, incarnation); } catch (error) { failures.push(error); }
    if (!dead || observation === undefined || failures.length > 0)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `execution stop or descendant death not confirmed for ${actor}`,
        failures.length === 0 ? undefined : { cause: new AggregateError(failures, "execution stop observations failed") });
    return observation;
  }

  startLimitStatus(actor: string): string | null {
    const observed = this.backend.observe(actor);
    return observed.activeState === "failed" && observed.result === "start-limit-hit" ? "start_limit" : null;
  }
}
