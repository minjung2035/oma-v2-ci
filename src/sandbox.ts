// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { join } from "node:path";
import type { RunLease, SandboxPlan } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "./protocol/run-lease.js";
import { validBatchViewLimits } from "./protocol/batch-view.js";
import { agentRootPathAt, workspacePathAt, runnerViewPathAt, runnerSessionDirPathAt } from "./storage/paths.js";

/** The paths a confined Resident sees. One table serves both the mount plan and
 * the arguments handed to the engine inside it, so the two cannot drift. */
export const RESIDENT_PATHS = Object.freeze({
  workspace: "/workspace", home: "/home/agent", archive: "/mail/archive",
  selfMail: "/mail/self", view: "/run/oma-view", world: "/world",
  projectGit: "/git/project.git", socket: "/run/oma/control.sock",
  sessions: "/run/oma-sessions", libdir: "/opt/oma",
  /** INF-006: the relay's host end. The confined engine reaches a provider
   * through this socket, so the network namespace stays unshared. */
  inference: "/run/oma/inference.sock",
});

/** Loopback port the core extension serves inside the sandbox, forwarding to
 * the relay socket. A constant is safe because the network namespace is
 * private: nothing else can listen there or reach it. */
export const RESIDENT_INFERENCE_PORT = 8317;

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

import type { SandboxHost, SandboxDirectories as ResidentDirectories } from "./ports/runtime.js";
export type { SandboxHost, SandboxDirectories as ResidentDirectories } from "./ports/runtime.js";
function requireResidentContext(h: SandboxHost, lease: RunLease, dirs: ResidentDirectories): void {
  validateSandboxHost(h);
  if (!trustedAbsolutePath(h.stateRoot) || !trustedAbsolutePath(h.runRoot) || !validBatchViewLimits(h.limits))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident sandbox requires trusted roots and explicit batch view limits");
  assertValidatedRunLease(lease, h.runRoot);
  const expected: ResidentDirectories = {
    workspace: workspacePathAt(h.stateRoot, lease.actor), home: join(agentRootPathAt(h.stateRoot, lease.actor), "home"),
    archive: join(h.stateRoot, "mail", "archive"), selfMail: join(h.stateRoot, "mail", "inboxes", lease.actor),
    view: runnerViewPathAt(h.stateRoot, lease.actor), world: join(h.stateRoot, "world"), projectGit: join(h.stateRoot, "repos", "project.git"),
    sessions: runnerSessionDirPathAt(h.stateRoot, lease.actor),
  };
  for (const key of Object.keys(expected) as Array<keyof ResidentDirectories>)
    if (!trustedAbsolutePath(dirs[key]) || dirs[key] !== expected[key])
      throw new StoreError("AUTH_FAILED", `resident ${key} mount does not match the trusted actor root`);
}

/** Pure lexical recipe. Actual mount/symlink/FD/kernel probes remain S-01 gates.
 *
 * `env` is the engine's whole environment: `--clearenv` drops the host's, so an
 * entry the core extension needs is present here or it is absent inside. The
 * four entries this builder owns are set last and are not overridable, because
 * they name the actor whose lease was validated above.
 */
export function residentArgv(h: SandboxHost, lease: ValidatedRunLease,
  dirs: ResidentDirectories, env: Readonly<Record<string, string>> = {},
  inferenceSocketHost?: string): string[] {
  requireResidentContext(h, lease, dirs);
  if (inferenceSocketHost !== undefined && !trustedAbsolutePath(inferenceSocketHost))
    throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
  const limits = h.limits!;
  return ["bwrap", "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    "--ro-bind", h.rootfs, "/", "--proc", "/proc", "--dev", "/dev",
    "--size", String(h.tmpBytes), "--tmpfs", "/tmp",
    "--ro-bind", h.libdir, RESIDENT_PATHS.libdir,
    "--bind", dirs.workspace, RESIDENT_PATHS.workspace, "--bind", dirs.home, RESIDENT_PATHS.home,
    "--bind", dirs.sessions, RESIDENT_PATHS.sessions,
    "--ro-bind", dirs.archive, RESIDENT_PATHS.archive, "--ro-bind", dirs.selfMail, RESIDENT_PATHS.selfMail,
    "--ro-bind", dirs.view, RESIDENT_PATHS.view, "--ro-bind", dirs.world, RESIDENT_PATHS.world,
    "--ro-bind", dirs.projectGit, RESIDENT_PATHS.projectGit,
    "--ro-bind", lease.socketHostPath, RESIDENT_PATHS.socket,
    ...(inferenceSocketHost === undefined ? []
      : ["--ro-bind", inferenceSocketHost, RESIDENT_PATHS.inference]),
    "--symlink", `${RESIDENT_PATHS.view}/inbox.md`, "/inbox.md", "--clearenv",
    "--setenv", "HOME", RESIDENT_PATHS.home, "--setenv", "PATH", "/usr/bin:/bin",
    ...setenvPairs(env),
    "--setenv", "OMA_FRAME_BYTES", String(limits.frameBytes),
    "--setenv", "OMA_BATCH_MAX_MESSAGES", String(limits.batchMaxMessages),
    "--setenv", "OMA_ACTOR", lease.actor, "--setenv", "OMA_INCARNATION", String(lease.incarnation),
    "--chdir", RESIDENT_PATHS.workspace, "--", h.node, h.pi, ...h.piModeArgs];
}

/** Translates a host path into the path the confined process sees, using the
 * same mount table `residentArgv` is built from, so the two cannot disagree.
 *
 * A path under no mount is refused rather than passed through: handing the
 * engine a path that does not exist inside would surface later as an
 * unexplained engine error instead of a refused configuration.
 */
export function confinedPath(libdir: string, dirs: ResidentDirectories, hostPath: string): string {
  const mounts: readonly (readonly [string, string])[] = [
    [libdir, RESIDENT_PATHS.libdir], [dirs.workspace, RESIDENT_PATHS.workspace],
    [dirs.home, RESIDENT_PATHS.home], [dirs.sessions, RESIDENT_PATHS.sessions],
    [dirs.archive, RESIDENT_PATHS.archive], [dirs.selfMail, RESIDENT_PATHS.selfMail],
    [dirs.view, RESIDENT_PATHS.view], [dirs.world, RESIDENT_PATHS.world],
    [dirs.projectGit, RESIDENT_PATHS.projectGit],
  ];
  for (const [host, inside] of mounts) {
    if (hostPath === host) return inside;
    // The separator is required, so `/state/agents/ab` never matches `/state/agents/a`.
    if (hostPath.startsWith(`${host}/`)) return `${inside}${hostPath.slice(host.length)}`;
  }
  throw new StoreError("AUTH_FAILED", "path is outside every mount the confined engine has");
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
  if (!trustedAbsolutePath(h.rootfs) || !trustedAbsolutePath(h.libdir) ||
    !trustedAbsolutePath(h.node) || !trustedAbsolutePath(h.pi))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox host paths must be normalized non-root absolute paths");
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
    return { argv, env: {}, inheritedFds: [0, 1, 2] };
  }
  candidate(oid: string, checkProfile: string): SandboxPlan {
    void oid; void checkProfile;
    throw new StoreError("SPIKE_UNRESOLVED", "candidate-check sandbox is gated by phase 7 integrate checks");
  }
}
