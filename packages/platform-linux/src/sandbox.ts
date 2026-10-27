import { SANDBOX_FILTER_FD } from "./sandbox-seccomp.js";
// SB-001..006: argv composition is NOT kernel resource-enforcement evidence.
// Only a decoded incarnation socket and this actor's host-owned mount roots enter the plan.
import { basename, dirname, join } from "node:path";
import { realpathSync } from "node:fs";
import type { RunLease, SandboxPlan } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { assertValidatedRunLease, trustedAbsolutePath, type ValidatedRunLease } from "@oma/protocol/run-lease";
import { assertResidentContext, assertSandboxInstallation } from "@oma/protocol/resident-context";
import { RESIDENT_ENVIRONMENT, RESIDENT_PATHS, nodeToolchainMounts, residentDirectoryPolicy } from "@oma/domain/resident-paths";

import { residentRootfsPath, SYSTEM_BIND_CANDIDATES } from "./resident-rootfs.js";
import type { SandboxHost, SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";

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
  dirs: ResidentDirectories, systemBinds: readonly string[], env: Readonly<Record<string, string>> = {},
  inferenceSocketHost?: string, egressSocketHost?: string): string[] {
  const binds = snapshotSystemBinds(systemBinds);
  validateSandboxHost(h, binds);
  assertResidentContext(h, lease, dirs);
  if (binds.some(root => h.stateRoot === root || h.stateRoot!.startsWith(`${root}/`)))
    throw new StoreError("UNSUPPORTED_PROFILE", "Linux system mounts overlap private state");
  if (inferenceSocketHost !== undefined && !trustedAbsolutePath(inferenceSocketHost))
    throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path is not a trusted absolute path");
  if (egressSocketHost !== undefined && !trustedAbsolutePath(egressSocketHost))
    throw new StoreError("UNSUPPORTED_PROFILE", "egress proxy socket path is not a trusted absolute path");
  const limits = h.limits!;
  return ["bwrap", "--unshare-all", "--share-net", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    // SB-001, MAC-205: the kernel objects no namespace confines are refused by
    // system call; the program is read from this descriptor (sandboxSeccompFilter).
    "--seccomp", String(SANDBOX_FILTER_FD),
    "--ro-bind", residentRootfsPath(h.stateRoot!), "/",
    ...binds.flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", h.node, RESIDENT_PATHS.node,
    // FI-2: the pinned Node's npm/npx/corepack, from its own prefix when it
    // ships them there; the rootfs links them beside the Node.
    ...nodeToolchainMounts(h.node).flatMap(([source, target]) => ["--ro-bind-try", source, target]),
    "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--ro-bind", h.libdir, RESIDENT_PATHS.libdir,
    ...(h.hidden ?? []).flatMap(({ path, kind }) => {
      const target = `${RESIDENT_PATHS.libdir}/${path}`;
      return kind === "dir" ? ["--tmpfs", target, "--remount-ro", target] : ["--ro-bind", "/dev/null", target];
    }),
    // DR25: only the package store -- package code and its package manager's
    // list -- never the engine home, which holds the Human's login.
    ...(h.packages === undefined ? [] : ["--ro-bind", h.packages, RESIDENT_PATHS.packages]),
    ...residentDirectoryPolicy(h, dirs).filter(root => root.name !== "libdir" && root.name !== "packages")
      .flatMap(root => [root.writable ? "--bind" : root.optional ? "--ro-bind-try" : "--ro-bind", root.path, root.view]),
    // P0V-95/D03: a run root may name itself through /proc/<pid>/fd (a held
    // descriptor). bwrap resolves bind sources after unsharing its user
    // namespace, where another process's fd links are denied; the kernel
    // mounts the resolved inode either way, so name the real path it reaches.
    "--ro-bind", resolvedBindSource(lease.socketHostPath), RESIDENT_PATHS.socket,
    ...(inferenceSocketHost === undefined ? []
      : ["--ro-bind", resolvedBindSource(inferenceSocketHost), RESIDENT_PATHS.inference]),
    // UX-08/DR34: the CONNECT proxy the same way -- a ro-bound unix socket, so
    // a process inside reaches the runner's proxy and nothing beyond it.
    ...(egressSocketHost === undefined ? []
      : ["--ro-bind", resolvedBindSource(egressSocketHost), RESIDENT_PATHS.egress]),
    "--symlink", `${RESIDENT_PATHS.view}/inbox.md`, "/inbox.md", "--clearenv",
    ...setenvPairs(env), ...setenvPairs(RESIDENT_ENVIRONMENT),
    "--setenv", "OMA_FRAME_BYTES", String(limits.frameBytes),
    "--setenv", "OMA_BATCH_MAX_MESSAGES", String(limits.batchMaxMessages),
    "--setenv", "OMA_ACTOR", lease.actor,
    "--chdir", RESIDENT_PATHS.workspace, "--", RESIDENT_PATHS.node, h.pi, ...h.piModeArgs];
}

function snapshotSystemBinds(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) throw new StoreError("UNSUPPORTED_PROFILE", "Linux system mounts require an explicit array");
  const copy = [...value];
  if (copy.some(path => !SYSTEM_BIND_CANDIDATES.includes(path)))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox system mounts must be operating-system paths only");
  return Object.freeze(copy);
}
export function validateSandboxHost(h: SandboxHost, systemBinds: readonly string[]): void {
  assertSandboxInstallation(h); snapshotSystemBinds(systemBinds);
}
export class SandboxModule {
  constructor(private readonly host: SandboxHost, private readonly systemBinds: readonly string[]) { validateSandboxHost(host, systemBinds); }
  resident(lease: RunLease, dirs: ResidentDirectories, env: Readonly<Record<string, string>> = {}): SandboxPlan {
    assertResidentContext(this.host, lease, dirs);
    assertValidatedRunLease(lease, this.host.runRoot);
    const argv = residentArgv(this.host, lease, dirs, this.systemBinds, env);
    // `env` is empty on purpose: `--clearenv` means the child's environment is
    // the argv above, so nothing is inherited from whoever spawns bwrap.
    // Descriptor 3 carries the sandbox filter (sandboxSeccompFilter, DR18).
    return { argv, env: {}, inheritedFds: [0, 1, 2, SANDBOX_FILTER_FD] };
  }
}
