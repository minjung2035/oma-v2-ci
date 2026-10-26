import { StoreError, exceptionText } from "@oma/domain/errors";
/** TUI-010: role-by-role extension selection over host-placed files and
 * (DR25) the packages the Human installed with `oma pi install`.
 *
 * This is not an installer. The list is what the host already put under
 * installation.libdir and what the package store's index names; there is no
 * arbitrary path entry, no network fetch and no Pi auto-discovery. The core OMA extension is always first and cannot be
 * cleared. Selected files carry the SHA-256 that the runner re-checks before
 * start, so a file swapped after selection fails closed rather than loading.
 *
 * WP14: what an entry may be, and whether the file it names is acceptable, is
 * the loader's single rule (`extensionListProblem`, `observeExtensionAsset`);
 * this screen asks it and never judges a path itself. Every change is one
 * managed generation (WP13), never a role-file write.
 */
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { loadConfigurationSnapshot, loadEditableConfiguration, type ConfigurationSnapshot } from "@oma/config";
import { extensionEntryProblem, extensionListProblem, observeExtensionAsset, type ExtensionRoots } from "@oma/config/operations";
import type { InstalledPackage } from "../runtime/packages/index.js";
import type { ManagedSource } from "@oma/config/generations";
import { commitManagedEdit } from "./settings.js";
import type { ExtensionRow } from "@oma/tui/model";
import { READ_BOUNDS } from "@oma/domain/surface-bounds";

export const CORE_EXTENSION = DEPLOYMENT_LAYOUT.extension;

export interface RoleFile {
  readonly name: string;
  readonly path: string;
  readonly extensions: readonly string[];
  /** Every other field of the authored role file, preserved verbatim; toggling
   * an extension must not silently drop an optional block the loader accepts.
   */
  readonly rest: Readonly<Record<string, unknown>>;
}

export interface ExtensionContext {
  readonly editable: boolean;
  readonly libdir: string;
  /** Where entries are: the installation, and (DR25) the installed packages. */
  readonly roots: ExtensionRoots;
  readonly principalRole: string | null;
  readonly workerRole: string | null;
  readonly roles: readonly RoleFile[];
  readonly rows: readonly ExtensionRow[];
  readonly reason: string | null;
  /** D02/WP13: the source a toggle is published against as a whole generation. */
  readonly snapshot: ManagedSource | null;
  /** WP14.03: "repair" when the configuration cannot load because a declared
   * extension file is missing; then only removing such a declaration is offered. */
  readonly mode: "full" | "repair";
  /** WP14.05: "partial" when the bounded scan stopped before seeing every
   * entry, or could not observe one. */
  readonly scan: "complete" | "partial";
}

/** Only files the host placed under libdir/extensions are candidates. The scan
 * follows no symlink, stops at a bounded depth and entry count, and says when it
 * stopped early; it never claims the list is complete when it is not.
 */
function scanLibdir(libdir: string): { readonly entries: readonly string[]; readonly partial: boolean } {
  const found: string[] = [];
  let examined = 0; let partial = false; let unobserved = false;
  const walk = (directory: string, depth: number): void => {
    if (partial) return;
    if (depth > READ_BOUNDS.extensionScanDepth.value) { partial = true; return; }
    let entries: readonly string[];
    // P0-5: a directory that could not be listed was not seen; the scan says so.
    try { entries = [...readdirSync(directory)].sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") unobserved = true; return; }
    for (const entry of entries) {
      if (++examined > READ_BOUNDS.extensionScanEntries.value) { partial = true; return; }
      const full = join(directory, entry);
      let stat;
      try { stat = lstatSync(full); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") unobserved = true; continue; }
      if (stat.isDirectory()) { walk(full, depth + 1); continue; }
      const rel = relative(libdir, full);
      if (!stat.isFile() || extensionEntryProblem(rel) !== null) continue;
      if (observeExtensionAsset({ libdir }, rel).kind !== "present") { unobserved = true; continue; }
      found.push(rel);
    }
  };
  walk(join(libdir, "extensions"), 0);
  return { entries: found.sort(), partial: partial || unobserved };
}

function rowsOf(available: readonly string[], principal: RoleFile | null, worker: RoleFile | null,
  missing: ReadonlySet<string>, sources: ReadonlyMap<string, string>): readonly ExtensionRow[] {
  return Object.freeze(available.map(id => Object.freeze({
    id,
    principal: principal ? principal.extensions.includes(id) : id === CORE_EXTENSION,
    workers: worker ? worker.extensions.includes(id) : id === CORE_EXTENSION,
    locked: id === CORE_EXTENSION,
    ...(missing.has(id) ? { missing: true } : {}),
    ...(sources.has(id) ? { source: sources.get(id)! } : {}),
  })));
}

const unmanaged = (reason: string): ExtensionContext => Object.freeze({
  editable: false, libdir: "", roots: Object.freeze({ libdir: "" }), principalRole: null, workerRole: null, roles: Object.freeze([]),
  rows: Object.freeze([Object.freeze({ id: CORE_EXTENSION, principal: true, workers: true, locked: true })]),
  reason, snapshot: null, mode: "full" as const, scan: "complete" as const,
});

export function readExtensions(source: string | ManagedSource, principalProfile: string, workerProfile: string | null,
  packages: readonly InstalledPackage[] = []): ExtensionContext {
  let snapshot: ManagedSource;
  let mode: "full" | "repair" = "full";
  try { snapshot = typeof source === "string" ? loadConfigurationSnapshot(source) : source; }
  catch (error) {
    const unreadable = error instanceof StoreError ? `Cannot read settings: ${exceptionText(error)}` : "Cannot read settings";
    // WP14.03: a configuration that fails only because a declared extension
    // file is gone can still be read as an editing input for its removal.
    if (typeof source !== "string") return unmanaged(unreadable);
    try { snapshot = loadEditableConfiguration(source); mode = "repair"; }
    catch { return unmanaged(unreadable); }
  }
  if (snapshot.layout.kind !== "operations")
    return unmanaged("Inline config.json has no per-role extensions");
  const libdir = snapshot.config.installation.libdir;
  const roots: ExtensionRoots = Object.freeze({ libdir, packages: snapshot.config.installation.packages });
  const roles: RoleFile[] = [];
  const missing = new Set<string>();
  for (const [name, authored] of Object.entries(snapshot.authoredRoles)) {
    const role = authored.value;
    const entries = role.extensions;
    if (extensionListProblem(entries) !== null)
      return unmanaged(`Invalid extensions format for role ${name}`);
    for (const entry of entries as string[]) if (observeExtensionAsset(roots, entry).kind === "missing") missing.add(entry);
    const { extensions: _authored, ...rest } = role;
    roles.push(Object.freeze({ name, path: authored.path,
      extensions: Object.freeze([...entries as string[]]), rest: Object.freeze(rest) }));
  }
  // WP14.03: an editing input read for its missing files (DR25: the project's
  // settings, read that way when a package was removed) is a repair input.
  if (typeof source !== "string" && missing.size > 0) mode = "repair";
  // A repair input exists only for the missing-file case; anything else that
  // keeps the configuration from loading is not this screen's to fix.
  if (mode === "repair" && missing.size === 0)
    return unmanaged("Cannot read settings: not caused by a missing extension file");
  const principal = roles.find(role => role.name === principalProfile) ?? null;
  // P0V-51: no Worker profile of its own means no Worker column to edit, never
  // the Principal's role under the Worker's name.
  const worker = workerProfile === null || workerProfile === principalProfile ? null : roles.find(role => role.name === workerProfile) ?? null;
  const scanned = scanLibdir(libdir);
  const referenced = new Set<string>([CORE_EXTENSION]);
  for (const role of roles) for (const entry of role.extensions) referenced.add(entry);
  for (const entry of scanned.entries) referenced.add(entry);
  // DR25: each installed package's extensions, named by the package they came from.
  const sources = new Map<string, string>();
  let partial = scanned.partial;
  if (roots.packages !== undefined) for (const item of packages) for (const entry of item.entries) {
    if (observeExtensionAsset(roots, entry).kind !== "present" && !referenced.has(entry)) { partial = true; continue; }
    referenced.add(entry); sources.set(entry, item.source);
  }
  const available = [CORE_EXTENSION, ...[...referenced].filter(id => id !== CORE_EXTENSION).sort()];
  const editable = principal !== null || worker !== null;
  return Object.freeze({
    editable, libdir, roots, principalRole: principal?.name ?? null, workerRole: worker?.name ?? null,
    roles: Object.freeze(roles), rows: rowsOf(available, principal, worker, missing, sources),
    reason: !editable ? "Role file is missing"
      : mode === "repair" ? "A missing extension file is declared. Only that declaration can be disabled"
      : partial ? "Could not scan all extensions (partial list)" : null,
    snapshot, mode, scan: partial ? "partial" : "complete",
  });
}

/** The core extension stays index 0 and is never removed. Enabling appends,
 * disabling removes the exact declaration; the authored order of every other
 * entry is kept (WP14.04).
 */
export function nextEntries(current: readonly string[], id: string, enabled: boolean): readonly string[] {
  if (id === CORE_EXTENSION) return current;
  const rest = current.filter(entry => entry !== CORE_EXTENSION && entry !== id);
  return Object.freeze([CORE_EXTENSION, ...rest, ...(enabled ? [id] : [])]);
}

export function toggleExtension(context: ExtensionContext, id: string, role: "principal" | "workers", enabled: boolean,
  ownedFrom?: string): void {
  if (!context.editable) throw new StoreError("UNSUPPORTED_PROFILE", "Extensions cannot be changed in this configuration format");
  if (id === CORE_EXTENSION) return;
  const name = role === "principal" ? context.principalRole : context.workerRole;
  if (name === null) throw new StoreError("UNSUPPORTED_PROFILE", `Target role file is missing: ${role}`);
  const target = context.roles.find(entry => entry.name === name);
  if (!target) throw new StoreError("STORE_CORRUPT", "role file disappeared between read and write");
  if (context.snapshot === null) throw new StoreError("UNSUPPORTED_PROFILE", "These settings cannot be changed without a snapshot");
  if (enabled) {
    if (context.mode === "repair")
      throw new StoreError("UNSUPPORTED_PROFILE", "Disable missing extension declarations first; other extensions cannot be enabled during recovery");
    // Only a host-placed file the loader itself accepts is enabled.
    const asset = observeExtensionAsset(context.roots, id);
    if (asset.kind !== "present")
      throw new StoreError("INVALID_REQUEST", `Extension is not selectable: ${id} (${asset.kind === "missing" ? "File missing" : asset.reason})`);
  } else {
    // WP14.03: removing a declaration needs no asset -- only the exact entry.
    if (!target.extensions.includes(id)) return;
    if (context.mode === "repair" && observeExtensionAsset(context.roots, id).kind !== "missing")
      throw new StoreError("UNSUPPORTED_PROFILE", "Only missing extension declarations can be disabled during recovery");
  }
  const entries = nextEntries(target.extensions, id, enabled);
  const problem = extensionListProblem(entries);
  if (problem !== null) throw new StoreError("LIMIT_EXCEEDED", problem);
  // D02/WP13: one generation from the source this screen read; the loader
  // proves the whole published candidate, and a source changed since that read
  // is refused rather than overwritten. `ownedFrom` is the commit's repair
  // boundary, named by the layer that knows where the bundle lives (P0-8).
  commitManagedEdit(context.snapshot, context.snapshot.config, { [name]: { extensions: entries } }, undefined, undefined, ownedFrom);
}
