import { lstatSync } from "node:fs";
import { isAbsolute, normalize, join } from "node:path";
import { StoreError, unobserved } from "@oma/domain/errors";

/** Host compatibility policy, not an authorization token: runtime traversal still
 * uses openat2 below these paths. Missing suffixes may be created only by startup. */
export function assertHostDirectoryLayout(path: string, allowMissing = false): void {
  if (!isAbsolute(path) || path.includes("\0") || normalize(path) !== path)
    throw new StoreError("UNSUPPORTED_PROFILE", "host directory must be a normalized absolute path");
  let current = "/";
  for (const component of path.slice(1).split("/").filter(Boolean)) {
    current = join(current, component);
    let stat;
    try { stat = lstatSync(current, { throwIfNoEntry: false }); }
    catch (cause) { throw unobserved(cause, "the host directory layout") ?? new StoreError("UNSUPPORTED_PROFILE", "host directory layout is not a supported one", { cause }); }
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory())
      throw new StoreError("UNSUPPORTED_PROFILE", "host directory ancestors must be real directories, not symlinks");
  }
}

