import type { Store } from "@oma/storage";
import type { BatchViewLimits } from "@oma/protocol/batch-view";
import { captureLedger, assertAcceptedHistory, type LedgerSnapshot, type InvariantPhase } from "./store.js";
import { assertMail } from "./mail.js";
import { assertGit, type GitInvariantPaths } from "./git.js";
import { assertBatches } from "./batches.js";
import { assertLifecycle, type LifecycleFacts } from "./lifecycle.js";
export { captureLedger, assertAcceptedHistory } from "./store.js";
export type { LedgerSnapshot, InvariantPhase } from "./store.js";

export interface GlobalInvariantContext {
  readonly phase: InvariantPhase;
  readonly stateRoot: string;
  readonly society: string;
  readonly viewLimits: BatchViewLimits;
  readonly git?: GitInvariantPaths;
  readonly lifecycle?: LifecycleFacts;
  readonly before?: LedgerSnapshot;
}
/** Invoke only at a quiescent scenario checkpoint. No repair callbacks, mutable
 * Store capabilities, reconciliation or generated evidence are accepted.
 * Incomplete observations are returned explicitly, not counted as completion.
 */
export function assertGlobalInvariants(store: Store, context: GlobalInvariantContext): {
  readonly ledger: LedgerSnapshot; readonly incomplete: readonly string[];
} {
  const ledger = captureLedger(store);
  if (context.before) assertAcceptedHistory(context.before, ledger);
  const incomplete = [
    ...assertMail(ledger, store, context.stateRoot, context.society, context.phase),
    ...assertBatches(ledger, context.stateRoot, context.phase, context.viewLimits),
    ...assertLifecycle(ledger, context.stateRoot, context.phase, context.lifecycle),
    ...(context.git ? assertGit(ledger, context.git, context.phase) : []),
  ];
  return Object.freeze({ ledger, incomplete: Object.freeze(incomplete) });
}
