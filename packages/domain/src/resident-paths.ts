/** The paths a confined Resident sees and the pure translations between host
 * and inside views. One table serves the mount plan, the arguments handed to
 * the engine, and the callers that validate or translate -- so the views
 * cannot drift. Kernel layer: pure path policy, no store or broker imports. */
import { DEPLOYMENT_LAYOUT } from "./deployment.js";
import { StoreError } from "./errors.js";
import type { PathView, SandboxEndpoints, SandboxHost, SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";

/** The dirname a K0 module may compute: a pure suffix cut, so the kernel zone
 * stays free of platform path capabilities (kernel-external-effect). */
const dirnameOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/** The pure reading of protocol/run-lease's trustedAbsolutePath -- a K0 file
 * cannot import that codec-zone module, so the same predicate is written as a
 * string check: absolute, normalized (no empty, ".", or ".." segment), non-root,
 * NUL-free. A test binds the two readings to the same verdicts. */
const trustedResidentPath = (path: unknown): path is string =>
  typeof path === "string" && path !== "/" && path.startsWith("/") && !path.includes("\0") &&
  (path.endsWith("/") ? path.slice(0, -1) : path).split("/").slice(1)
    .every(part => part !== "" && part !== "." && part !== "..");

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
  /** INF-006: the relay's host end. The engine uses its placeholder key;
   * the real provider credential stays with the host relay. */
  inference: "/run/oma/inference.sock",
  /** The per-delivery proxy endpoint; the Resident's proxy variables point
   * at its loopback forwarder. Destinations are unrestricted. */
  egress: "/run/oma/egress.sock",
  /** The pinned Node, bound as a single file so the rootfs need not carry it. */
  node: "/opt/oma-node/node",
  /** FI-2: the pinned Node's own package managers, mounted where its
   * distribution keeps them relative to `node` (RESIDENT_NODE_TOOLCHAIN). */
  nodeModules: "/opt/oma-node/lib/node_modules",
});

/** FI-2: the package-manager commands a Resident has beside the pinned Node
 * (its prompt says `npm test`). Node's distribution ships each as
 * `<prefix>/lib/node_modules/<module>` with a `<prefix>/bin/<command>` link
 * to `<entry>`; the rootfs reproduces the link beside RESIDENT_PATHS.node and
 * the mount plan binds the module from the pinned Node's own prefix
 * (nodeToolchainMounts), so the commands are the pinned Node's version. The
 * image-side half -- the deployment's Node ships them, in its prefix or on
 * `/usr/bin` -- is pinned by a contract test against the host's Node. */
export const RESIDENT_NODE_TOOLCHAIN = Object.freeze([
  Object.freeze({ command: "npm", module: "npm", entry: "bin/npm-cli.js" }),
  Object.freeze({ command: "npx", module: "npm", entry: "bin/npx-cli.js" }),
  Object.freeze({ command: "corepack", module: "corepack", entry: "dist/corepack.js" }),
] as const);

/** Each toolchain module's host source beside its inside target, read from
 * the pinned Node's path: `<prefix>/bin/node` keeps them in
 * `<prefix>/lib/node_modules`. A Node laid out otherwise (a distribution
 * `/usr/bin/node` whose npm is packaged elsewhere) names an absent source;
 * the plan binds with `--ro-bind-try`, the rootfs link then dangles, and a
 * PATH lookup moves on to the operating system's `/usr/bin/<command>`. */
export function nodeToolchainMounts(node: string): readonly (readonly [string, string])[] {
  const prefix = dirnameOf(dirnameOf(node));
  if (prefix.length === 0) return [];
  return [...new Set(RESIDENT_NODE_TOOLCHAIN.map(tool => tool.module))]
    .map(module => [`${prefix}/lib/node_modules/${module}`, `${RESIDENT_PATHS.nodeModules}/${module}`] as const);
}

/** Preferred loopback port for the relay bridge. The shared network may
 * already have a listener here: the extension falls back to an allocated
 * port and publishes only the address its own listener actually holds. */
export const RESIDENT_INFERENCE_PORT = 8317;
/** UX-08/DR34: the same arrangement for the CONNECT proxy -- the extension's
 * loopback forwarder standard tools reach through HTTP_PROXY et al. */
export const RESIDENT_EGRESS_PORT = 8318;

/** AV16, CLI-001: what `oma` is inside the sandbox -- the pinned Node running
 * the installed model-facing CLI -- and the PATH that finds it (the pinned
 * Node's directory too, so `node` is the pinned one). The build writes the
 * script from here; the package check compares the installed one with it. */
export function modelCommandScript(): string {
  return '#!/bin/sh\n# CLI-001: trusted composition supplies the current model path view.\n'
    + 'case "${OMA_NODE-}" in /*) ;; *) exit 125 ;; esac\n'
    + 'case "${OMA_CLI-}" in /*) ;; *) exit 125 ;; esac\n'
    + 'case "$OMA_CLI" in *\\\\*) exit 125 ;; esac\n'
    + 'exec "$OMA_NODE" "$OMA_CLI" "$@"\n';
}
/** One environment policy for mounted and host layouts. Callers supply only
 * trusted paths in that layout, and platform grammars apply it after extras. */
export function residentEnvironment(paths: { readonly libdir: string; readonly node: string; readonly home: string; readonly temporary: string },
  toolDirectories: readonly string[] = []) {
  if (Object.values(paths).some(path => !trustedResidentPath(path)) || paths.libdir.includes("\\"))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident environment requires normalized view paths");
  if (!Array.isArray(toolDirectories))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident tool directories require a closed list");
  const search = [`${paths.libdir}/${dirnameOf(DEPLOYMENT_LAYOUT.modelCommand)}`, dirnameOf(paths.node), `${paths.home}/.local/bin`,
    ...toolDirectories, "/usr/bin", "/bin"];
  if (search.some(value => !trustedResidentPath(value) || value.includes(":")))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident PATH requires representable absolute directories");
  return Object.freeze({
    HOME: paths.home,
    PATH: search.join(":"),
    OMA_NODE: paths.node, OMA_CLI: `${paths.libdir}/${DEPLOYMENT_LAYOUT.cli}`,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TERM: "xterm-256color", TMPDIR: paths.temporary,
    SHELL: "/bin/sh", USER: "agent", LOGNAME: "agent",
    XDG_DATA_HOME: `${paths.home}/.local/share`, XDG_RUNTIME_DIR: `${paths.home}/.run`,
    // FI-1: nobody is at a terminal. An amend, a merge or a `rebase --continue`
    // keeps the message it has instead of waiting on vi, and Git never prompts
    // for credentials it cannot have. The identity is per actor (pi-spawn-plan).
    GIT_EDITOR: ":", EDITOR: ":", VISUAL: ":", GIT_TERMINAL_PROMPT: "0",
    // FI-2: `npm install -g`/`npm link` land in the home's `.local`, whose bin is
    // on PATH, not the read-only /opt; no registry check on every invocation.
    NPM_CONFIG_PREFIX: `${paths.home}/.local`, NPM_CONFIG_UPDATE_NOTIFIER: "false",
  });
}
export const RESIDENT_ENVIRONMENT = residentEnvironment({ libdir: RESIDENT_PATHS.libdir, node: RESIDENT_PATHS.node,
  home: RESIDENT_PATHS.home, temporary: "/tmp" });
export const RESIDENT_PATH_ENV = RESIDENT_ENVIRONMENT.PATH;

/** Where a Resident's Git reaches the canonical repository (GIT-002). */
export function residentProjectGit(): string { return RESIDENT_PATHS.projectGit; }

export function hostSessionPath(dirs: ResidentDirectories, insidePath: string, sessionRoot: string): string | null {
  if (!trustedResidentPath(sessionRoot)) return null;
  const prefix = `${sessionRoot.replace(/\/$/, "")}/`;
  if (!insidePath.startsWith(prefix) || insidePath.includes("\0")) return null;
  const name = insidePath.slice(prefix.length);
  if (name.length === 0 || name.includes("/") || name === "." || name === "..") return null;
  const host = dirs.sessions.length > 1 && dirs.sessions.endsWith("/") ? dirs.sessions.slice(0, -1) : dirs.sessions;
  return `${host}/${name}`;
}

/** The installation a Resident's plan mounts: its files and (DR25) the installed packages. */
export type MountedInstallation = Pick<SandboxHost, "libdir" | "packages">;

/** One directory table supplies both OS recipes and PathView. Only this
 * actor's workspace/home/sessions are writable; the mirror stays optional. */
export function residentDirectoryPolicy(host: MountedInstallation, dirs: ResidentDirectories): readonly {
  readonly name: string; readonly path: string; readonly view: string; readonly writable: boolean; readonly optional: boolean;
}[] {
  return [
    ["libdir", host.libdir], ...(host.packages === undefined ? [] : [["packages", host.packages]]),
    ...["workspace", "home", "sessions", "archive", "workerArchive", "selfMail", "view", "world", "projectGit", "projectMirror"]
      .map(name => [name, dirs[name as keyof ResidentDirectories]]),
  ].map(([name, path]) => Object.freeze({ name: name!, path: path!, view: RESIDENT_PATHS[name as keyof typeof RESIDENT_PATHS],
    writable: ["workspace", "home", "sessions"].includes(name!), optional: name === "projectMirror" }));
}

/** Translates a host path into the path the confined process sees, using the
 * same mount table `residentArgv` is built from, so the two cannot disagree.
 *
 * A path under no mount is refused rather than passed through: handing the
 * engine a path that does not exist inside would surface later as an
 * unexplained engine error instead of a refused configuration.
 */
export function confinedPath(host: MountedInstallation, dirs: ResidentDirectories, hostPath: string): string {
  for (const { path: root, view: inside } of [...residentDirectoryPolicy(host, dirs)]
    .sort((left, right) => right.path.replace(/\/$/, "").length - left.path.replace(/\/$/, "").length)) {
    // A root may be written with a trailing separator (the installation path
    // `oma` records is); the comparison must not depend on that spelling.
    const host = root.length > 1 && root.endsWith("/") ? root.slice(0, -1) : root;
    if (hostPath === host) return inside;
    // The separator is required, so `/state/agents/ab` never matches `/state/agents/a`.
    if (hostPath.startsWith(`${host}/`)) return `${inside}${hostPath.slice(host.length)}`;
  }
  throw new StoreError("AUTH_FAILED", "path is outside every mount the confined engine has");
}

/** The OS adapter selects its display layout. Directory membership and
 * session validation stay here; there is no kernel or authority observation.
 * A host layout preserves each admitted physical path, without inventing
 * mounts at /workspace, /mail or /opt on that operating system. */
export function residentPathView(host: MountedInstallation, dirs: ResidentDirectories,
  endpoints: SandboxEndpoints & { readonly socket: string }, layout: "mounted" | "host"): PathView {
  const directories = { ...dirs };
  const entries = residentDirectoryPolicy(host, directories).map(({ path: root, view: mounted }) => {
    if (!trustedResidentPath(root)) throw new StoreError("AUTH_FAILED", "model view root is invalid");
    const source = root.replace(/\/$/, "");
    return [source, layout === "host" ? source : mounted] as const;
  }).sort(([left], [right]) => right.length - left.length);
  const files = [[endpoints.socket, RESIDENT_PATHS.socket],
    ...(endpoints.inference === undefined ? [] : [[endpoints.inference, RESIDENT_PATHS.inference] as const]),
    ...(endpoints.egress === undefined ? [] : [[endpoints.egress, RESIDENT_PATHS.egress] as const])]
    .map(([root, mounted]) => {
      if (!trustedResidentPath(root)) throw new StoreError("AUTH_FAILED", "model endpoint path is invalid");
      return [root, layout === "host" ? root : mounted] as const;
    });
  const map = (hostPath: string): string => {
    if (!trustedResidentPath(hostPath)) throw new StoreError("AUTH_FAILED", "model path is invalid");
    for (const [root, inside] of files) if (hostPath === root) return inside;
    for (const [root, inside] of entries) {
      if (hostPath === root) return inside;
      if (hostPath.startsWith(`${root}/`)) return `${inside}${hostPath.slice(root.length)}`;
    }
    throw new StoreError("AUTH_FAILED", "path is outside every root the confined engine has");
  };
  const sessions = map(directories.sessions.replace(/\/$/, ""));
  return Object.freeze({ map, sessionPathToHost: (path: string) => hostSessionPath(directories, path, sessions) });
}

