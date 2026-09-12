import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { ValidatedPlan } from "../storage/operation-codec.js";
import { StoreError } from "../domain/errors.js";
import { isValidFullOid } from "../ids.js";
import { agentRootPathAt, isWorkspacePathFor } from "../storage/paths.js";
import { ensureDurableDirectory, fsyncDir } from "../storage/durable-fs.js";
import { publishStagedDirectory } from "../storage/staged-tree.js";
import { assertDirectory } from "../storage/directory.js";
import { runGitText } from "../process/policies.js";
import type { LifecyclePaths } from "./contracts.js";

/** Preparation and observations only. No registry mutation, activation or mail.
 * Published workspaces are observed, never reset, rebased or checked out again.
 */
export class WorkspaceCoordinator {
  constructor(private readonly paths: Pick<LifecyclePaths, "stateRoot" | "projectGit">) {}
  private git(argv: readonly string[], cwd?: string) {
    return runGitText(argv, { ...(cwd === undefined ? {} : { cwd }), timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  }
  canonicalMain(): string {
    const base = this.git(["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main^{commit}"]);
    if (base.status !== 0 || !isValidFullOid(base.stdout.trim()))
      throw new StoreError("STORE_CORRUPT", "bootstrap requires a host-pinned canonical main");
    const oid = base.stdout.trim(); this.assertCanonicalBase(oid); return oid;
  }
  assertCanonicalBase(oid: string): void {
    if (!isValidFullOid(oid)) throw new StoreError("PREREQUISITE_MISSING", "create base is not a full object identity");
    const result = this.git(["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`]);
    if (result.status !== 0)
      throw new StoreError("PREREQUISITE_MISSING", `create base ${oid} is not present in the canonical repository`);
  }
  ensure(plan: ValidatedPlan<"agent.create">): void {
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }))
      throw new StoreError("STORE_CORRUPT", "create workspace path differs from frozen identity");
    this.assertCanonicalBase(plan.spec.from);
    const workspace = plan.workspacePath;
    const root = agentRootPathAt(this.paths.stateRoot, plan.spec.name);
    const temporary = join(root, "workspace.tmp");
    ensureDurableDirectory(root);
    const verify = (path: string): void => {
      assertDirectory(path); assertDirectory(join(path, ".git"));
      if (lstatSync(join(path, ".git", "objects", "info", "alternates"), { throwIfNoEntry: false }))
        throw new StoreError("STORE_CORRUPT", "workspace must not borrow another object store");
      const head = this.git(["rev-parse", "HEAD"], path);
      if (head.status !== 0 || head.stdout.trim() !== plan.spec.from)
        throw new StoreError("STORE_CORRUPT", `workspace base mismatch for ${plan.spec.name}`);
    };
    const existing = lstatSync(workspace, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isDirectory()) throw new StoreError("STORE_CORRUPT", "workspace destination is not a directory");
      verify(workspace); fsyncDir(root); return;
    }
    ensureDurableDirectory(temporary);
    if (!existsSync(join(temporary, ".git"))) {
      const cloned = this.git(["clone", "--no-local", "--single-branch", "--branch", "main", this.paths.projectGit, temporary]);
      if (cloned.status !== 0) throw new StoreError("INTERNAL_ERROR", "private workspace clone failed");
    }
    assertDirectory(join(temporary, ".git"));
    let haveBase = this.git(["cat-file", "-e", `${plan.spec.from}^{commit}`], temporary);
    if (haveBase.status !== 0) {
      const fetched = this.git(["fetch", "--no-tags", this.paths.projectGit, plan.spec.from], temporary);
      haveBase = this.git(["cat-file", "-e", `${plan.spec.from}^{commit}`], temporary);
      if (fetched.status !== 0 || haveBase.status !== 0)
        throw new StoreError("PREREQUISITE_MISSING", `cloned workspace does not contain frozen base ${plan.spec.from}`);
    }
    const checkout = this.git(["checkout", "--detach", plan.spec.from], temporary);
    if (checkout.status !== 0) throw new StoreError("INTERNAL_ERROR", "frozen workspace base checkout failed");
    publishStagedDirectory(temporary, workspace, verify, "workspace-links");
  }
}
