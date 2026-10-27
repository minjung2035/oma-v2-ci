/** Candidate and runtime-tool disposable tree ownership. Kernel scope proof is borrowed
 * from the execution owner and re-observed before reuse/collection; neither
 * a pathname check nor a free inherited lease can supply that proof. */
import { closeSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { mkdirAt } from "@oma/native/posix-files";
import { withinDirectory } from "@oma/native/files";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { ensureOwnedDirectory, openOwnedDirectoryPath, removeOwnedTree } from "./directory.js";
import { TreeLease, collectLeasedTree } from "./tree-lease.js";

export interface ExecutionStage {
  readonly root: string; readonly workspace: string; readonly temporary: string; readonly leaseFd: number;
}
export class ExecutionStaging {
  private staleRoot: { readonly container: string; readonly root?: string } | null = null;
  private busy = false;
  constructor(private readonly stateRoot: string, private readonly purpose: "candidate" | "runtime-tools", private readonly scopeIsDead: () => boolean) {
    if (purpose !== "candidate" && purpose !== "runtime-tools") throw new StoreError("INVALID_REQUEST", "execution staging purpose is invalid");
  }
  async run<T>(execute: (stage: ExecutionStage) => Promise<T>): Promise<T> {
    if (this.busy || !this.scopeIsDead())
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous preparation scope is not confirmed dead");
    this.busy = true;
    let lease: TreeLease | undefined;
    try {
      return await withAsyncCleanup(async () => {
        if (this.staleRoot !== null) {
          if (this.staleRoot.root !== undefined && collectLeasedTree(this.staleRoot.root).kind !== "quiescent")
            throw new StoreError("REF_STATE_UNKNOWN", "previous preparation staging remains owned or unobserved");
          removeOwnedTree(this.staleRoot.container);
          this.staleRoot = null;
        }
        const staging = join(this.stateRoot, "staging"); ensureOwnedDirectory(staging, this.stateRoot);
        // Admit a new private parent atomically before creating a lease. A
        // colliding foreign name must gain neither an owned marker nor cleanup.
        const container = join(staging, `${this.purpose}-${randomUUID()}`);
        withinDirectory(container, (parent, name) => mkdirAt(parent, name, 0o700));
        this.staleRoot = { container };
        const root = join(container, "tree");
        lease = TreeLease.take(root, true);
        this.staleRoot = { container, root };
        withinDirectory(root, (parent, name) => mkdirAt(parent, name, 0o700));
        const directory = openOwnedDirectoryPath(root);
        try { mkdirAt(directory, "workspace", 0o700); mkdirAt(directory, "tmp", 0o700); }
        finally { closeSync(directory); }
        return execute(Object.freeze({ root, workspace: join(root, "workspace"), temporary: join(root, "tmp"), leaseFd: lease.descriptor }));
      }, () => cleanupAll([() => lease?.release(), () => {
        if (this.staleRoot !== null && this.scopeIsDead() &&
            (this.staleRoot.root === undefined || collectLeasedTree(this.staleRoot.root).kind === "quiescent")) {
          removeOwnedTree(this.staleRoot.container); this.staleRoot = null;
        }
      }]));
    } finally { this.busy = false; }
  }
}
