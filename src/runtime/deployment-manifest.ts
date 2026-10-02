/** CFG-001: canonical byte pin for the OMA installation, not S-01 qualification.
 * The trusted installer supplies the expected digest out-of-band in host config.
 * No mutable manifest file is trusted, and no runtime state is written here. */
import { closeSync, fstatSync, readSync, opendirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { DEPLOYMENT_LAYOUT, isDeploymentDigest } from "../domain/deployment.js";
import { StoreError, unobserved } from "../domain/errors.js";
import { openDirectory, openRegularBeneath } from "../storage/contained-fs.js";

const MAX_ENTRIES = 4096;
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
  let entries = 0;
  let total = 0;
  const file = (path: string): void => {
    if (++entries > MAX_ENTRIES)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "deployment inventory exceeds bound",
      );
    const parent = openDirectory(dirname(join(root, path)));
    let fd: number;
    try {
      fd = openRegularBeneath(parent, basename(path));
    } finally {
      closeSync(parent);
    }
    try {
      const before = fstatSync(fd);
      total += before.size;
      if (!Number.isSafeInteger(total) || total > MAX_BYTES)
        throw new StoreError(
          "UNSUPPORTED_PROFILE",
          "deployment bytes exceed bound",
        );
      const digest = createHash("sha256");
      const buffer = Buffer.alloc(64 * 1024);
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
  const tree = (path: string, depth = 0): void => {
    if (++entries > MAX_ENTRIES || depth > 32)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "deployment inventory exceeds bound",
      );
    const fd = openDirectory(join(root, path));
    try {
      const directory = opendirSync(`/proc/self/fd/${fd}`);
      try {
        for (
          let child = directory.readSync();
          child;
          child = directory.readSync()
        ) {
          if (child.isDirectory()) tree(`${path}/${child.name}`, depth + 1);
          else if (child.isFile()) file(`${path}/${child.name}`);
          else
            throw new StoreError(
              "UNSUPPORTED_PROFILE",
              "deployment contains a linked or special entry",
            );
        }
      } finally {
        directory.closeSync();
      }
    } finally {
      closeSync(fd);
    }
  };
  try {
    tree(DEPLOYMENT_LAYOUT.compiledRoot);
    tree(dirname(DEPLOYMENT_LAYOUT.contract));
    tree(DEPLOYMENT_LAYOUT.systemd);
    for (const path of [
      DEPLOYMENT_LAYOUT.schema,
      ...DEPLOYMENT_LAYOUT.schemaMigrations,
      DEPLOYMENT_LAYOUT.modelCommand,
      "package.json",
      "package-lock.json",
    ])
      file(path);
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return Object.freeze({ version: 1, files: Object.freeze(files) });
  } catch (cause) {
    throw unobserved(cause, "the deployment inventory") ?? new StoreError(
      "UNSUPPORTED_PROFILE",
      "deployment inventory could not be verified",
      { cause },
    );
  }
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
