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
import { dirname, isAbsolute, join, relative } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { StoreError, unobserved } from "../domain/errors.js";
import { PACKAGE_ENTRY_PREFIX, extensionEntryProblem } from "../config/operations.js";
import { readUserFile, replaceUserFile } from "./user-files.js";
import { isUuid } from "../protocol/host-guest.js";

/** The store's directory name, beside the engine home and every session. */
export const PACKAGE_STORE = ".packages";
/** On macOS the engine's store is a link to one of these: the packages the
 * Mac installed, each published whole under the digest of what arrived. */
export const PACKAGE_GENERATIONS = ".packages-generations";
/** The store's index of extension entries, by package. */
export const PACKAGE_INDEX = "oma-extensions.json";
/** UX-20: how large the index may be, written and read alike -- a DoS ceiling
 * for bytes placed into the store, never the size a real install is meant to
 * reach. One entry names one resource file with a `packages:` path, so this
 * bound is the same order as the authored configuration source's
 * (CONFIGURATION_SOURCE_LIMITS.bytes): tens of thousands of indexed
 * extensions, skills, prompts and themes fit inside it. The writer enforces
 * it too, so a change that would overflow it is refused at install instead of
 * leaving a store nothing can read back. */
export const PACKAGE_INDEX_BYTES = 8 * 1024 * 1024;

/** Where the packages are, for a society state root under oma's data directory. */
export function packageStoreDir(stateRoot: string): string {
  return join(dirname(stateRoot), PACKAGE_STORE);
}

/** One installed package and the resources it contributes: extension entries
 * a role may name, and the skills, prompt templates and themes every engine
 * of the installation is shown (C18). All entries are `packages:`-prefixed
 * paths relative to the store root; files and directories both appear, and
 * an index written before resources were indexed reads as empty lists. */
export interface InstalledPackage {
  readonly source: string;
  readonly entries: readonly string[];
  readonly skills?: readonly string[];
  readonly prompts?: readonly string[];
  readonly themes?: readonly string[];
}

/** The package resources of one store, resolved to host paths: what an
 * engine's argv names so Pi's loader discovers them (C18). */
export interface PackageResourcePaths {
  readonly skills: readonly string[];
  readonly prompts: readonly string[];
  readonly themes: readonly string[];
}

/** The package commands `oma pi` runs, and why the others are not run. */
export type PackageCommand =
  | { readonly kind: "run"; readonly command: "install" | "remove" | "update" | "list"; readonly args: readonly string[];
      /** C20: a path on this machine `install` was given -- staged into the
       * store by the caller (local-package.ts), never installed where it lies. */
      readonly local?: string;
      readonly projectId?: string; readonly hostOnly?: true }
  | { readonly kind: "refused"; readonly words: string };

export const PACKAGE_USAGE = "usage: oma pi install <npm:… | git:… | https://… | ssh://… | local dir, tarball or file>\n" +
  "       oma pi remove <source>\n" +
  "       oma pi update <source> | --extension <source> | --extensions\n" +
  "       oma pi list\n" +
  "Packages carry extensions, skills, prompt templates and themes; a local path is copied into the store.";

/** Where staged local-package copies live in the store, beside `npm/` and
 * `git/` (C20; local-package.ts does the staging). */
export const PACKAGE_LOCAL_DIR = "local";

/** A source the engine's package manager fetches into the store itself. A
 * local path is copied in by staging first (C20), so it is not one. */
const REMOTE_SOURCE = /^(?:npm:|git:|https?:\/\/|ssh:\/\/|git@)/;

/** The recorded name of a staged local package: `local/` followed by the
 * normalized relative path a `packages:` resource entry would accept. */
export function localPackageSource(source: string): boolean {
  return source.startsWith(`${PACKAGE_LOCAL_DIR}/`) &&
    resourceEntryProblem(`${PACKAGE_ENTRY_PREFIX}${source}`) === null;
}

/** A source the store may hold installed: a remote source the package manager
 * fetches, or a staged local copy's `local/<name>` (C20). The name the
 * packages.sync/packages.replace `activate` field and the index accept. */
export function installedPackageSource(source: string): boolean {
  return REMOTE_SOURCE.test(source) || localPackageSource(source);
}

/** DR25: what `oma pi <args>` runs. Everything the engine's package manager
 * does over the store runs as it ships; refused are only what would reach
 * past oma -- a project's own `.pi/` (the user's Pi's), the engine itself,
 * which oma's installation pins, and anything that is not a package command. */
export function packageCommand(args: readonly string[], macProject = false): PackageCommand {
  const [name, ...rest] = args;
  const refused = (words: string): PackageCommand => Object.freeze({ kind: "refused", words: `${words}\n${PACKAGE_USAGE}` });
  const command = name === "uninstall" ? "remove" : name;
  if (command !== "install" && command !== "remove" && command !== "update" && command !== "list") {
    if (name === "config") return refused("Extensions are turned on and off for the Principal and Workers in oma's settings (Ctrl+X > Config > Extensions).");
    return refused(name === undefined ? "oma pi runs the engine's package commands for oma." : `oma pi does not run the engine's "${name}"; oma is the session.`);
  }
  const given = new Set<string>();
  const positional: string[] = [];
  const forwarded = [name!];
  let extension: string | undefined, projectId: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index]!;
    const option = word === "-h" ? "--help" : word;
    if (["-l", "--local", "-a", "--approve", "-na", "--no-approve"].includes(option))
      return refused("A project's local packages are the user's Pi's (its .pi folder), not oma's; oma's packages are installed for every project.");
    if (["--self", "--all", "--force", "--models"].includes(option))
      return refused("The engine is updated with oma itself; oma pi update updates installed packages.");
    if (option.startsWith("-")) {
      if (option !== "--help" && !(command === "update" && ["--extensions", "--extension"].includes(option)) && !(macProject && ["--project", "--host-only"].includes(option)))
        return refused(`Unknown package option ${word}.`);
      if (given.has(option)) return refused(`${option} must be given once.`);
      given.add(option);
      if (option === "--extension" || option === "--project") {
        const value = rest[++index];
        if (!value || value.includes("\0")) return refused(`${option} requires a value.`);
        if (option === "--project") {
          if (!isUuid(value)) return refused("--project names a project by its id.");
          projectId = value;
        } else {
          // The pinned package manager cannot represent an option-like source.
          // Refuse it, rather than forwarding it as a different engine option.
          if (value.startsWith("-")) return refused("--extension requires a package source, not an engine option.");
          extension = value; forwarded.push(word, value);
        }
      } else if (option !== "--host-only") forwarded.push(word);
    } else {
      if (!word || word.includes("\0")) return refused("A package source must be nonempty.");
      positional.push(word); forwarded.push(word);
    }
  }
  if (given.has("--host-only") && projectId !== undefined) return refused("--host-only does not select a Society project.");
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
  return Object.freeze({ kind: "run", command, args: Object.freeze(forwarded), ...(local === undefined ? {} : { local }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(given.has("--host-only") ? { hostOnly: true as const } : {}) });
}

/** The store's directory itself: on macOS the engine's store is a link to its
 * current generation (DR25), which the store's own files are read beneath. */
export function packageStoreRoot(store: string): string | null {
  try { return realpathSync(store); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw unobserved(error, "the package store") ?? error;
  }
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
/** An optional list field of one index entry: absent means none (an index
 * written before resources were indexed), anything else must be a list of
 * unique well-formed resource entries. */
function resourceList(value: unknown, invalid: () => never): readonly string[] {
  if (value === undefined) return Object.freeze([]);
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

/** The store's index as last written, or none. */
export function readPackageIndex(store: string): readonly InstalledPackage[] {
  const root = packageStoreRoot(store);
  if (root === null) return Object.freeze([]);
  const file = indexBytes(join(root, PACKAGE_INDEX));
  if (file === null) return Object.freeze([]);
  let value: unknown;
  const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "the installed-package index is malformed"); };
  try { value = JSON.parse(file); } catch { return invalid(); }
  if (!Array.isArray(value)) return invalid();
  const packages: InstalledPackage[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") return invalid();
    const { source, entries, skills, prompts, themes } = entry as
      { source?: unknown; entries?: unknown; skills?: unknown; prompts?: unknown; themes?: unknown };
    if (typeof source !== "string" || !source || packages.some(item => item.source === source) || !Array.isArray(entries) ||
        new Set(entries).size !== entries.length || entries.some(item => typeof item !== "string" || !item.startsWith(PACKAGE_ENTRY_PREFIX) || extensionEntryProblem(item) !== null)) return invalid();
    packages.push(Object.freeze({ source, entries: Object.freeze([...entries as string[]]),
      skills: resourceList(skills, invalid), prompts: resourceList(prompts, invalid), themes: resourceList(themes, invalid) }));
  }
  return Object.freeze(packages);
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
export async function writePackageIndex(store: string): Promise<readonly InstalledPackage[]> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const settingsManager = sdk.SettingsManager.create(store, store, { projectTrusted: false });
  const manager = new sdk.DefaultPackageManager({ cwd: store, agentDir: store, settingsManager });
  const resolved = await manager.resolve(async () => "skip");
  const base = realpathSync(store);
  const indexed = (resources: readonly { path: string; enabled: boolean; metadata: { source: string; scope: string } }[],
    fileOnly: boolean): Map<string, string[]> => {
    const bySource = new Map<string, string[]>();
    for (const resource of resources) {
      if (!resource.enabled || resource.metadata.scope !== "user") continue;
      let real: string;
      try { real = realpathSync(resource.path); } catch { continue; }
      const inside = relative(base, real);
      if (real !== resource.path || !inside || inside.startsWith("..") || isAbsolute(inside)) continue;
      const stat = lstatSync(real);
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
  const packages = manager.listConfiguredPackages().filter(entry => entry.scope === "user")
    .map(entry => Object.freeze({ source: entry.source, entries: entries(extensions, entry.source),
      skills: entries(skills, entry.source), prompts: entries(prompts, entry.source), themes: entries(themes, entry.source) }));
  const text = `${JSON.stringify(packages, null, 2)}\n`;
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
