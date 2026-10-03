/** The paths a confined Resident sees and the pure translations between host
 * and inside views. One table serves the mount plan, the arguments handed to
 * the engine, and the callers that validate or translate -- so the views
 * cannot drift. Kernel layer: pure path policy, no store or broker imports. */
import { DEPLOYMENT_LAYOUT } from "./domain/deployment.js";
import { StoreError } from "./domain/errors.js";
import type { SandboxHost, SandboxDirectories as ResidentDirectories } from "./ports/runtime.js";

/** The dirname a K0 module may compute: a pure suffix cut, so the kernel zone
 * stays free of platform path capabilities (kernel-external-effect). */
const dirnameOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/** The pure reading of protocol/run-lease's trustedAbsolutePath -- a K0 file
 * cannot import that codec-zone module, so the same predicate is written as a
 * string check: absolute, normalized (no empty, ".", or ".." segment), non-root,
 * NUL-free. A test binds the two readings to the same verdicts. */
const trustedResidentPath = (path: unknown): path is string =>
  typeof path === "string" && path !== "/" && path.startsWith("/") && !path.includes("\0") &&
  path.split("/").slice(1).every(part => part !== "" && part !== "." && part !== "..");

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

/** WP27: the one bubblewrap a confined engine is started through; the same
 * binary `spawnSandboxed` pins. A plan names it absolutely, because the
 * owned spawn that delivers a batch accepts no PATH lookup. */
export const SANDBOX_EXECUTABLE = "/usr/bin/bwrap";

/** The descriptor bubblewrap reads the sandbox's seccomp program from. */
export const SANDBOX_FILTER_FD = 3;

/** AV16, CLI-001: what `oma` is inside the sandbox -- the pinned Node running
 * the installed model-facing CLI -- and the PATH that finds it (the pinned
 * Node's directory too, so `node` is the pinned one). The build writes the
 * script from here; the package check compares the installed one with it. */
export function modelCommandScript(): string {
  return `#!/bin/sh\n# CLI-001: the model-facing OMA command inside a Resident's sandbox.\nexec ${RESIDENT_PATHS.node} ${RESIDENT_PATHS.libdir}/${DEPLOYMENT_LAYOUT.cli} "$@"\n`;
}
export const RESIDENT_PATH_ENV = `${RESIDENT_PATHS.libdir}/${dirnameOf(DEPLOYMENT_LAYOUT.modelCommand)}:${dirnameOf(RESIDENT_PATHS.node)}:${RESIDENT_PATHS.home}/.local/bin:/usr/bin:/bin`;
export const RESIDENT_ENVIRONMENT = Object.freeze({
  HOME: RESIDENT_PATHS.home, PATH: RESIDENT_PATH_ENV,
  LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TERM: "xterm-256color", TMPDIR: "/tmp",
  SHELL: "/bin/sh", USER: "agent", LOGNAME: "agent",
  XDG_DATA_HOME: `${RESIDENT_PATHS.home}/.local/share`, XDG_RUNTIME_DIR: `${RESIDENT_PATHS.home}/.run`,
});

/** SB-002-E: `installation.rootfs` must name a trusted non-root path.
 * Society supports only confined Residents; a missing sandbox is rejected
 * before execution. The one reading of that setting. */
export function requireResidentRootfs(rootfs: string): void {
  if (!trustedResidentPath(rootfs))
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

/** Translates a host path into the path the confined process sees, using the
 * same mount table `residentArgv` is built from, so the two cannot disagree.
 *
 * A path under no mount is refused rather than passed through: handing the
 * engine a path that does not exist inside would surface later as an
 * unexplained engine error instead of a refused configuration.
 */
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

