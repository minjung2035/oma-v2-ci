/** Reacquires physical coalition observations and fresh member controls.
 * Persisted PID/labels/tokens never become signal authority. The shared
 * coordinator owns iteration, unknown retention and journal retirement. */
import { StoreError } from "@oma/domain/errors";
import type { ExecutionWitness } from "@oma/process/execution-witness";
import type { RecoveryScope } from "@oma/process/owned-execution";
import { identifyDarwinCoalition, observeDarwinCoalitionPopulation, darwinCoalitionMemberHints,
  signalDarwinCoalitionMember, type DarwinCoalitionIdentity } from "@oma/native/audit-session";

type Observation = { readonly kind: "running"; readonly identity: DarwinCoalitionIdentity } |
  { readonly kind: "exited" | "unavailable" };
function unavailable(): never {
  throw new StoreError("RUN_TERMINATION_UNKNOWN", "Darwin recovery has no fresh physical coalition observation");
}
function snapshot(witness: ExecutionWitness): DarwinCoalitionIdentity | null {
  if (witness.kind !== "darwin-resource-coalition") return null;
  return Object.freeze({ kind: witness.kind, bootId: witness.bootId, coalitionId: witness.coalitionId });
}
/** A readable legacy record remains unavailable: it lacks a boot binding.
 * This observation never grants a role or proves one saved PID is alive. */
export function observeDarwinJobScope(witness: ExecutionWitness): Observation {
  if (process.platform !== "darwin") return { kind: "unavailable" };
  try {
    const identity = snapshot(witness); if (identity === null) return { kind: "unavailable" };
    const own = identifyDarwinCoalition(process.pid);
    if (own === null || own.bootId === identity.bootId && own.coalitionId === identity.coalitionId)
      return { kind: "unavailable" };
    const population = observeDarwinCoalitionPopulation(identity);
    return population === "populated" ? { kind: "running", identity } :
      { kind: population === "empty" ? "exited" : "unavailable" };
  } catch { return { kind: "unavailable" }; }
}
export function acquireDarwinJobScope(witness: ExecutionWitness): RecoveryScope<DarwinCoalitionIdentity> {
  const observed = observeDarwinJobScope(witness); if (observed.kind !== "running") unavailable();
  const identity = observed.identity; let closed = false;
  return Object.freeze({ identity,
    population: () => closed ? "unknown" : observeDarwinCoalitionPopulation(identity),
    terminate() {
      if (closed) unavailable();
      const population = observeDarwinCoalitionPopulation(identity);
      if (population === "unknown") unavailable();
      if (population === "empty") return;
      const failures: unknown[] = [];
      // Enumeration is hints only. Each actual signal reacquires a full
      // kernel token + generation and rechecks this boot/CID before control.
      for (const pid of darwinCoalitionMemberHints(identity))
        try { signalDarwinCoalitionMember(identity, pid); } catch (error) { failures.push(error); }
      if (failures.length) throw new StoreError("RUN_TERMINATION_UNKNOWN", "Darwin recovery member control is unconfirmed",
        { cause: new AggregateError(failures) });
    },
    close() { closed = true; },
  });
}
