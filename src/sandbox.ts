// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { basename, dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import type { RunLease, SandboxPlan } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "./protocol/run-lease.js";
import { validBatchViewLimits } from "./protocol/batch-view.js";
import { agentRootPathAt, projectGitPathAt, projectMirrorPathAt, workspacePathAt, runnerViewPathAt, runnerSessionDirPathAt } from "./storage/paths.js";
import { RESIDENT_ENVIRONMENT, RESIDENT_PATHS, SANDBOX_FILTER_FD, SYSTEM_BIND_CANDIDATES, nodeToolchainMounts } from "./resident-paths.js";

// The pure path tables and translations live in src/resident-paths.ts (kernel
// layer); orchestration code keeps importing them through this module so the
// mount plan and its readers share one spelling.
export {
  RESIDENT_PATHS, SYSTEM_BIND_CANDIDATES, RESIDENT_INFERENCE_PORT, SANDBOX_EXECUTABLE,
  SANDBOX_FILTER_FD, modelCommandScript, RESIDENT_PATH_ENV, RESIDENT_ENVIRONMENT,
  RESIDENT_NODE_TOOLCHAIN, nodeToolchainMounts, requireResidentRootfs, residentProjectGit, hostSessionPath, confinedPath,
  type MountedInstallation,
} from "./resident-paths.js";

import type { SandboxHost, SandboxDirectories as ResidentDirectories } from "./ports/runtime.js";
export type { SandboxHost, SandboxDirectories as ResidentDirectories } from "./ports/runtime.js";

/** Environment entries are attacker-adjacent: they come from role settings and
 * host configuration, and `--clearenv` means this array is the whole
 * environment. A malformed name or an embedded NUL is refused, never escaped. */
function setenvPairs(env: Readonly<Record<string, string>>): string[] {
  for (const [key, value] of Object.entries(env))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0"))
      throw new StoreError("UNSUPPORTED_PROFILE", "confined environment name or value is invalid");
  return Object.entries(env).sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, value]) => ["--setenv", key, value]);
}

function requireResidentContext(h: SandboxHost, lease: RunLease, dirs: ResidentDirectories): void {
  validateSandboxHost(h);
  if (!trustedAbsolutePath(h.stateRoot) || !trustedAbsolutePath(h.runRoot) || !validBatchViewLimits(h.limits))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident sandbox requires trusted roots and explicit batch view limits");
  assertValidatedRunLease(lease, h.runRoot);
  const expected: ResidentDirectories = {
    workspace: workspacePathAt(h.stateRoot, lease.actor), home: join(agentRootPathAt(h.stateRoot, lease.actor), "home"),
    archive: join(h.stateRoot, "mail", "archive"), workerArchive: join(h.stateRoot, "mail", "workers"),
    selfMail: join(h.stateRoot, "mail", "inboxes", lease.actor),
    view: runnerViewPathAt(h.stateRoot, lease.actor), world: join(h.stateRoot, "world"), projectGit: projectGitPathAt(h.stateRoot),
    projectMirror: projectMirrorPathAt(h.stateRoot), sessions: runnerSessionDirPathAt(h.stateRoot, lease.actor),
  };
  for (const key of Object.keys(expected) as Array<keyof ResidentDirectories>)
    if (!trustedAbsolutePath(dirs[key]) || dirs[key] !== expected[key])
      throw new StoreError("AUTH_FAILED", `resident ${key} mount does not match the trusted actor root`);
}

/** The same mount source, named by the real directory it reaches rather than
 * any /proc/<pid>/fd anchor the run root may carry. Only the parent resolves:
 * the bound leaf itself need not exist yet. */
function resolvedBindSource(path: string): string {
  // A missing parent keeps the lexical spelling: there is nothing to resolve,
  // and argument construction must not fail before any mount exists.
  try { return join(realpathSync(dirname(path)), basename(path)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") return path;
    throw error;
  }
}

/** Pure lexical recipe. Actual mount/symlink/FD/kernel probes remain S-01 gates.
 *
 * `env` is the engine's whole environment: `--clearenv` drops the host's, so an
 * entry the core extension needs is present here or it is absent inside. The
 * three entries this builder owns are set last and are not overridable — the
 * limits the run is bound to and the actor whose lease was validated above.
 */
export function residentArgv(h: SandboxHost, lease: ValidatedRunLease,
  dirs: ResidentDirectories, env: Readonly<Record<string, string>> = {},
  inferenceSocketHost?: string): string[] {
  requireResidentContext(h, lease, dirs);
  if (inferenceSocketHost !== undefined && !trustedAbsolutePath(inferenceSocketHost))
    throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
  const limits = h.limits!;
  return ["bwrap", "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    // SB-001, MAC-205: the kernel objects no namespace confines are refused by
    // system call; the program is read from this descriptor (sandboxSeccompFilter).
    "--seccomp", String(SANDBOX_FILTER_FD),
    "--ro-bind", h.rootfs, "/",
    ...(h.systemBinds ?? []).flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", h.node, RESIDENT_PATHS.node,
    // FI-2: the pinned Node's npm/npx/corepack, from its own prefix when it
    // ships them there; the rootfs links them beside the Node.
    ...nodeToolchainMounts(h.node).flatMap(([source, target]) => ["--ro-bind-try", source, target]),
    "--proc", "/proc", "--dev", "/dev",
    "--size", String(h.tmpBytes), "--tmpfs", "/tmp",
    "--ro-bind", h.libdir, RESIDENT_PATHS.libdir,
    ...(h.hidden ?? []).flatMap(({ path, kind }) => {
      const target = `${RESIDENT_PATHS.libdir}/${path}`;
      return kind === "dir" ? ["--tmpfs", target, "--remount-ro", target] : ["--ro-bind", "/dev/null", target];
    }),
    // DR25: only the package store -- package code and its package manager's
    // list -- never the engine home, which holds the Human's login.
    ...(h.packages === undefined ? [] : ["--ro-bind", h.packages, RESIDENT_PATHS.packages]),
    "--bind", dirs.workspace, RESIDENT_PATHS.workspace, "--bind", dirs.home, RESIDENT_PATHS.home,
    "--bind", dirs.sessions, RESIDENT_PATHS.sessions,
    "--ro-bind", dirs.archive, RESIDENT_PATHS.archive, "--ro-bind", dirs.workerArchive, RESIDENT_PATHS.workerArchive,
    "--ro-bind", dirs.selfMail, RESIDENT_PATHS.selfMail,
    "--ro-bind", dirs.view, RESIDENT_PATHS.view, "--ro-bind", dirs.world, RESIDENT_PATHS.world,
    "--ro-bind", dirs.projectGit, RESIDENT_PATHS.projectGit,
    // DR18 (D-8): there only once a start has refreshed it from the project.
    "--ro-bind-try", dirs.projectMirror, RESIDENT_PATHS.projectMirror,
    // P0V-95/D03: a run root may name itself through /proc/<pid>/fd (a held
    // descriptor). bwrap resolves bind sources after unsharing its user
    // namespace, where another process's fd links are denied; the kernel
    // mounts the resolved inode either way, so name the real path it reaches.
    "--ro-bind", resolvedBindSource(lease.socketHostPath), RESIDENT_PATHS.socket,
    ...(inferenceSocketHost === undefined ? []
      : ["--ro-bind", resolvedBindSource(inferenceSocketHost), RESIDENT_PATHS.inference]),
    "--symlink", `${RESIDENT_PATHS.view}/inbox.md`, "/inbox.md", "--clearenv",
    ...setenvPairs(env), ...setenvPairs(RESIDENT_ENVIRONMENT),
    "--setenv", "OMA_FRAME_BYTES", String(limits.frameBytes),
    "--setenv", "OMA_BATCH_MAX_MESSAGES", String(limits.batchMaxMessages),
    "--setenv", "OMA_ACTOR", lease.actor,
    "--chdir", RESIDENT_PATHS.workspace, "--", RESIDENT_PATHS.node, h.pi, ...h.piModeArgs];
}

export function validateSandboxHost(h: SandboxHost): void {
  if (!trustedAbsolutePath(h.rootfs) || !trustedAbsolutePath(h.libdir) ||
    !trustedAbsolutePath(h.node) || !trustedAbsolutePath(h.pi) || (h.packages !== undefined && !trustedAbsolutePath(h.packages)))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox host paths must be normalized non-root absolute paths");
  if (h.hidden !== undefined && (!Array.isArray(h.hidden) || h.hidden.some(entry =>
    typeof entry?.path !== "string" || entry.path.length === 0 || entry.path.startsWith("/") ||
    entry.path.split("/").some((part: string) => part === "" || part === "." || part === "..") ||
    (entry.kind !== "dir" && entry.kind !== "file"))))
    throw new StoreError("UNSUPPORTED_PROFILE", "hidden installation paths must be plain relative paths");
  if (h.systemBinds !== undefined && (!Array.isArray(h.systemBinds) ||
    h.systemBinds.some(path => !SYSTEM_BIND_CANDIDATES.includes(path))))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox system mounts must be operating-system paths only");
  if (!Number.isSafeInteger(h.tmpBytes) || h.tmpBytes <= 0 || !Array.isArray(h.piModeArgs) ||
    h.piModeArgs.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox temporary bound or Pi argv is invalid");
}
export class SandboxModule {
  constructor(private readonly host: SandboxHost) { validateSandboxHost(host); }
  resident(lease: RunLease, dirs: ResidentDirectories, env: Readonly<Record<string, string>> = {}): SandboxPlan {
    requireResidentContext(this.host, lease, dirs);
    assertValidatedRunLease(lease, this.host.runRoot);
    const argv = residentArgv(this.host, lease, dirs, env);
    // `env` is empty on purpose: `--clearenv` means the child's environment is
    // the argv above, so nothing is inherited from whoever spawns bwrap.
    // Descriptor 3 carries the sandbox filter (sandboxSeccompFilter, DR18).
    return { argv, env: {}, inheritedFds: [0, 1, 2, SANDBOX_FILTER_FD] };
  }
}
