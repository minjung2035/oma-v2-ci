/** Optional process compilation cache, separate from Society state and proofs.
 * Node validates source/version changes; cache failure always loads source. */
import { constants, enableCompileCache, getCompileCacheDir } from "node:module";
import { lstatSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureOwnedUserDirectory } from "./user-files.js";

export function enableProcessCompileCache(): boolean {
  if (process.env.NODE_DISABLE_COMPILE_CACHE === "1" || process.env.NODE_V8_COVERAGE !== undefined) return false;
  if (getCompileCacheDir() !== undefined) return true;
  try {
    const uid = process.getuid?.();
    if (uid === undefined) return false;
    const directory = join(realpathSync(tmpdir()), `oma-node-cache-${uid}`);
    // The shared temporary parent is never repaired. The private leaf is
    // no-follow checked and readable only by this user, including on macOS.
    ensureOwnedUserDirectory(directory, directory);
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0) return false;
    const result = enableCompileCache(directory);
    return result.status === constants.compileCacheStatus.ENABLED || result.status === constants.compileCacheStatus.ALREADY_ENABLED;
  } catch { return false; } // Optional optimization; no cached observation becomes authority.
}
