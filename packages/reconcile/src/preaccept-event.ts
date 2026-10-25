import type { PreacceptCollection } from "@oma/contracts/runtime";
/** The most kept entries the reconcile.preaccept event names: enough to tell
 * an operator what was kept and why, bounded so a residue storm stays one
 * manageable event line. */
export const PREACCEPT_EVENT_KEPT_LIMIT = 8;
/** The event startup prints when the collection found anything: the counts,
 * and the first kept names (relative to the state root) with their reasons. */
export function preacceptEvent(collection: PreacceptCollection, stateRoot: string):
    { event: "reconcile.preaccept"; removed: number; kept: number; keptEntries: { path: string; reason: string }[] } | null {
  if (collection.removed.length === 0 && collection.kept.length === 0) return null;
  return { event: "reconcile.preaccept", removed: collection.removed.length, kept: collection.kept.length,
    keptEntries: collection.kept.slice(0, PREACCEPT_EVENT_KEPT_LIMIT)
      .map(entry => ({ path: entry.path.slice(stateRoot.length + 1), reason: entry.reason })) };
}
