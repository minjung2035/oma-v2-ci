import { closeSync, constants, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { ValidatedPlan } from "@oma/protocol/operation-codec";
import { StoreError } from "@oma/domain/errors";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { isValidFullOid } from "@oma/domain/identifiers";
import { agentRootPathAt, isWorkspacePathFor } from "@oma/domain/paths";
import { ensureOwnedDurableDirectory, fsyncDir } from "@oma/storage/durable-fs";
import { publishStagedDirectory } from "@oma/storage/staged-tree";
import { assertDirectory, removeOwnedFile } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree, treeQuiescence } from "@oma/storage/tree-lease";
import { openBeneath, withinDirectory } from "@oma/native/files";
import { runGitText, GIT_ENV } from "@oma/process/policies";
import { PreparationExecutor } from "@oma/process/preparation";
import { decodeProcessText } from "@oma/process/run";

/** Preparation and observations only. No registry mutation, activation or mail.
 * Published workspaces are observed, never reset, rebased or checked out again.
 */
export class WorkspaceCoordinator {
  private readonly executor = new PreparationExecutor();
  private working: { readonly key: string; readonly task: Promise<void> } | null = null;
  constructor(private readonly paths: { readonly stateRoot: string; readonly projectGit: string; readonly residentProjectGit?: string }) {}
  private git(argv: readonly string[], cwd?: string) {
    return runGitText(argv, { ...(cwd === undefined ? {} : { cwd }), timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  }
  private async prepareGit(lease: TreeLease, argv: readonly string[], cwd?: string, spool?: { stdout: string; stderr: string }): Promise<{ status: number; stdout: string }> {
    // A clone/fetch/checkout of a big workspace cannot fit a fixed deadline:
    // every byte the child emits re-arms the 120-second silence window (git
    // carries --progress, so a working child is never silent), and only a
    // generous ceiling ends one that never stops. Both streams of such a
    // command are spooled whole -- progress noise and ref chatter must not
    // become in-memory refusals. Small plumbing keeps its bounded buffers.
    const result = await this.executor.run({ executable: "/usr/bin/git", argv, env: GIT_ENV,
      ...(cwd === undefined ? {} : { cwd }), timeoutMs: 24 * 3600 * 1000, silenceMs: 120000, stdoutBytes: 4 * 1024 * 1024,
      stderrBytes: 4 * 1024 * 1024,
      ...(spool === undefined ? {} : { stdoutSpool: spool.stdout, stderrSpool: spool.stderr }) },
      undefined, [lease.descriptor]);
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
  /** Physical observation for Lifecycle's provisioning-only readiness proof. */
  observeProvisioningHead(path: string): { readonly status: number | null; readonly stdout: string } {
    assertDirectory(path); assertDirectory(join(path, ".git"));
    const head = this.git(["rev-parse", "HEAD"], path);
    return { status: head.status, stdout: head.stdout };
  }
  /** `readinessProven` is the durable fact that `ready()` verified this
   * workspace and moved the agent out of `provisioning` -- the only transition
   * out of it, and the only way a run can open. INV03: a settled fact is not
   * derived again from current state, and after it the workspace is the
   * Resident's (its `.git` is the model's to write), so the host neither walks
   * it nor runs Git in it; only its presence is observed. */
  ensure(plan: ValidatedPlan<"agent.create">, readinessProven = false): Promise<void> {
    if (!isWorkspacePathFor(plan.workspacePath, { stateRoot: this.paths.stateRoot, actor: plan.spec.name }))
      return Promise.reject(new StoreError("STORE_CORRUPT", "create workspace path differs from frozen identity"));
    const identity = Object.freeze({ name: plan.spec.name, from: plan.spec.from, workspacePath: plan.workspacePath, specHash: plan.specHash });
    const key = `${identity.workspacePath}\0${identity.specHash}`;
    if (this.working) return this.working.key === key ? this.working.task : Promise.reject(new StoreError("REF_STATE_UNKNOWN", "another workspace preparation is active"));
    if (this.executor.blocked) {
      // A run that never reached a complete observation left its staged tree
      // behind; its lease is the fresh observation of whether those children
      // are gone. Only that proof lets the next preparation proceed -- the
      // stale unknown clears on the observation, never on the attempt.
      const stale = join(agentRootPathAt(this.paths.stateRoot, plan.spec.name), "workspace.tmp");
      const observed = this.executor.reverifyStale(() => { try { return treeQuiescence(stale).kind; } catch { return "unknown"; } });
      if (observed !== "quiescent") return Promise.reject(new StoreError("REF_STATE_UNKNOWN", `workspace executor outcome is ${observed}`));
    }
    const task = Promise.resolve().then(() => this.prepare(identity, readinessProven)).finally(() => { if (this.working?.task === task) this.working = null; });
    this.working = { key, task }; return task;
  }
  private async prepare(identity: Readonly<{ name: string; from: string; workspacePath: string; specHash: string }>, readinessProven: boolean): Promise<void> {
    this.assertCanonicalBase(identity.from);
    const workspace = identity.workspacePath;
    const root = agentRootPathAt(this.paths.stateRoot, identity.name), temporary = join(root, "workspace.tmp");
    ensureOwnedDurableDirectory(root, this.paths.stateRoot, 0o755);
    if (readinessProven) {
      // Only its presence is the host's to observe, through the parent it holds.
      withinDirectory(workspace, (parent, name) => {
        const fd = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY);
        closeSync(fd);
      });
      fsyncDir(root); return;
    }
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
    // R6-04: every git that works in the clone holds its lease. A clone an
    // earlier broker left is resumed only when its lease proves those gits are
    // gone; one still held is not touched (REF_STATE_UNKNOWN).
    const lease = TreeLease.take(temporary);
    try { await this.prepareLeased(lease, identity, temporary, workspace, verify); }
    finally { lease.release(); }
    // Published: only the lease is left, and nothing holds it.
    collectLeasedTree(temporary);
    try { removeOwnedFile(`${temporary}.stderr`); } catch { /* diagnostic residue */ }
    try { removeOwnedFile(`${temporary}.stdout`); } catch { /* diagnostic residue */ }
  }
  private async prepareLeased(lease: TreeLease, identity: Readonly<{ name: string; from: string }>, temporary: string, workspace: string,
    verify: (path: string) => void): Promise<void> {
    ensureOwnedDurableDirectory(temporary, this.paths.stateRoot, 0o755);
    // The git progress/error streams are spooled beside the staged tree;
    // under the lease they are this run's alone, so what a dead run left is
    // replaced.
    const diagnostics = { stderr: `${temporary}.stderr`, stdout: `${temporary}.stdout` };
    try { removeOwnedFile(diagnostics.stderr); } catch { /* a stray cannot block preparation */ }
    try { removeOwnedFile(diagnostics.stdout); } catch { /* a stray cannot block preparation */ }
    if (!existsSync(join(temporary, ".git"))) {
      const cloned = await this.prepareGit(lease, ["clone", "--progress", "--local", "--no-hardlinks", "--dissociate", "--no-checkout",
        "--single-branch", "--branch", "main", this.paths.projectGit, temporary], undefined, diagnostics);
      if (cloned.status !== 0) throw new StoreError("INTERNAL_ERROR", "private workspace clone failed");
    }
    assertDirectory(join(temporary, ".git"));
    // AV27, GIT-002: the clone is made here, from the host path, but it is the
    // Resident's: `git fetch origin <published-ref>` runs where the repository
    // is its mount. Set before the workspace is published, while only this
    // trusted preparation has touched it.
    const origin = this.paths.residentProjectGit ?? RESIDENT_PATHS.projectGit;
    const remote = await this.prepareGit(lease, ["remote", "set-url", "origin", origin], temporary);
    if (remote.status !== 0) throw new StoreError("INTERNAL_ERROR", "private workspace origin could not be set");
    let haveBase = await this.prepareGit(lease, ["cat-file", "-e", `${identity.from}^{commit}`], temporary);
    if (haveBase.status !== 0) {
      const fetched = await this.prepareGit(lease, ["fetch", "--progress", "--no-tags", this.paths.projectGit, identity.from], temporary, diagnostics);
      haveBase = await this.prepareGit(lease, ["cat-file", "-e", `${identity.from}^{commit}`], temporary);
      if (fetched.status !== 0 || haveBase.status !== 0) throw new StoreError("PREREQUISITE_MISSING", `cloned workspace does not contain frozen base ${identity.from}`);
    }
    const checkout = await this.prepareGit(lease, ["checkout", "--progress", "--detach", identity.from], temporary, diagnostics);
    if (checkout.status !== 0) throw new StoreError("INTERNAL_ERROR", "frozen workspace base checkout failed");
    // Final observation, filesystem durability and rename remain one synchronous
    // publication section. Unknown/aborted commands never reach this point.
    publishStagedDirectory(temporary, workspace, verify, "workspace-links");
  }
}
