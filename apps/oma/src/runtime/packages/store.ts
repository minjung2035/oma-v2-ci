import { createEnginePackageDiscovery } from "@oma/engine/package-resources";
import { PACKAGE_LOCAL_DIR } from "@oma/domain/package-policy";
export { PACKAGE_LOCAL_DIR } from "@oma/domain/package-policy";
/** DR25: the Pi packages the Human installs for oma.
 *
 * `oma pi install <source>` runs the bundled engine's own package manager
 * over one store beside every session, never the user's `~/.pi`. The store
 * holds package code and the package manager's own list of what it installed,
 * and nothing else: no login, no session. Every engine of every session reads
 * an extension from it only when a role's extensions name it (TUI-010), by the
 * file and digest the configuration loader pins, and a Resident's sandbox
 * mounts it read-only.
 *
 * Which files of a package are extensions is the engine's rule (a package's
 * `pi` manifest or its conventional directories). It is asked once, after
 * every `oma pi` change, and its answer kept as the store's index, so a screen
 * that lists extensions reads a file instead of running the engine's resolver.
 */
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { StoreError, unobserved } from "@oma/domain/errors";
import { PACKAGE_ENTRY_PREFIX, extensionEntryProblem } from "@oma/config/operations";
import { readUserFile, replaceUserFile } from "../user-files.js";
import { listOwnedDirectory, repairOwnedEntryMode } from "@oma/storage/directory";
import type { PackageDirectories } from "../../ports/package-files.js";

/** The store's directory name, beside the engine home and every session. */
export const PACKAGE_STORE = ".packages";
/** The store's index of extension entries, by package. */
export const PACKAGE_INDEX = "oma-extensions.json";
export const PACKAGE_INDEX_KIND = "oma-installed-packages-v1";
/** UX-20: how large the index may be, written and read alike -- a DoS ceiling
 * for bytes placed into the store, never the size a real install is meant to
 * reach. One entry names one resource file with a `packages:` path, so this
 * bound is the same order as the authored configuration source's
 * (CONFIGURATION_SOURCE_LIMITS.bytes): tens of thousands of indexed
 * extensions, skills, prompts and themes fit inside it. The writer enforces
 * it too, so a change that would overflow it is refused at install instead of
 * leaving a store nothing can read back. */
export const PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

/** UX-20: how large the engine's package list (`settings.json` in the store)
 * may be when pruning asks it what stays. The file names one line per
 * installed package; this is a DoS ceiling, never the size a real store is
 * meant to reach. */
export const PACKAGE_SETTINGS_BYTES = 1024 * 1024;

/** Where the packages are, for a society state root under oma's data directory. */
export function packageStoreDir(stateRoot: string): string {
  return join(dirname(stateRoot), PACKAGE_STORE);
}

/** One installed package and the resources it contributes: extension entries
 * a role may name, and the skills, prompt templates and themes every engine
 * of the installation is shown (C18). All entries are `packages:`-prefixed
 * paths relative to the store root; files and directories both appear, and
 * each current record carries every resource list explicitly. */
export interface InstalledPackage {
  readonly source: string;
  readonly entries: readonly string[];
  readonly skills: readonly string[];
  readonly prompts: readonly string[];
  readonly themes: readonly string[];
}

import type { PackageResourcePaths } from "@oma/contracts/assets";

/** The package commands `oma pi` runs, and why the others are not run. */
export type PackageCommand =
  | { readonly kind: "run"; readonly command: "install" | "remove" | "update" | "list"; readonly args: readonly string[];
      /** C20: a path on this machine `install` was given -- staged into the
       * store by the caller (local-package.ts), never installed where it lies. */
      readonly local?: string;
      }
  | { readonly kind: "refused"; readonly words: string };

export { PACKAGE_USAGE } from "@oma/domain/package-policy";
import { PACKAGE_USAGE } from "@oma/domain/package-policy";

/** A source the engine's package manager fetches into the store itself. A
 * local path is copied in by staging first (C20), so it is not one. */
const REMOTE_SOURCE = /^(?:npm:|git:|https?:\/\/|ssh:\/\/|git@)/;

/** DR25: what `oma pi <args>` runs. Everything the engine's package manager
 * does over the store runs as it ships; refused are only what would reach
 * past oma -- a project's own `.pi/` (the user's Pi's), the engine itself,
 * which oma's installation pins, and anything that is not a package command. */
export function packageCommand(args: readonly string[]): PackageCommand {
  const [name, ...rest] = args;
  const refused = (words: string): PackageCommand => Object.freeze({ kind: "refused", words: `${words}\n${PACKAGE_USAGE}` });
  const command = name;
  if (command !== "install" && command !== "remove" && command !== "update" && command !== "list") {
    if (name === "config") return refused("Extensions are turned on and off for the Principal and Workers in oma's settings (Ctrl+X > Config > Extensions).");
    return refused(name === undefined ? "oma pi runs the engine's package commands for oma." : `oma pi does not run the engine's "${name}"; oma is the session.`);
  }
  const given = new Set<string>();
  const positional: string[] = [];
  const forwarded = [name!];
  let extension: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    const option = word === "-h" ? "--help" : word;
    if (["-l", "--local", "-a", "--approve", "-na", "--no-approve"].includes(option))
      return refused("A project's local packages are the user's Pi's (its .pi folder), not oma's; oma's packages are installed for every project.");
    if (["--self", "--all", "--force", "--models"].includes(option))
      return refused("The engine is updated with oma itself; oma pi update updates installed packages.");
    if (option.startsWith("-")) {
      if (option === "--project" || option === "--host-only")
        return refused("VM package selectors have been retired; native sessions use the common local package store.");
      if (option !== "--help" && !(command === "update" && ["--extensions", "--extension"].includes(option)))
        return refused(`Unknown package option ${word}.`);
      if (given.has(option)) return refused(`${option} must be given once.`);
      given.add(option);
      if (option === "--extension") {
        const value = rest[++index];
        if (!value || value.includes("\0")) return refused(`${option} requires a value.`);
          // The pinned package manager cannot represent an option-like source.
          // Refuse it, rather than forwarding it as a different engine option.
          if (value.startsWith("-")) return refused("--extension requires a package source, not an engine option.");
          extension = value; forwarded.push(word, value);
      } else forwarded.push(word);
    } else {
      if (!word || word.includes("\0")) return refused("A package source must be nonempty.");
      positional.push(word); forwarded.push(word);
    }
  }
  if (positional.length > 1 || (command === "list" && positional.length > 0)) return refused(`oma pi ${name} has too many sources.`);
  if (command === "update") {
    if (Number(extension !== undefined) + Number(given.has("--extensions")) + positional.length > 1)
      return refused("Choose one package update target.");
    if (positional.some(arg => arg === "pi" || arg === "self") ||
        (!given.has("--help") && extension === undefined && !given.has("--extensions") && positional.length === 0))
      return refused("The engine is updated with oma itself; oma pi update updates installed packages.");
  }
  let local: string | undefined;
  if (!given.has("--help") && (command === "install" || command === "remove")) {
    if (positional.length !== 1) return refused(`oma pi ${name} takes one source.`);
    // C20: a local path is not installed where it lies -- a Resident's
    // sandbox could not see it there, and a store the source could edit after
    // the fact would pin nothing. The caller copies it into the store first
    // (local-package.ts) and the engine installs that copy as `local/<name>`,
    // so its resources land inside the read-only mount under the same
    // indexing and pinning as a remote package's.
    if (command === "install" && !REMOTE_SOURCE.test(positional[0]!)) local = positional[0];
  }
  return Object.freeze({ kind: "run", command, args: Object.freeze(forwarded), ...(local === undefined ? {} : { local }) });
}

/** The package sources the store's own `settings.json` names -- the package
 * manager's list, which is the authority on what staged copies stay. */
export function configuredPackageSources(store: string): readonly string[] {
  const file = readUserFile(join(store, "settings.json"), PACKAGE_SETTINGS_BYTES);
  if (file === null) return Object.freeze([]);
  let value: unknown;
  try { value = JSON.parse(file); } catch { throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed"); }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed");
  const packages = (value as { packages?: unknown }).packages;
  if (packages === undefined) return Object.freeze([]);
  if (!Array.isArray(packages)) throw new StoreError("STORE_CORRUPT", "the package store's settings are malformed");
  return Object.freeze(packages.map(pkg =>
    typeof pkg === "string" ? pkg
      : pkg !== null && typeof pkg === "object" && typeof (pkg as { source?: unknown }).source === "string" ? (pkg as { source: string }).source
      : null).filter((source): source is string => source !== null));
}

/** Resolve the configured local package store without changing existing data. */
export function packageStoreRoot(store: string): string | null {
  try {
    return realpathSync(store);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw unobserved(error, "the package store") ?? error;
  }
}

/** `rel` (what `relative(root, x)` answered) leaves its root when it is
 * absolute or its first component is `..` -- a name merely starting with the
 * two characters ("..foo") stays inside. One rule for the store boundary
 * check, the stage prune and the index's preflight, which must agree on what
 * a configured source names. */
export function escapes(rel: string): boolean {
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** A `packages:`-prefixed normalized relative path under the store. Unlike an
 * extension entry a resource may be a directory or a file of any kind, so the
 * suffix rule does not apply; containment and spelling still do. */
export function resourceEntryProblem(entry: unknown): string | null {
  if (typeof entry !== "string" || !entry.startsWith(PACKAGE_ENTRY_PREFIX))
    return "package resource must be a packages: path";
  const path = entry.slice(PACKAGE_ENTRY_PREFIX.length);
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path) ||
      path.split("/").some(part => !part || part === "." || part === ".."))
    return "package resource must be a normalized relative path";
  return null;
}
/** Every current resource field is an explicit list of unique normalized entries. */
function resourceList(value: unknown, invalid: () => never): readonly string[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(entry => resourceEntryProblem(entry) !== null))
    return invalid();
  return Object.freeze([...(value as string[])]);
}

/** The index bytes, with a file that outgrew the bound said as the limit it
 * is rather than as corruption: `readUserFile` reports both an irregular file
 * and an oversized one identically, so the oversized regular file is told
 * apart here and the refusal names the configured bound. */
function indexBytes(path: string): string | null {
  try { return readUserFile(path, PACKAGE_INDEX_BYTES); }
  catch (error) {
    if (error instanceof StoreError && error.code === "STORE_CORRUPT") {
      const observed = lstatSync(path, { throwIfNoEntry: false });
      if (observed?.isFile() && observed.size > PACKAGE_INDEX_BYTES)
        throw new StoreError("LIMIT_EXCEEDED", `the installed-package index exceeds its ${PACKAGE_INDEX_BYTES}-byte bound`);
    }
    throw error;
  }
}

/** Read the current local index; retired VM generation trees are never swept. */
export function readPackageIndex(store: string): readonly InstalledPackage[] {
  const root = packageStoreRoot(store);
  if (root === null) return Object.freeze([]);
  const file = indexBytes(join(root, PACKAGE_INDEX));
  if (file === null) return Object.freeze([]);
  let value: unknown;
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "the installed-package index is malformed"); };
  try { value = JSON.parse(file); } catch { return invalid(); }
  if (Array.isArray(value) || value !== null && typeof value === "object" &&
      typeof (value as Record<string, unknown>).kind === "string" && (value as Record<string, unknown>).kind !== PACKAGE_INDEX_KIND)
    throw new StoreError("UNSUPPORTED_PROFILE", "installed-package index format is unsupported; use a new development state directory");
  if (value === null || typeof value !== "object" || Object.keys(value).sort().join(",") !== "kind,packages" ||
      (value as Record<string, unknown>).kind !== PACKAGE_INDEX_KIND) return invalid();
  return decodePackageIndex((value as Record<string, unknown>).packages);
}

/** The same schema validates the live index and a request's saved before-image. */
export function decodePackageIndex(value: unknown): readonly InstalledPackage[] {
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "the installed-package index is malformed"); };
  if (!Array.isArray(value)) return invalid();
  const packages: InstalledPackage[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Object.keys(entry).sort().join(",") !== "entries,prompts,skills,source,themes") return invalid();
    const { source, entries, skills, prompts, themes } = entry as
      { source?: unknown; entries?: unknown; skills?: unknown; prompts?: unknown; themes?: unknown };
    if (typeof source !== "string" || !source || packages.some(item => item.source === source) || !Array.isArray(entries) ||
        new Set(entries).size !== entries.length || entries.some(item => typeof item !== "string" || !item.startsWith(PACKAGE_ENTRY_PREFIX) || extensionEntryProblem(item) !== null)) return invalid();
    packages.push(Object.freeze({ source, entries: Object.freeze([...entries as string[]]),
      skills: resourceList(skills, invalid), prompts: resourceList(prompts, invalid), themes: resourceList(themes, invalid) }));
  }
  return Object.freeze(packages);
}

/** The file codec is single-version; same-build before-images use the strict DTO decoder. */
export function encodePackageIndex(packages: readonly InstalledPackage[]): string {
  return `${JSON.stringify({ kind: PACKAGE_INDEX_KIND, packages: decodePackageIndex(packages) }, null, 2)}\n`;
}

/** Every resource the installed packages hold, as absolute paths under the
 * store's real root -- the lists an engine's argv names (C18). Paths are the
 * index's own, so an entry that escaped the store was refused when indexed. */
export function packageResourcePaths(store: string | undefined): PackageResourcePaths | undefined {
  if (store === undefined) return undefined;
  const root = packageStoreRoot(store);
  if (root === null) return undefined;
  const index = readPackageIndex(root);
  const collect = (pick: (item: InstalledPackage) => readonly string[] | undefined): readonly string[] => {
    const paths: string[] = [];
    for (const item of index)
      for (const entry of pick(item) ?? [])
        paths.push(join(root, entry.slice(PACKAGE_ENTRY_PREFIX.length)));
    return Object.freeze(paths.sort());
  };
  const skills = collect(item => item.skills);
  const prompts = collect(item => item.prompts);
  const themes = collect(item => item.themes);
  if (skills.length === 0 && prompts.length === 0 && themes.length === 0) return undefined;
  return Object.freeze({ skills, prompts, themes });
}

/** Asks the engine which files of each installed package are which resource
 * -- extensions, and (C18) skills, prompt templates and themes too -- and
 * keeps the answer as the store's index. A path outside the store, or reached
 * through a link, is no entry: no Resident could be shown it. Extensions
 * additionally keep their file-and-suffix rule; a skill may be a directory. */
export async function writePackageIndex(store: string, directories: PackageDirectories = {
  list: listOwnedDirectory, repair: path => repairOwnedEntryMode(path) !== null,
}): Promise<readonly InstalledPackage[]> {
  const manager = await createEnginePackageDiscovery(store);
  // `local/` is oma's own staged tree, so before the engine lists it the
  // entries a same-UID stray or an interrupted writer left without owner
  // bits get them back -- the same repair the prune's listing makes, and
  // one the engine's own readdir never could: without it a mode-000
  // `local/` is indexed whole as `entries: []`, a degraded index a role
  // then reconciles against and loses what the package carried. The walk
  // reaches each configured copy through its intermediate directories --
  // a mode-000 `local/@scope` above `local/@scope/pkg` is repaired, not
  // read as absence -- and a file that lost its owner read/write bits is
  // given them back where the walk already visits it. What a configured
  // source needs but cannot be observed -- an unlistable directory, a
  // non-directory where a directory must be, a stage that is no directory
  // at all, a file that stays unreadable -- is refused rather than written
  // as that empty truth: the index as last written stays the record a
  // later whole read replaces. A configured copy that is absent is simply
  // absent, and is indexed as such.
  // The store's real root is the spelling the sources are resolved against
  // -- the same spelling the prune's `relative` math uses, so both sides
  // agree on what a configured source names.
  const base = realpathSync(store);
  const local = join(base, PACKAGE_LOCAL_DIR);
  const list = directories.list;
  const repairEntryMode = directories.repair;
  const unavailable = (what: string): never => {
    throw new StoreError("BROKER_UNAVAILABLE", `${what}; the package index was not written`);
  };
  /** A name that cannot be observed keeps being present -- absence is only
   * ever the filesystem's own answer, never an error's. */
  const present = (path: string): boolean => {
    try { return lstatSync(path, { throwIfNoEntry: false }) !== undefined; }
    catch { return true; }
  };
  /** A staged file's owner read/write bits back where a stray dropped
   * them; false when the file is still there but cannot take them -- a
   * copy it sits in cannot be read whole. Absent is only ever the
   * filesystem's own ENOENT answer (`throwIfNoEntry` answering undefined):
   * an lstat error or a name that answers as another kind is "present but
   * not the file", never "absent" -- the same split `present` keeps. */
  const repairFile = (path: string): boolean => {
    let observed;
    try { observed = lstatSync(path, { throwIfNoEntry: false }); }
    catch { return false; }
    if (observed === undefined) return true;
    if (!observed.isFile()) return false;
    if ((observed.mode & 0o600) === 0o600) return true;
    return repairEntryMode(path) || !present(path);
  };
  /** `dir` and every directory beneath it, repaired then listed, and every
   * regular file's owner bits put back where a stray dropped them; false
   * where a directory could not be listed or a file could not be repaired
   * even so. */
  const repair = (dir: string): boolean => {
    const entries = list(dir);
    if (entries === null) return false;
    let intact = true;
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (!repair(path)) intact = false; }
      else if (entry.isFile() && !repairFile(path)) intact = false;
    }
    return intact;
  };
  const sources = configuredPackageSources(store);
  /** The staged copies the configured sources name, computed the way the
   * prune computes them: the source spelling resolved against the store's
   * real root and taken relative to `local/`. An absolute spelling,
   * `local/../local/x`, `local/./x`, `local//x`, `local/x/` all land on the
   * same `x` the sweep keeps and the engine resolves -- a lexical `local/`
   * prefix read never reached them, so a degrade under one committed as the
   * empty truth. `local` itself (relative "") is keep-whole, as it is for
   * the sweep; a spelling escaping `local/` names nothing here. */
  const copies: string[] = [];
  let whole = false;
  for (const source of sources) {
    const resolved = isAbsolute(source) ? source : join(base, source);
    const inside = relative(local, resolved);
    if (inside === "") { whole = true; continue; }
    if (!escapes(inside) && !copies.includes(inside)) copies.push(inside);
  }
  const localStat = (() => {
    try { return lstatSync(local, { throwIfNoEntry: false }); } catch { return null; }
  })();
  if (localStat?.isDirectory() === true) {
    const top = list(local);
    if (top === null) {
      if (copies.length > 0 || whole)
        unavailable("the local package stage cannot be listed");
    } else {
      if (whole && !repair(local))
        unavailable("the local package stage cannot be listed");
      for (const inside of copies) {
        const source = `${PACKAGE_LOCAL_DIR}/${inside}`;
        const components = inside.split("/");
        let dir = local, entries = top;
        for (const [index, component] of components.entries()) {
          const entry = entries.find(item => item.name === component);
          // A component that is not there means the configured copy is
          // absent -- indexed as absent, the truth it is.
          if (entry === undefined) break;
          const path = join(dir, component);
          if (index === components.length - 1) {
            // The leaf is the staged copy itself: a directory is repaired
            // and listed whole, the one file a lone extension stages as
            // gets its owner bits back, anything else is no staged copy.
            if (entry.isDirectory()) {
              if (!repair(path)) unavailable(`the staged copy of ${source} cannot be listed`);
            } else if (!entry.isFile() || !repairFile(path))
              unavailable(`the staged copy of ${source} cannot be read`);
            break;
          }
          // An intermediate that is present and not a directory holds no
          // staged copy beneath it; the copy is unreachable, not absent.
          if (!entry.isDirectory()) unavailable(`the staged copy of ${source} cannot be reached`);
          const next = list(path);
          if (next === null) unavailable(`the staged copy of ${source} cannot be listed`);
          else { dir = path; entries = next; }
        }
      }
    }
  } else if (localStat !== undefined && (copies.length > 0 || whole))
    // `local` that cannot be observed or is not a directory is the same
    // refusal an unlistable one is -- never the empty truth its configured
    // sources would be indexed as.
    unavailable(localStat === null ? "the local package stage cannot be observed" : "the local package stage is not a directory");
  const resolved = await manager.resolve();
  const indexed = (resources: readonly { path: string; enabled: boolean; metadata: { source: string; scope: string } }[],
    fileOnly: boolean): Map<string, string[]> => {
    const bySource = new Map<string, string[]>();
    for (const resource of resources) {
      if (!resource.enabled || resource.metadata.scope !== "user") continue;
      let real: string;
      try { real = realpathSync(resource.path); }
      catch (error) {
        // Only the filesystem's own ENOENT names nothing -- a resource the
        // engine listed that is not there indexes as absent, the truth it
        // is. Every other failure -- EACCES on a component, an I/O error --
        // is an observation that did not finish, and the write is refused
        // rather than committed without what the package still holds.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unavailable(`a resource of ${resource.metadata.source} cannot be observed`);
        continue;
      }
      const inside = relative(base, real);
      if (real !== resource.path || !inside || inside.startsWith("..") || isAbsolute(inside)) continue;
      let stat;
      try { stat = lstatSync(real); }
      catch (error) {
        // The name the realpath just answered vanished between the two
        // observations -- absent, the truth it is. Anything else did not
        // finish, and the write is refused the same way.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          unavailable(`a resource of ${resource.metadata.source} cannot be observed`);
        continue;
      }
      if (fileOnly && (!stat.isFile() || !/\.(?:js|mjs|ts)$/.test(real))) continue;
      if (!fileOnly && !stat.isFile() && !stat.isDirectory()) continue;
      const list = bySource.get(resource.metadata.source) ?? [];
      list.push(`${PACKAGE_ENTRY_PREFIX}${inside}`);
      bySource.set(resource.metadata.source, list);
    }
    return bySource;
  };
  const extensions = indexed(resolved.extensions, true);
  const skills = indexed(resolved.skills, false);
  const prompts = indexed(resolved.prompts, false);
  const themes = indexed(resolved.themes, false);
  const entries = (bySource: Map<string, string[]>, source: string): readonly string[] =>
    Object.freeze([...(bySource.get(source) ?? [])].sort());
  const packages = manager.configuredPackages().filter(entry => entry.scope === "user")
    .map(entry => Object.freeze({ source: entry.source, entries: entries(extensions, entry.source),
      skills: entries(skills, entry.source), prompts: entries(prompts, entry.source), themes: entries(themes, entry.source) }));
  const text = encodePackageIndex(packages);
  // The reader's bound is the writer's too: a change whose index would not
  // read back is refused here, never left as a store nothing can read.
  if (Buffer.byteLength(text) > PACKAGE_INDEX_BYTES)
    throw new StoreError("LIMIT_EXCEEDED", `the installed-package index exceeds its ${PACKAGE_INDEX_BYTES}-byte bound`);
  replaceUserFile(join(store, PACKAGE_INDEX), text);
  return Object.freeze(packages);
}

/** DR25: a role's entries after the store changed from `before` to `after`.
 * A package the role used keeps being used, by the entries it has now; one
 * that is gone is dropped; entries of no package the store held are the
 * role's own and stay as they are. */
export function reconciledEntries(entries: readonly string[], before: readonly InstalledPackage[],
  after: readonly InstalledPackage[]): readonly string[] {
  const now = new Map(after.map(item => [item.source, item.entries]));
  const owner = new Map<string, string>();
  for (const item of before) for (const entry of item.entries) owner.set(entry, item.source);
  const out: string[] = [];
  const used = new Set<string>();
  for (const entry of entries) {
    const source = owner.get(entry);
    if (source === undefined) { if (!out.includes(entry)) out.push(entry); continue; }
    if (used.has(source)) continue;
    used.add(source);
    for (const current of now.get(source) ?? []) if (!out.includes(current)) out.push(current);
  }
  return Object.freeze(out);
}

/** An explicit install selects that source again; update preserves disabled roles. */
export function packageActivation(command: PackageCommand): string | undefined {
  if (command.kind !== "run" || command.command !== "install") return undefined;
  return command.args.slice(1).find(arg => !arg.startsWith("-"));
}

/** `oma pi list` says what each installed package carries, not only that it
 * is installed (UX-15): counts of the four resource kinds the engines get
 * (C18), so a package that is not only extensions is visible as such. */
export function packageListLines(store: string): readonly string[] {
  const lines: string[] = [];
  for (const item of readPackageIndex(store)) {
    const kinds = ([
      [item.entries.length, "extension"],
      [(item.skills ?? []).length, "skill"],
      [(item.prompts ?? []).length, "prompt template"],
      [(item.themes ?? []).length, "theme"],
    ] as const).filter(([count]) => count > 0)
      .map(([count, noun]) => `${count} ${noun}${count === 1 ? "" : "s"}`);
    lines.push(`${item.source}: ${kinds.length === 0 ? "no loadable resources" : kinds.join(", ")}`);
  }
  return Object.freeze(lines);
}
