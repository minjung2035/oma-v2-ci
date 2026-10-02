import { lstatSync, realpathSync, statfsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { StoreError, unobserved } from "../domain/errors.js";

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
    entries: Object.freeze(Object.fromEntries(Object.entries(DEPLOYMENT_LAYOUT.entries)
      .map(([name, path]) => [name, join(root, path)])) as RuntimeAssets["entries"]) });
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
  for (const migration of DEPLOYMENT_LAYOUT.schemaMigrations) requireEntry(join(assets.root, migration), false);
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
    catch (cause) { throw unobserved(cause, "the host directory layout") ?? new StoreError("UNSUPPORTED_PROFILE", "host directory layout is not a supported one", { cause }); }
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory())
      throw new StoreError("UNSUPPORTED_PROFILE", "host directory ancestors must be real directories, not symlinks");
  }
}

/** DR18 (S-06): the file systems a state tree may not live on, by the
 * kernel's `statfs` magic. Every guarantee the product gives about a crash
 * rests on two things a network or user-space file system does not keep:
 * SQLite's write-ahead log shares memory between the processes that open it,
 * which SQLite itself does not support over a network file system; and a
 * holder's death is proved by the kernel dropping its `flock`, which a remote
 * lock only approximates. So these are refused, rather than run with a weaker
 * guarantee the Human was never told of (REC-004). */
export const NON_LOCAL_FILESYSTEMS: Readonly<Record<number, string>> = Object.freeze({
  0x6969: "NFS", 0x517b: "SMB", 0xff534d42: "CIFS", 0xfe534d42: "SMB2", 0x65735546: "FUSE",
  0x01021997: "9P", 0x00c36400: "Ceph", 0x5346414f: "AFS", 0x6b414653: "AFS", 0x73757245: "Coda", 0x564c: "NCP",
});

/** The judgement of a state root: a normalized, symlink-free path (VAL-002,
 * FS-005) on a local kernel file system (S-06). The file system is read at
 * the deepest part of the path that exists, since startup creates the rest
 * beneath it. */
export function assertStateRoot(stateRoot: string, statfs: (path: string) => { type: number } = statfsSync): void {
  assertHostDirectoryLayout(stateRoot, true);
  let existing = stateRoot;
  while (lstatSync(existing, { throwIfNoEntry: false }) === undefined) existing = dirname(existing);
  let type: number;
  try { type = statfs(existing).type; }
  catch (cause) { throw unobserved(cause, "the state root's file system") ?? new StoreError("UNSUPPORTED_PROFILE", "the state root's file system cannot be read", { cause }); }
  const name = NON_LOCAL_FILESYSTEMS[type];
  if (name !== undefined)
    throw new StoreError("UNSUPPORTED_PROFILE",
      `the state root is on a ${name} file system; a society's state must be on a local disk (its store and its locks are only sound there)`);
}

/** D03: where one society lives on this host, decided once by the process that
 * starts it and handed explicitly to everything it launches. A unit-started
 * process runs in the user manager's environment, which need not be the one the
 * product was started in, so nothing below the host re-derives these. */
export interface LaunchLocation {
  readonly society: string;
  readonly stateRoot: string;
  readonly runRoot: string;
  readonly configPath: string;
}

/** The host's own derivation: XDG roots from its environment, the config path
 * the Human named (made absolute against the host's directory) or the state
 * root's default. Only entrypoints a Human or operator starts call this. */
export function hostLaunchLocation(society: string, env: NodeJS.ProcessEnv, configPath?: string): LaunchLocation {
  const stateRoot = join(env.XDG_DATA_HOME ?? join(env.HOME ?? "/tmp", ".local", "share"), "oma", society);
  const runRoot = join(env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
  return Object.freeze({ society, stateRoot, runRoot,
    configPath: configPath === undefined ? join(stateRoot, "config.json") : resolve(configPath) });
}

export const LAUNCH_LOCATION_FLAGS = Object.freeze({ configPath: "--config", stateRoot: "--state-root", runRoot: "--run-root" } as const);

/** The argv form of a location, exactly what a launched entry must receive. */
export function launchLocationArgv(location: LaunchLocation): string[] {
  return [LAUNCH_LOCATION_FLAGS.configPath, location.configPath,
    LAUNCH_LOCATION_FLAGS.stateRoot, location.stateRoot, LAUNCH_LOCATION_FLAGS.runRoot, location.runRoot];
}

/** One part of a launched entry's location. It must be given exactly once,
 * and a root must name this society. There is no environment fallback -- a
 * missing part is the silent default D03 forbids, so it is refused. */
export function launchedPath(args: readonly string[], part: keyof typeof LAUNCH_LOCATION_FLAGS, society: string): string {
  const flag = LAUNCH_LOCATION_FLAGS[part];
  const at = args.indexOf(flag);
  const value = at < 0 ? undefined : args[at + 1];
  if (value === undefined || args.indexOf(flag, at + 1) >= 0 || !isAbsolute(value) || value.includes("\0") || normalize(value) !== value)
    throw new StoreError("UNSUPPORTED_PROFILE", `launch location ${flag} must be given once as a normalized absolute path`);
  if (part !== "configPath" && (basename(value) !== society || basename(dirname(value)) !== "oma"))
    throw new StoreError("UNSUPPORTED_PROFILE", `launch location ${flag} does not name this society`);
  return value;
}

export function launchedLocation(args: readonly string[], society: string): LaunchLocation {
  return Object.freeze({ society, configPath: launchedPath(args, "configPath", society),
    stateRoot: launchedPath(args, "stateRoot", society), runRoot: launchedPath(args, "runRoot", society) });
}
