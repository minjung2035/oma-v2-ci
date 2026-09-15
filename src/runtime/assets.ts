import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { StoreError } from "../domain/errors.js";

export interface RuntimeAssets {
  readonly root: string; readonly schema: string; readonly systemd: string;
  readonly contract: string; readonly extension: string;
  readonly entries: Readonly<Record<keyof typeof DEPLOYMENT_LAYOUT.entries, string>>;
}
export function runtimeAssets(root: string): RuntimeAssets {
  if (!isAbsolute(root) || root === "/" || root.includes("\0") || normalize(root) !== root)
    throw new StoreError("UNSUPPORTED_PROFILE", "installation root must be a normalized absolute directory");
  return Object.freeze({ root, schema: join(root, DEPLOYMENT_LAYOUT.schema), systemd: join(root, DEPLOYMENT_LAYOUT.systemd),
    contract: join(root, DEPLOYMENT_LAYOUT.contract), extension: join(root, DEPLOYMENT_LAYOUT.extension),
    entries: Object.freeze({ broker: join(root, DEPLOYMENT_LAYOUT.entries.broker), runner: join(root, DEPLOYMENT_LAYOUT.entries.runner), host: join(root, DEPLOYMENT_LAYOUT.entries.host) }) });
}
/** Module-relative legacy exports are checked, never searched through fallback
 * directories. A wrong LIBDIR cannot silently combine two installations.
 * Call before opening Store or installing units, outside every Store transaction.
 */
export function assertRuntimeAssets(assets: RuntimeAssets, observed: { schema: string; systemd: string }): void {
  if (assets.schema !== observed.schema || assets.systemd !== observed.systemd)
    throw new StoreError("UNSUPPORTED_PROFILE", "loaded modules and configured LIBDIR use different deployment layouts");
  const root = realpathSync(assets.root);
  const requireEntry = (path: string, directory: boolean): void => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || (directory ? !stat.isDirectory() : !stat.isFile()))
      throw new StoreError("UNSUPPORTED_PROFILE", `required deployment asset missing or wrong type: ${relative(assets.root, path)}`);
    const resolved = relative(root, realpathSync(path));
    if (resolved === ".." || resolved.startsWith(`..${sep}`) || isAbsolute(resolved))
      throw new StoreError("UNSUPPORTED_PROFILE", "deployment asset escapes installation root");
  };
  requireEntry(assets.systemd, true); requireEntry(assets.schema, false); requireEntry(assets.contract, false); requireEntry(assets.extension, false);
  for (const entry of Object.values(assets.entries)) requireEntry(entry, false);
  for (const template of Object.keys(DEPLOYMENT_LAYOUT.templateEntries)) requireEntry(join(assets.systemd, template), false);
}

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
    catch (cause) { throw new StoreError("UNSUPPORTED_PROFILE", "host directory layout cannot be observed", { cause }); }
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory())
      throw new StoreError("UNSUPPORTED_PROFILE", "host directory ancestors must be real directories, not symlinks");
  }
}
