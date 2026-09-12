// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { join } from "node:path";
import type { RunLease, SandboxPlan, ResourceLimits } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "./protocol/run-lease.js";
import { validBatchViewLimits, type BatchViewLimits } from "./protocol/batch-view.js";
import { agentRootPathAt, workspacePathAt, runnerViewPathAt } from "./storage/paths.js";

export interface SandboxHost {
  rootfs: string;
  node: string;
  pi: string;
  piModeArgs: string[];
  tmpBytes: number;
  checkResources: ResourceLimits;
  /** Resident composition additionally needs the already configured host roots
   * and existing frame/batch limits. No new HostConfigV1 fields are introduced.
   */
  stateRoot?: string;
  runRoot?: string;
  limits?: BatchViewLimits;
}
export interface ResidentDirectories {
  workspace: string; home: string; archive: string; selfMail: string;
  view: string; world: string; projectGit: string;
}
function requireResidentContext(h: SandboxHost, lease: RunLease, dirs: ResidentDirectories): void {
  validateSandboxHost(h);
  if (!trustedAbsolutePath(h.stateRoot) || !trustedAbsolutePath(h.runRoot) || !validBatchViewLimits(h.limits))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident sandbox requires trusted roots and explicit batch view limits");
  assertValidatedRunLease(lease, h.runRoot);
  const expected: ResidentDirectories = {
    workspace: workspacePathAt(h.stateRoot, lease.actor), home: join(agentRootPathAt(h.stateRoot, lease.actor), "home"),
    archive: join(h.stateRoot, "mail", "archive"), selfMail: join(h.stateRoot, "mail", "inboxes", lease.actor),
    view: runnerViewPathAt(h.stateRoot, lease.actor), world: join(h.stateRoot, "world"), projectGit: join(h.stateRoot, "repos", "project.git"),
  };
  for (const key of Object.keys(expected) as Array<keyof ResidentDirectories>)
    if (!trustedAbsolutePath(dirs[key]) || dirs[key] !== expected[key])
      throw new StoreError("AUTH_FAILED", `resident ${key} mount does not match the trusted actor root`);
}

/** Pure lexical recipe. Actual mount/symlink/FD/kernel probes remain S-01 gates. */
export function residentArgv(h: SandboxHost, lease: ValidatedRunLease,
  workspaceHost: string, homeHost: string, archiveHost: string, selfMailHost: string,
  viewHost: string, worldHost: string, projectGitHost: string): string[] {
  requireResidentContext(h, lease, { workspace: workspaceHost, home: homeHost, archive: archiveHost,
    selfMail: selfMailHost, view: viewHost, world: worldHost, projectGit: projectGitHost });
  const limits = h.limits!;
  return ["bwrap", "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    "--ro-bind", h.rootfs, "/", "--proc", "/proc", "--dev", "/dev",
    "--size", String(h.tmpBytes), "--tmpfs", "/tmp",
    "--bind", workspaceHost, "/workspace", "--bind", homeHost, "/home/agent",
    "--ro-bind", archiveHost, "/mail/archive", "--ro-bind", selfMailHost, "/mail/self",
    "--ro-bind", viewHost, "/run/oma-view", "--ro-bind", worldHost, "/world",
    "--ro-bind", projectGitHost, "/git/project.git",
    "--ro-bind", lease.socketHostPath, "/run/oma/control.sock",
    "--symlink", "/run/oma-view/inbox.md", "/inbox.md", "--clearenv",
    "--setenv", "HOME", "/home/agent", "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "OMA_FRAME_BYTES", String(limits.frameBytes),
    "--setenv", "OMA_BATCH_MAX_MESSAGES", String(limits.batchMaxMessages),
    "--setenv", "OMA_ACTOR", lease.actor, "--setenv", "OMA_INCARNATION", String(lease.incarnation),
    "--chdir", "/workspace", "--", h.node, h.pi, ...h.piModeArgs];
}

/** Candidate recipe only; SandboxModule.candidate still refuses execution. */
export function candidateArgv(h: SandboxHost, candidateDir: string, checkAssetsDir: string,
  checkTmpBytes: number, command: readonly string[], env: Readonly<Record<string, string>> = {}): string[] {
  validateSandboxHost(h);
  if (!trustedAbsolutePath(candidateDir) || !trustedAbsolutePath(checkAssetsDir) || command.length === 0 || !command[0] ||
    command.some(value => typeof value !== "string" || value.includes("\0")) || !Number.isSafeInteger(checkTmpBytes) || checkTmpBytes <= 0)
    throw new StoreError("CHECK_FAILED", "candidate check command, paths or resources are invalid");
  for (const [key, value] of Object.entries(env))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0"))
      throw new StoreError("CHECK_FAILED", "candidate environment is invalid");
  const checkEnv = Object.entries(env).sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, value]) => ["--setenv", key, value]);
  return ["bwrap", "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    "--ro-bind", h.rootfs, "/", "--proc", "/proc", "--dev", "/dev", "--size", String(checkTmpBytes), "--tmpfs", "/tmp",
    "--bind", candidateDir, "/candidate", "--ro-bind", checkAssetsDir, "/checks", "--clearenv",
    "--setenv", "HOME", "/tmp", "--setenv", "PATH", "/usr/bin:/bin", ...checkEnv,
    "--chdir", "/candidate", "--", ...command];
}
export function validateSandboxHost(h: SandboxHost): void {
  if (!trustedAbsolutePath(h.rootfs) || !trustedAbsolutePath(h.node) || !trustedAbsolutePath(h.pi))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox host paths must be normalized non-root absolute paths");
  if (!Number.isSafeInteger(h.tmpBytes) || h.tmpBytes <= 0 || !Array.isArray(h.piModeArgs) ||
    h.piModeArgs.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox temporary bound or Pi argv is invalid");
}
export class SandboxModule {
  constructor(private readonly host: SandboxHost) { validateSandboxHost(host); }
  resident(lease: RunLease, dirs: ResidentDirectories): SandboxPlan {
    requireResidentContext(this.host, lease, dirs);
    assertValidatedRunLease(lease, this.host.runRoot);
    const argv = residentArgv(this.host, lease, dirs.workspace, dirs.home, dirs.archive, dirs.selfMail, dirs.view, dirs.world, dirs.projectGit);
    return { argv, env: {}, inheritedFds: [0, 1, 2] };
  }
  candidate(oid: string, checkProfile: string): SandboxPlan {
    void oid; void checkProfile;
    throw new StoreError("SPIKE_UNRESOLVED", "candidate-check sandbox is gated by phase 7 integrate checks");
  }
}
