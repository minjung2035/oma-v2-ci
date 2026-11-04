import { StoreError } from "@oma/domain/errors";

// Process-lifetime accounting only: no new queue, sidecar, worker DB or daemon.
// Completed tasks are removed. An executor whose last run did not reach a
// complete observation stays in `unprovenPreparations` -- the shutdown
// barrier's evidence that descendant quiescence was never proven -- until its
// owner re-observes the prepared state quiescent (reverifyStale), which is
// the authoritative startup recovery in this process's lifetime.
export interface PreparationPlacement { placementFd: number; close(): void }
let placementFactory: (() => PreparationPlacement | undefined) | undefined;
/** Installed by one broker lifetime, never inferred from inherited environment. */
export function configurePreparationPlacement(factory: () => PreparationPlacement | undefined): () => void {
  if (placementFactory !== undefined) throw new StoreError("INTERNAL_ERROR", "preparation workload owner is already configured");
  placementFactory = factory;
  return () => { if (placementFactory === factory) placementFactory = undefined; };
}
export function acquirePreparationPlacement(): PreparationPlacement | undefined { return placementFactory?.(); }
export const nativeClosures = new Set<Promise<void>>();
/** A direct execution owner resolves only after its independent scope proof
 * and cleanup. A rejected closure stays a shutdown fence for this process. */
export function retainNativeExecution(closure: Promise<void>): void {
  nativeClosures.add(closure);
  void closure.then(() => nativeClosures.delete(closure), () => { /* retain the failed ownership proof */ });
}
export const unprovenPreparations = new Set<object>();
export async function preparationShutdownBarrier(): Promise<void> {
  if (unprovenPreparations.size > 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation quiescence is unproven; retain writer resources for process termination");
  while (nativeClosures.size > 0) {
    await Promise.all([...nativeClosures]);
    if (unprovenPreparations.size > 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native preparation became uncertain during shutdown");
  }
}

