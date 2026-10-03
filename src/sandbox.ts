// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { basename, dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import { DEPLOYMENT_LAYOUT } from "./domain/deployment.js";
import type { RunLease, SandboxPlan } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "./protocol/run-lease.js";
import { validBatchViewLimits } from "./protocol/batch-view.js";
import { agentRootPathAt, projectGitPathAt, projectMirrorPathAt, workspacePathAt, runnerViewPathAt, runnerSessionDirPathAt } from "./storage/paths.js";

/** The paths a confined Resident sees. One table serves both the mount plan and
 * the arguments handed to the engine inside it, so the two cannot drift. */
export const RESIDENT_PATHS = Object.freeze({
  workspace: "/workspace", home: "/home/agent", archive: "/mail/archive",
  /** mail-v1: worker-only review mail; a Resident's tools read it here. */
  workerArchive: "/mail/workers",
  selfMail: "/mail/self", view: "/run/oma-view", world: "/world",
  projectGit: "/git/project.git", socket: "/run/oma/control.sock",
  /** DR18 (D-8): the human's committed project history, read-only. */
  projectMirror: "/git/project-mirror.git",
  sessions: "/run/oma-sessions", libdir: "/opt/oma",
  /** DR25: the packages the Human installed with `oma pi install`, read-only. */
  packages: "/opt/oma-packages",
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
  "/etc/resolv.conf", "/etc/ssl/certs", "/etc/pki/ca-trust", "/etc/pki/tls/certs",
  "/etc/nsswitch.conf", "/etc/hosts", "/etc/localtime",
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
    archive: join(h.stateRoot, "mail", "archive"), workerArchive: join(h.stateRoot, "mail", "workers"),
    selfMail: join(h.stateRoot, "mail", "inboxes", lease.actor),
    view: runnerViewPathAt(h.stateRoot, lease.actor), world: join(h.stateRoot, "world"), projectGit: projectGitPathAt(h.stateRoot),
    projectMirror: projectMirrorPathAt(h.stateRoot), sessions: runnerSessionDirPathAt(h.stateRoot, lease.actor),
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
export const RESIDENT_PATH_ENV = `${RESIDENT_PATHS.libdir}/${dirname(DEPLOYMENT_LAYOUT.modelCommand)}:${dirname(RESIDENT_PATHS.node)}:${RESIDENT_PATHS.home}/.local/bin:/usr/bin:/bin`;
export const RESIDENT_ENVIRONMENT = Object.freeze({
  HOME: RESIDENT_PATHS.home, PATH: RESIDENT_PATH_ENV,
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TERM: "xterm-256color", TMPDIR: "/tmp",
  SHELL: "/bin/sh", USER: "agent", LOGNAME: "agent",
  XDG_DATA_HOME: `${RESIDENT_PATHS.home}/.local/share`, XDG_RUNTIME_DIR: `${RESIDENT_PATHS.home}/.run`,
});

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

/** Translates a host path into the path the confined process sees, using the
 * same mount table `residentArgv` is built from, so the two cannot disagree.
 *
 * A path under no mount is refused rather than passed through: handing the
 * engine a path that does not exist inside would surface later as an
 * unexplained engine error instead of a refused configuration.
 */
/** The directory mounts of a Resident's plan, host root beside the path the
 * confined process sees -- the one table both translations read (INV04). */
function residentMounts(host: MountedInstallation, dirs: ResidentDirectories): readonly (readonly [string, string])[] {
  return [
    [host.libdir, RESIDENT_PATHS.libdir], ...(host.packages === undefined ? [] : [[host.packages, RESIDENT_PATHS.packages] as const]),
    [dirs.workspace, RESIDENT_PATHS.workspace],
    [dirs.home, RESIDENT_PATHS.home], [dirs.sessions, RESIDENT_PATHS.sessions],
    [dirs.archive, RESIDENT_PATHS.archive], [dirs.workerArchive, RESIDENT_PATHS.workerArchive],
    [dirs.selfMail, RESIDENT_PATHS.selfMail],
    [dirs.view, RESIDENT_PATHS.view], [dirs.world, RESIDENT_PATHS.world],
    [dirs.projectGit, RESIDENT_PATHS.projectGit], [dirs.projectMirror, RESIDENT_PATHS.projectMirror],
  ];
}

/** AV17, D01/SB-006: the host path of a session file the confined engine names.
 * A delivery boundary is the confined engine's report, and the path in it is
 * the sandbox's view; the trusted receipt names the durable file by its host
 * path. Only the session mount translates back -- a boundary names a session
 * file and nothing else -- and a name that is not a plain file beneath it is
 * no session path (null). */
/** SB-002-E: `installation.rootfs` must name a trusted non-root path.
 * Society supports only confined Residents; a missing sandbox is rejected
 * before execution. The one reading of that setting. */
export function requireResidentRootfs(rootfs: string): void {
  if (!trustedAbsolutePath(rootfs))
    throw new StoreError("UNSUPPORTED_PROFILE", "UNSUPPORTED_PROFILE: Society requires a trusted non-root Resident rootfs");
}

/** Where a Resident's Git reaches the canonical repository (GIT-002). */
export function residentProjectGit(): string { return RESIDENT_PATHS.projectGit; }

export function hostSessionPath(dirs: ResidentDirectories, insidePath: string): string | null {
  const prefix = `${RESIDENT_PATHS.sessions}/`;
  if (!insidePath.startsWith(prefix) || insidePath.includes("\0")) return null;
  const name = insidePath.slice(prefix.length);
  if (name.length === 0 || name.includes("/") || name === "." || name === "..") return null;
  const host = dirs.sessions.length > 1 && dirs.sessions.endsWith("/") ? dirs.sessions.slice(0, -1) : dirs.sessions;
  return `${host}/${name}`;
}

/** The installation a Resident's plan mounts: its files and (DR25) the installed packages. */
export type MountedInstallation = Pick<SandboxHost, "libdir" | "packages">;

export function confinedPath(host: MountedInstallation, dirs: ResidentDirectories, hostPath: string): string {
  for (const [root, inside] of [...residentMounts(host, dirs)].sort(([left], [right]) => right.replace(/\/$/, "").length - left.replace(/\/$/, "").length)) {
    // A root may be written with a trailing separator (the installation path
    // `oma` records is); the comparison must not depend on that spelling.
    const host = root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
    if (hostPath === host) return inside;
    // The separator is required, so `/state/agents/ab` never matches `/state/agents/a`.
    if (hostPath.startsWith(`${host}/`)) return `${inside}${hostPath.slice(host.length)}`;
  }
  throw new StoreError("AUTH_FAILED", "path is outside every mount the confined engine has");
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
