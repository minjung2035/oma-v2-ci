import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { ValidatedPlan } from "../storage/operation-codec.js";
import { StoreError } from "../domain/errors.js";
import { isValidFullOid } from "../ids.js";
import { agentRootPathAt, isWorkspacePathFor } from "../storage/paths.js";
import { ensureDurableDirectory, fsyncDir } from "../storage/durable-fs.js";
import { publishStagedDirectory } from "../storage/staged-tree.js";
import { assertDirectory } from "../storage/directory.js";
import { runGitText, GIT_ENV } from "../process/policies.js";
import { PreparationExecutor } from "../process/preparation.js";
import { decodeProcessText } from "../process/run.js";
import type { LifecyclePaths } from "./contracts.js";

/** Preparation and observations only. No registry mutation, activation or mail.
 * Published workspaces are observed, never reset, rebased or checked out again.
 */
export class WorkspaceCoordinator {
  private readonly executor = new PreparationExecutor();
  private working: { readonly key: string; readonly task: Promise<void> } | null = null;
  constructor(private readonly paths: Pick<LifecyclePaths, "stateRoot" | "projectGit">) {}
  private git(argv: readonly string[], cwd?: string) {
    return runGitText(argv, { ...(cwd === undefined ? {} : { cwd }), timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  }
  private async prepareGit(argv: readonly string[], cwd?: string): Promise<{ status: number; stdout: string }> {
    const result = await this.executor.run({ executable: "/usr/bin/git", argv, env: GIT_ENV,
      ...(cwd === undefined ? {} : { cwd }), timeoutMs: 120000, stdoutBytes: 4 * 1024 * 1024, stderrBytes: 4 * 1024 * 1024 });
    if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `workspace preparation is ${result.kind}`);
    try { return { status: result.exitCode, stdout: decodeProcessText(result.stdout) }; }
    catch { throw new StoreError("REF_STATE_UNKNOWN", "workspace Git returned malformed output"); }
  }
  canonicalMain(): string {
    const base = this.git(["--git-dir", this.paths.projectGit, "rev-parse", "refs/heads/main^{commit}"]);
    if (base.status !== 0 || !isValidFullOid(base.stdout.trim())) throw new StoreError("STORE_CORRUPT", "bootstrap requires a host-pinned canonical main");
    const oid = base.stdout.trim(); this.assertCanonicalBase(oid); return oid;
  }
  assertCanonicalBase(oid: string): void {
    if (!isValidFullOid(oid)) throw new StoreError("PREREQUISITE_MISSING", "create base is not a full object identity");
    const result = this.git(["--git-dir", this.paths.projectGit, "cat-file", "-e", `${oid}^{commit}`]);
    if (result.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `create base ${oid} is not present in the canonical repository`);
  }
  ensure(plan: ValidatedPlan<"agent.create">): Promise<void> {
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }))
      return Promise.reject(new StoreError("STORE_CORRUPT", "create workspace path differs from frozen identity"));
    const identity = Object.freeze({ name: plan.spec.name, from: plan.spec.from, workspacePath: plan.workspacePath, specHash: plan.specHash });
    const key = `${identity.workspacePath}\0${identity.specHash}`;
    if (this.working) return this.working.key === key ? this.working.task : Promise.reject(new StoreError("REF_STATE_UNKNOWN", "another workspace preparation is active"));
    if (this.executor.blocked) return Promise.reject(new StoreError("REF_STATE_UNKNOWN", "workspace executor outcome is uncertain"));
    const task = Promise.resolve().then(() => this.prepare(identity)).finally(() => { if (this.working?.task === task) this.working = null; });
    this.working = { key, task }; return task;
  }
  private async prepare(identity: Readonly<{ name: string; from: string; workspacePath: string; specHash: string }>): Promise<void> {
    this.assertCanonicalBase(identity.from);
    const workspace = identity.workspacePath;
    const root = agentRootPathAt(this.paths.stateRoot, identity.name), temporary = join(root, "workspace.tmp");
    ensureDurableDirectory(root);
    const verify = (path: string): void => {
      assertDirectory(path); assertDirectory(join(path, ".git"));
      if (lstatSync(join(path, ".git", "objects", "info", "alternates"), { throwIfNoEntry: false })) throw new StoreError("STORE_CORRUPT", "workspace must not borrow another object store");
      const head = this.git(["rev-parse", "HEAD"], path);
      if (head.status !== 0 || head.stdout.trim() !== identity.from) throw new StoreError("STORE_CORRUPT", `workspace base mismatch for ${identity.name}`);
    };
    const existing = lstatSync(workspace, { throwIfNoEntry: false });
    if (existing) {
      if (!existing.isDirectory()) throw new StoreError("STORE_CORRUPT", "workspace destination is not a directory");
      verify(workspace); fsyncDir(root); return;
    }
    ensureDurableDirectory(temporary);
    if (!existsSync(join(temporary, ".git"))) {
      const cloned = await this.prepareGit(["clone", "--no-local", "--single-branch", "--branch", "main", this.paths.projectGit, temporary]);
      if (cloned.status !== 0) throw new StoreError("INTERNAL_ERROR", "private workspace clone failed");
    }
    assertDirectory(join(temporary, ".git"));
    let haveBase = await this.prepareGit(["cat-file", "-e", `${identity.from}^{commit}`], temporary);
    if (haveBase.status !== 0) {
      const fetched = await this.prepareGit(["fetch", "--no-tags", this.paths.projectGit, identity.from], temporary);
      haveBase = await this.prepareGit(["cat-file", "-e", `${identity.from}^{commit}`], temporary);
      if (fetched.status !== 0 || haveBase.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `cloned workspace does not contain frozen base ${identity.from}`);
    }
    const checkout = await this.prepareGit(["checkout", "--detach", identity.from], temporary);
    if (checkout.status !== 0) throw new StoreError("INTERNAL_ERROR", "frozen workspace base checkout failed");
    // Final observation, filesystem durability and rename remain one synchronous
    // publication section. Unknown/aborted commands never reach this point.
    publishStagedDirectory(temporary, workspace, verify, "workspace-links");
  }
}
