/** Actual canonical health I/O and its complete process/tree lease lifetime. */
import { StoreError } from "@oma/domain/errors";
import { repositoryHealthCommand, requireHealthyRepository } from "./repository-health.js";
import { PreparationExecutor } from "@oma/process/preparation";
import { TreeLease, treeQuiescence } from "@oma/storage/tree-lease";
import { removeOwnedFile } from "@oma/storage/directory";
export class CanonicalHealthObserver {
  private readonly healthExecutor = new PreparationExecutor();
  private healthTask: Promise<void> | null = null;
  constructor(private readonly projectGit: string) {}
  assertHealthy(): Promise<void> {
    if (this.healthTask) return this.healthTask;
    const task = Promise.resolve().then(async () => {
      if (this.healthExecutor.blocked) {
        // The killed fsck's lease on the repository answers whether its
        // children are gone -- the stale unknown clears on that observation.
        const observed = this.healthExecutor.reverifyStale(
          () => { try { return treeQuiescence(this.projectGit).kind; } catch { return "unknown"; } });
        if (observed !== "quiescent") throw new StoreError("REF_STATE_UNKNOWN", `canonical health observation is ${observed}`);
      }
      const lease = TreeLease.take(this.projectGit);
      // fsck on a big canonical repository cannot fit a fixed deadline: its
      // own --progress stream re-arms the silence window, and the stream is
      // spooled rather than bounded in memory.
      const diagnostics = `${this.projectGit}.fsck.stderr`;
      try {
        try { removeOwnedFile(diagnostics); } catch { /* residue cannot block health */ }
        const result = await this.healthExecutor.run(repositoryHealthCommand(this.projectGit, diagnostics), undefined, [lease.descriptor]);
        requireHealthyRepository(result);
      } finally { lease.release(); try { removeOwnedFile(diagnostics); } catch { /* diagnostic residue */ } }
    }).finally(() => { if (this.healthTask === task) this.healthTask = null; });
    this.healthTask = task; return task;
  }
}
