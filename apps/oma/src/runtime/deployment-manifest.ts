/** CFG-001: canonical byte pin for the OMA installation, not S-01 qualification.
 * The trusted installer supplies the expected digest out-of-band in host config.
 * No mutable manifest file is trusted, and no runtime state is written here. */
import { constants, closeSync, fstatSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { DEPLOYMENT_LAYOUT, isDeploymentDigest } from "@oma/domain/deployment";
import { StoreError, unobserved } from "@oma/domain/errors";
import { openBeneath, openDirectory, openRegularBeneath } from "@oma/native/files";
import { directoryNames } from "@oma/file-descriptors";
import { statAt } from "@oma/native/posix-files";
import { assertWorkspaceResolution } from "./assets.js";

// The entry bound is sized for the compiled tree plus the vendored
// extension payloads it ships: a vendored bundle is a full dependency
// closure (pi-web-access alone is ~11k pinned files), each of which this
// walk must hash -- the bound refuses absurd inventories, not honest ones.
const MAX_ENTRIES = 32768;
const MAX_BYTES = 256 * 1024 * 1024;
export interface DeploymentFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface DeploymentManifest {
  readonly version: 1;
  readonly files: readonly DeploymentFile[];
}

export function deploymentManifest(root: string): DeploymentManifest {
  const files: DeploymentFile[] = [];
  const moduleDirectories: string[] = [];
  let entries = 0;
  let total = 0;
  // One scratch buffer and one held directory per traversal level. Reopening
  // every parent and allocating 64 KiB per asset made the 14k-file payload
  // expensive even though its bytes must still all be hashed.
  const buffer = Buffer.alloc(64 * 1024);
  const file = (parent: number, name: string, path: string): void => {
    if (++entries > MAX_ENTRIES)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "deployment inventory exceeds bound",
      );
    const fd = openRegularBeneath(parent, name);
    try {
      const before = fstatSync(fd);
      total += before.size;
      if (!Number.isSafeInteger(total) || total > MAX_BYTES)
        throw new StoreError(
          "UNSUPPORTED_PROFILE",
          "deployment bytes exceed bound",
        );
      const digest = createHash("sha256");
      let offset = 0;
      while (offset < before.size) {
        const count = readSync(
          fd,
          buffer,
          0,
          Math.min(buffer.length, before.size - offset),
          offset,
        );
        if (!count)
          throw new StoreError(
            "UNSUPPORTED_PROFILE",
            "deployment asset was truncated",
          );
        digest.update(buffer.subarray(0, count));
        offset += count;
      }
      const after = fstatSync(fd);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      )
        throw new StoreError(
          "UNSUPPORTED_PROFILE",
          "deployment asset changed during verification",
        );
      files.push(
        Object.freeze({
          path,
          bytes: before.size,
          sha256: digest.digest("hex"),
        }),
      );
    } finally {
      closeSync(fd);
    }
  };
  const tree = (parent: number, name: string, path: string, depth = 0): void => {
    if (name === "node_modules") moduleDirectories.push(join(root, path));
    if (++entries > MAX_ENTRIES || depth > 32)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "deployment inventory exceeds bound",
      );
    const fd = openBeneath(parent, name, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      for (const name of directoryNames(fd)) {
        const child = statAt(fd, name);
        if (child.isDirectory()) tree(fd, name, `${path}/${name}`, depth + 1);
        else if (child.isFile()) file(fd, name, `${path}/${name}`);
        else throw new StoreError("UNSUPPORTED_PROFILE", "deployment contains a linked or special entry");
      }
    } finally {
      closeSync(fd);
    }
  };
  let rootFd: number | undefined;
  try {
    rootFd = openDirectory(root.replace(/\/+$/, "") || "/");
    // Assets may be inside their workspace payload. Visit every file once;
    // a nested asset root is already covered by its parent payload tree.
    const roots = [...new Set([DEPLOYMENT_LAYOUT.compiledRoot, dirname(DEPLOYMENT_LAYOUT.contract),
      ...DEPLOYMENT_LAYOUT.workspaces.map(workspace => `${workspace.root}/dist`)])];
    for (const path of roots.filter(path => !roots.some(parent => path.startsWith(`${parent}/`))))
      tree(rootFd, path, path);
    for (const path of [
      DEPLOYMENT_LAYOUT.schema,
      DEPLOYMENT_LAYOUT.modelCommand,
      "package.json",
      "package-lock.json",
      ...DEPLOYMENT_LAYOUT.workspaces.map(workspace => `${workspace.root}/package.json`),
    ])
      if (!files.some(entry => entry.path === path)) file(rootFd, path, path);
    assertWorkspaceResolution(root, moduleDirectories);
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return Object.freeze({ version: 1, files: Object.freeze(files) });
  } catch (cause) {
    throw unobserved(cause, "the deployment inventory") ?? new StoreError(
      "UNSUPPORTED_PROFILE",
      "deployment inventory could not be verified",
      { cause },
    );
  } finally { if (rootFd !== undefined) closeSync(rootFd); }
}

/** JSON key order and sorted relative POSIX paths are part of this v1 byte codec. */
export function deploymentDigest(root: string): string {
  return createHash("sha256")
    .update(JSON.stringify(deploymentManifest(root)))
    .digest("hex");
}
export function assertDeploymentDigest(root: string, expected: string): void {
  if (!isDeploymentDigest(expected) || deploymentDigest(root) !== expected)
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      "deploymentDigest does not match installed runtime bytes",
    );
}
