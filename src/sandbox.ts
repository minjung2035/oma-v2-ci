// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { dirname, join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "./domain/deployment.js";
import type { RunLease, SandboxPlan } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "./protocol/run-lease.js";
import { validBatchViewLimits } from "./protocol/batch-view.js";
import { agentRootPathAt, projectGitPathAt, workspacePathAt, runnerViewPathAt, runnerSessionDirPathAt } from "./storage/paths.js";

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
  /** The pinned Node, bound as a single file so the rootfs need not carry it. */
  node: "/opt/oma-node/node",
});

/** SB-001: the only host paths a Resident may see besides its own mounts. They
 * are the operating system's programs and libraries — never `/`, `/home`, a
 * state root or a runtime directory — and each is mounted read-only. */
export const SYSTEM_BIND_CANDIDATES: readonly string[] = Object.freeze([
  "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/alternatives", "/etc/ld.so.cache",
]);

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
    view: runnerViewPathAt(h.stateRoot, lease.actor), world: join(h.stateRoot, "world"), projectGit: projectGitPathAt(h.stateRoot),
    sessions: runnerSessionDirPathAt(h.stateRoot, lease.actor),
  };
  for (const key of Object.keys(expected) as Array<keyof ResidentDirectories>)
    if (!trustedAbsolutePath(dirs[key]) || dirs[key] !== expected[key])
      throw new StoreError("AUTH_FAILED", `resident ${key} mount does not match the trusted actor root`);
}

/** AV16, CLI-001: what `oma` is inside the sandbox -- the pinned Node running
 * the installed model-facing CLI -- and the PATH that finds it (the pinned
 * Node's directory too, so `node` is the pinned one). The build writes the
 * script from here; the package check compares the installed one with it. */
export function modelCommandScript(): string {
  return `#!/bin/sh\n# CLI-001: the model-facing OMA command inside a Resident's sandbox.\nexec ${RESIDENT_PATHS.node} ${RESIDENT_PATHS.libdir}/${DEPLOYMENT_LAYOUT.cli} "$@"\n`;
}
export const RESIDENT_PATH_ENV = `${RESIDENT_PATHS.libdir}/${dirname(DEPLOYMENT_LAYOUT.modelCommand)}:${dirname(RESIDENT_PATHS.node)}:/usr/bin:/bin`;

/** WP27: the one bubblewrap a confined engine is started through; the same
 * binary `spawnSandboxed` pins. A plan names it absolutely, because the
 * owned spawn that delivers a batch accepts no PATH lookup. */
export const SANDBOX_EXECUTABLE = "/usr/bin/bwrap";

/** Pure lexical recipe. Actual mount/symlink/FD/kernel probes remain S-01 gates.
 *
 * `env` is the engine's whole environment: `--clearenv` drops the host's, so an
 * entry the core extension needs is present here or it is absent inside. The
 * four entries this builder owns are set last and are not overridable, because
 * they name the actor whose lease was validated above.
 */
/** The descriptor bubblewrap reads the sandbox's seccomp program from. */
export const SANDBOX_FILTER_FD = 3;

export function residentArgv(h: SandboxHost, lease: ValidatedRunLease,
  dirs: ResidentDirectories, env: Readonly<Record<string, string>> = {},
  inferenceSocketHost?: string): string[] {
  requireResidentContext(h, lease, dirs);
  if (inferenceSocketHost !== undefined && !trustedAbsolutePath(inferenceSocketHost))
    throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
  const limits = h.limits!;
  return ["bwrap", "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    // DR18 (D-5, MAC-205): the baseline refuses AF_VSOCK sockets by system
    // call; the program is read from this descriptor (vsockSeccompFilter).
    "--seccomp", String(SANDBOX_FILTER_FD),
    "--ro-bind", h.rootfs, "/",
    ...(h.systemBinds ?? []).flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", h.node, RESIDENT_PATHS.node,
    "--proc", "/proc", "--dev", "/dev",
    "--size", String(h.tmpBytes), "--tmpfs", "/tmp",
    "--ro-bind", h.libdir, RESIDENT_PATHS.libdir,
    ...(h.hidden ?? []).flatMap(({ path, kind }) => {
      const target = `${RESIDENT_PATHS.libdir}/${path}`;
      return kind === "dir" ? ["--tmpfs", target, "--remount-ro", target] : ["--ro-bind", "/dev/null", target];
    }),
    "--bind", dirs.workspace, RESIDENT_PATHS.workspace, "--bind", dirs.home, RESIDENT_PATHS.home,
    "--bind", dirs.sessions, RESIDENT_PATHS.sessions,
    "--ro-bind", dirs.archive, RESIDENT_PATHS.archive, "--ro-bind", dirs.selfMail, RESIDENT_PATHS.selfMail,
    "--ro-bind", dirs.view, RESIDENT_PATHS.view, "--ro-bind", dirs.world, RESIDENT_PATHS.world,
    "--ro-bind", dirs.projectGit, RESIDENT_PATHS.projectGit,
    "--ro-bind", lease.socketHostPath, RESIDENT_PATHS.socket,
    ...(inferenceSocketHost === undefined ? []
      : ["--ro-bind", inferenceSocketHost, RESIDENT_PATHS.inference]),
    "--symlink", `${RESIDENT_PATHS.view}/inbox.md`, "/inbox.md", "--clearenv",
    "--setenv", "HOME", RESIDENT_PATHS.home, "--setenv", "PATH", RESIDENT_PATH_ENV,
    ...setenvPairs(env),
    "--setenv", "OMA_FRAME_BYTES", String(limits.frameBytes),
    "--setenv", "OMA_BATCH_MAX_MESSAGES", String(limits.batchMaxMessages),
    "--setenv", "OMA_ACTOR", lease.actor, "--setenv", "OMA_INCARNATION", String(lease.incarnation),
    "--chdir", RESIDENT_PATHS.workspace, "--", RESIDENT_PATHS.node, h.pi, ...h.piModeArgs];
}

/** Translates a host path into the path the confined process sees, using the
 * same mount table `residentArgv` is built from, so the two cannot disagree.
 *
 * A path under no mount is refused rather than passed through: handing the
 * engine a path that does not exist inside would surface later as an
 * unexplained engine error instead of a refused configuration.
 */
/** The directory mounts of a Resident's plan, host root beside the path the
 * confined process sees -- the one table both translations read (INV04). */
function residentMounts(libdir: string, dirs: ResidentDirectories): readonly (readonly [string, string])[] {
  return [
    [libdir, RESIDENT_PATHS.libdir], [dirs.workspace, RESIDENT_PATHS.workspace],
    [dirs.home, RESIDENT_PATHS.home], [dirs.sessions, RESIDENT_PATHS.sessions],
    [dirs.archive, RESIDENT_PATHS.archive], [dirs.selfMail, RESIDENT_PATHS.selfMail],
    [dirs.view, RESIDENT_PATHS.view], [dirs.world, RESIDENT_PATHS.world],
    [dirs.projectGit, RESIDENT_PATHS.projectGit],
  ];
}

/** AV17, D01/SB-006: the host path of a session file the confined engine names.
 * A delivery boundary is the confined engine's report, and the path in it is
 * the sandbox's view; the trusted receipt names the durable file by its host
 * path. Only the session mount translates back -- a boundary names a session
 * file and nothing else -- and a name that is not a plain file beneath it is
 * no session path (null). */
/** SB-002-E: `installation.rootfs` set to "/" declares no trusted rootfs, and
 * Residents run unconfined on the host; any other value is the rootfs they are
 * sealed in. The one reading of that setting. */
export function residentsConfined(rootfs: string): boolean { return rootfs !== "/"; }

/** Where a Resident's Git reaches the canonical repository (GIT-002). */
export function residentProjectGit(rootfs: string, hostPath: string): string {
  return residentsConfined(rootfs) ? RESIDENT_PATHS.projectGit : hostPath;
}

export function hostSessionPath(dirs: ResidentDirectories, insidePath: string): string | null {
  const prefix = `${RESIDENT_PATHS.sessions}/`;
  if (!insidePath.startsWith(prefix) || insidePath.includes("\0")) return null;
  const name = insidePath.slice(prefix.length);
  if (name.length === 0 || name.includes("/") || name === "." || name === "..") return null;
  const host = dirs.sessions.length > 1 && dirs.sessions.endsWith("/") ? dirs.sessions.slice(0, -1) : dirs.sessions;
  return `${host}/${name}`;
}

export function confinedPath(libdir: string, dirs: ResidentDirectories, hostPath: string): string {
  for (const [root, inside] of residentMounts(libdir, dirs)) {
    // A root may be written with a trailing separator (the installation path
    // `oma` records is); the comparison must not depend on that spelling.
    const host = root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
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
    // Descriptor 3 carries the sandbox filter (vsockSeccompFilter, DR18).
    return { argv, env: {}, inheritedFds: [0, 1, 2, SANDBOX_FILTER_FD] };
  }
  candidate(oid: string, checkProfile: string): SandboxPlan {
    void oid; void checkProfile;
    throw new StoreError("UNSUPPORTED_PROFILE", "integration checks are not run by this version (DR18)");
  }
}
