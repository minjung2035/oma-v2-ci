import { SYSTEM_BIND_CANDIDATES } from "./resident-rootfs.js";
/** Linux candidate sandbox grammar. Shared Git owns exact checkout and setup outcomes. */
import type { CommandSpec } from "@oma/process/command";
import { sandboxSeccompFilter } from "./sandbox-seccomp.js";
import { hostSystemLayout } from "./resident-rootfs.js";
import { RESIDENT_PATHS, nodeToolchainMounts } from "@oma/domain/resident-paths";
import { trustedAbsolutePath } from "@oma/protocol/run-lease";
import { isValidFullOid } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { assertIntegrationCheck, integrationCheckEnvironment, type FrozenCheck } from "@oma/domain/integration-policy";
export interface CandidateSandboxHost { readonly rootfs: string; readonly node: string; readonly libdir: string }
export function candidateSandbox(host: CandidateSandboxHost, candidate: string, check: FrozenCheck,
  systemBinds: readonly string[] = hostSystemLayout().binds): CommandSpec {
  assertIntegrationCheck(check);
  if (systemBinds.some(path => !SYSTEM_BIND_CANDIDATES.includes(path)))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration check system mounts must be operating-system paths");
  if (!isValidFullOid(candidate) || !trustedAbsolutePath(host.rootfs) ||
      !trustedAbsolutePath(host.node) || !trustedAbsolutePath(host.libdir))
    throw new StoreError("UNSUPPORTED_PROFILE", "integration checks require trusted sandbox roots and a pinned Node");
  const environment = integrationCheckEnvironment(check, "/tmp", "/opt/oma-node:/usr/bin:/bin");
  const sandbox = ["/usr/bin/bwrap", "--unshare-all", "--share-net", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
    // bwrap consumes the filter before starting the checked program.
    "--seccomp", "0", "--ro-bind", host.rootfs, "/",
    ...systemBinds.flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", host.node, RESIDENT_PATHS.node,
    // FI-2: a check argv of `npm test` finds the same toolchain a Worker has.
    ...nodeToolchainMounts(host.node).flatMap(([source, target]) => ["--ro-bind-try", source, target]),
    "--ro-bind", host.libdir, RESIDENT_PATHS.libdir,
    "--ro-bind-fd", "7", RESIDENT_PATHS.projectGit,
    "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/workspace", "--tmpfs", "/tmp", "--clearenv",
    ...Object.entries(environment).flatMap(([key, value]) => ["--setenv", key, value]),
    "--", RESIDENT_PATHS.node, `${RESIDENT_PATHS.libdir}/apps/oma/dist/entry/candidate-check.js`, JSON.stringify({ candidate, argv: check.argv,
      view: { git: "/usr/bin/git", project: RESIDENT_PATHS.projectGit, workspace: RESIDENT_PATHS.workspace } })];
  return {
    executable: sandbox[0]!, argv: sandbox.slice(1),
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    input: sandboxSeccompFilter(), timeoutMs: null,
    stdoutBytes: 1024 * 1024, stdoutOverflow: "discard", stderrBytes: 1024 * 1024, stderrOverflow: "discard",
  };
}

