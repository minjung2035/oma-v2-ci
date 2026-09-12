/** DB-005/009: result construction follows validated immutable intent, not a
 * fresh argument/config read. Terminal result_json is never rewritten here.
 */
import type { ResultFor } from "../durable.js";
import type { ValidatedPlan } from "../storage/operation-codec.js";

export function integrationResult(plan: ValidatedPlan<"git.integrate">): ResultFor<"git.integrate"> {
  // The durable decoder has checked every legacy result/plan relation already.
  // Preserve that intent's original property order when settling an old pending row.
  if (plan.result !== undefined) return plan.result;
  return {
    kind: "git.integrate", base: plan.base, candidate: plan.candidate,
    target: plan.target, policyRevision: plan.policyRevision,
    changed: plan.base !== plan.candidate,
  };
}
