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
import { completeIterator } from "@oma/native/cleanup";
import { decodeUtf8 } from "@oma/domain/utf8";
import { inventoryRuntimeModuleSteps, type DeploymentLink } from "./module-inventory.js";

// The entry bound is sized for the compiled tree plus the vendored
// extension payloads it ships: a vendored bundle is a full dependency
// closure (pi-web-access alone is ~11k pinned files), plus the installed npm
// runtime. Both closures are hashed, including their native payloads.
const MAX_ENTRIES = 65536;
const MAX_BYTES = 512 * 1024 * 1024;
export interface DeploymentFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface DeploymentManifest {
  readonly version: 2;
  readonly files: readonly DeploymentFile[];
  readonly directories: readonly string[];
  readonly links: readonly DeploymentLink[];
}

export function deploymentManifest(root: string): DeploymentManifest {
  return completeIterator(deploymentManifestSteps(root));
}
export function* deploymentManifestSteps(root: string): Generator<void, DeploymentManifest, void> {
  const files: DeploymentFile[] = [];
  const moduleDirectories: string[] = [];
  const directories = new Set<string>();
  let lock: unknown;
  let entries = 0;
  let total = 0;
  // One scratch buffer and one held directory per traversal level. Reopening
  // every parent and allocating 64 KiB per asset made the 14k-file payload
  // expensive even though its bytes must still all be hashed.
  const buffer = Buffer.alloc(64 * 1024);
  const file = (parent: number, name: string, path: string): void => {
    const captured: Buffer[] | undefined = path === "package-lock.json" ? [] : undefined;
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
        captured?.push(Buffer.from(buffer.subarray(0, count)));
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
      if (captured !== undefined) lock = JSON.parse(decodeUtf8(Buffer.concat(captured)));
    } finally {
      closeSync(fd);
    }
  };
  const tree = function* (parent: number, name: string, path: string, depth = 0): Generator<void, void, void> {
    directories.add(path);
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
        if (child.isDirectory()) yield* tree(fd, name, `${path}/${name}`, depth + 1);
        else if (child.isFile()) { file(fd, name, `${path}/${name}`); yield; }
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
      yield* tree(rootFd, path, path);
    for (const path of [
      DEPLOYMENT_LAYOUT.schema,
      "package.json",
      "package-lock.json",
      ...DEPLOYMENT_LAYOUT.workspaces.map(workspace => `${workspace.root}/package.json`),
    ])
      if (!files.some(entry => entry.path === path)) { file(rootFd, path, path); yield; }
    const modules = yield* inventoryRuntimeModuleSteps(root, rootFd, lock, {
      entry() { if (++entries > MAX_ENTRIES) throw new StoreError("UNSUPPORTED_PROFILE", "deployment inventory exceeds bound"); },
      file, directory: path => moduleDirectories.push(join(root, path)),
      bound: (path, directory) => directory ? DEPLOYMENT_LAYOUT.workspaces.some(workspace => workspace.root === path) ||
        directories.has(path) : files.some(entry => entry.path === path),
    });
    for (const directory of modules.directories) directories.add(directory);
    assertWorkspaceResolution(root, moduleDirectories);
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return Object.freeze({ version: 2, files: Object.freeze(files), directories: Object.freeze([...directories].sort()), links: modules.links });
  } catch (cause) {
    if (cause instanceof StoreError && cause.code === "CANCELLED_BEFORE_COMMIT") throw cause;
    throw unobserved(cause, "the deployment inventory") ?? new StoreError(
      "UNSUPPORTED_PROFILE",
      "deployment inventory could not be verified",
      { cause },
    );
  } finally { if (rootFd !== undefined) closeSync(rootFd); }
}

/** v2 pins runtime dependency bytes, loader links and directory presence too.
 * Existing configured digests are never rewritten or silently interpreted as v2. */
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
