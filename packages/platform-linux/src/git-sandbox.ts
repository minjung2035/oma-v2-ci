/** Linux sandbox grammar only. Git validation and phase policy remain shared
 * TypeScript. Bound directory FDs are consumed by bwrap before exec. */
import type { CommandSpec } from "@oma/process/command";
import { GIT_ENV } from "@oma/process/policies";
import { RESIDENT_PATHS, nodeToolchainMounts } from "@oma/domain/resident-paths";
import { hostSystemLayout } from "./resident-rootfs.js";
import { StoreError } from "@oma/domain/errors";

export interface GitSandboxHost { readonly rootfs: string; readonly node: string; readonly libdir: string }
export function gitSandbox(host: GitSandboxHost, input: { readonly phase: "verify" | "import"; readonly candidate: string;
  readonly exportRef: string; readonly prerequisites: readonly string[] }): CommandSpec {
  for (const path of [host.rootfs, host.node, host.libdir]) if (!path.startsWith("/") || path.includes("\0"))
    throw new StoreError("UNSUPPORTED_PROFILE", "Git sandbox requires trusted absolute installation paths");
  const env = { ...GIT_ENV, TMPDIR: input.phase === "verify" ? "/quarantine/tmp" : "/tmp" };
  return { executable: "/usr/bin/bwrap", argv: [
    "--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL", "--ro-bind", host.rootfs, "/",
    ...hostSystemLayout().binds.flatMap(path => ["--ro-bind", path, path]),
    "--ro-bind", host.node, RESIDENT_PATHS.node,
    ...nodeToolchainMounts(host.node).flatMap(([source, target]) => ["--ro-bind-try", source, target]),
    "--ro-bind", host.libdir, RESIDENT_PATHS.libdir,
    input.phase === "verify" ? "--bind-fd" : "--ro-bind-fd", "8", "/quarantine",
    input.phase === "verify" ? "--ro-bind-fd" : "--bind-fd", "9", "/git/project.git",
    ...(input.phase === "verify" ? ["--ro-bind-data", "6", "/bundle/input.bundle"] : []),
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--clearenv",
    ...Object.entries(env).flatMap(([name, value]) => value === undefined ? [] : ["--setenv", name, value]),
    "--", RESIDENT_PATHS.node, `${RESIDENT_PATHS.libdir}/apps/oma/dist/entry/quarantine.js`, JSON.stringify({ ...input,
      view: { git: "/usr/bin/git", project: RESIDENT_PATHS.projectGit, root: "/quarantine", bundle: "/bundle/input.bundle", temporary: env.TMPDIR } }),
  ], env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeoutMs: null,
  stdoutBytes: 256, stderrBytes: 64 * 1024, stderrOverflow: "discard" };
}
