/** Shared actor/root binding. This validates a description, never a live
 * grant, kernel scope, filesystem pin or authority to start a process. */
import { join } from "node:path";
import type { RunLease } from "@oma/contracts";
import type { SandboxHost, SandboxDirectories } from "@oma/contracts/runtime";
import { StoreError } from "@oma/domain/errors";
import { agentRootPathAt, projectGitPathAt, projectMirrorPathAt, workspacePathAt,
  runnerViewPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { assertValidatedRunLease, trustedAbsolutePath } from "./run-lease.js";
import { validBatchViewLimits } from "./batch-view.js";

/** Shared installation grammar. Rootfs and system mounts belong to the Linux
 * adapter; the code, Node and engine grammar is identical on both. */
export function assertSandboxInstallation(host: SandboxHost): void {
  if (Object.hasOwn(host, "rootfs") || Object.hasOwn(host, "systemBinds"))
    throw new StoreError("UNSUPPORTED_PROFILE", "common Worker installation cannot select Linux roots or mounts");
  if (!trustedAbsolutePath(host.libdir) || !trustedAbsolutePath(host.node) || !trustedAbsolutePath(host.pi) ||
      host.libdir.includes("\\") || host.pi.includes("\\") ||
      host.packages !== undefined && !trustedAbsolutePath(host.packages))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox host paths must be normalized non-root absolute paths");
  if (host.hidden !== undefined && (!Array.isArray(host.hidden) || host.hidden.some(entry =>
    typeof entry?.path !== "string" || !entry.path || entry.path.startsWith("/") || entry.path.includes("\0") ||
    entry.path.split("/").some((part: string) => !part || part === "." || part === "..") ||
    entry.kind !== "dir" && entry.kind !== "file")))
    throw new StoreError("UNSUPPORTED_PROFILE", "hidden installation paths must be plain relative paths");
  if (!Array.isArray(host.piModeArgs) || host.piModeArgs.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox temporary bound or Pi argv is invalid");
}

export function assertResidentContext(host: SandboxHost, lease: RunLease, directories: SandboxDirectories): void {
  if (!trustedAbsolutePath(host.stateRoot) || !trustedAbsolutePath(host.runRoot) || !validBatchViewLimits(host.limits))
    throw new StoreError("UNSUPPORTED_PROFILE", "resident sandbox requires trusted roots and explicit batch view limits");
  assertValidatedRunLease(lease, host.runRoot);
  const expected: SandboxDirectories = {
    workspace: workspacePathAt(host.stateRoot, lease.actor), home: join(agentRootPathAt(host.stateRoot, lease.actor), "home"),
    archive: join(host.stateRoot, "mail", "archive"), workerArchive: join(host.stateRoot, "mail", "workers"),
    selfMail: join(host.stateRoot, "mail", "inboxes", lease.actor), view: runnerViewPathAt(host.stateRoot, lease.actor),
    world: join(host.stateRoot, "world"), projectGit: projectGitPathAt(host.stateRoot),
    projectMirror: projectMirrorPathAt(host.stateRoot), sessions: runnerSessionDirPathAt(host.stateRoot, lease.actor),
  };
  for (const key of Object.keys(expected) as Array<keyof SandboxDirectories>)
    if (!trustedAbsolutePath(directories[key]) || directories[key] !== expected[key])
      throw new StoreError("AUTH_FAILED", `resident ${key} mount does not match the trusted actor root`);
}
