/** TUI-010: role-by-role extension selection over host-placed files only.
 *
 * This is not an installer. The list is what the host already put under
 * installation.libdir; there is no arbitrary path entry, no network fetch and
 * no Pi auto-discovery. The core OMA extension is always first and cannot be
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
import { StoreError } from "../../domain/errors.js";
import { errorWords } from "../words.js";
import { DEPLOYMENT_LAYOUT } from "../../domain/deployment.js";
import { loadConfigurationSnapshot, loadEditableConfiguration, type ConfigurationSnapshot } from "../../config.js";
import { extensionEntryProblem, extensionListProblem, observeExtensionAsset } from "../../config/operations.js";
import type { ManagedSource } from "../../config/generations.js";
import { commitManagedEdit } from "./settings.js";
import type { ExtensionRow } from "../model.js";
import { READ_BOUNDS } from "../limits.js";

export const CORE_EXTENSION = DEPLOYMENT_LAYOUT.extension;

export interface RoleFile {
  readonly name: string;
  readonly path: string;
  readonly extensions: readonly string[];
  /** Every other field of the authored role file, preserved verbatim. Toggling
   * an extension must not silently drop an optional block such as toolSurface.
   */
  readonly rest: Readonly<Record<string, unknown>>;
}

export interface ExtensionContext {
  readonly editable: boolean;
  readonly libdir: string;
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
      if (observeExtensionAsset(libdir, rel).kind !== "present") continue;
      found.push(rel);
    }
  };
  walk(join(libdir, "extensions"), 0);
  return { entries: found.sort(), partial: partial || unobserved };
}

function rowsOf(available: readonly string[], principal: RoleFile | null, worker: RoleFile | null,
  missing: ReadonlySet<string>): readonly ExtensionRow[] {
  return Object.freeze(available.map(id => Object.freeze({
    id,
    principal: principal ? principal.extensions.includes(id) : id === CORE_EXTENSION,
    workers: worker ? worker.extensions.includes(id) : id === CORE_EXTENSION,
    locked: id === CORE_EXTENSION,
    ...(missing.has(id) ? { missing: true } : {}),
  })));
}

const unmanaged = (reason: string): ExtensionContext => Object.freeze({
  editable: false, libdir: "", principalRole: null, workerRole: null, roles: Object.freeze([]),
  rows: Object.freeze([Object.freeze({ id: CORE_EXTENSION, principal: true, workers: true, locked: true })]),
  reason, snapshot: null, mode: "full" as const, scan: "complete" as const,
});

export function readExtensions(source: string | ConfigurationSnapshot, principalProfile: string, workerProfile: string | null): ExtensionContext {
  let snapshot: ManagedSource;
  let mode: "full" | "repair" = "full";
  try { snapshot = typeof source === "string" ? loadConfigurationSnapshot(source) : source; }
  catch (error) {
    const unreadable = error instanceof StoreError ? `설정을 읽을 수 없습니다: ${errorWords(error)}` : "설정을 읽을 수 없습니다";
    // WP14.03: a configuration that fails only because a declared extension
    // file is gone can still be read as an editing input for its removal.
    if (typeof source !== "string") return unmanaged(unreadable);
    try { snapshot = loadEditableConfiguration(source); mode = "repair"; }
    catch { return unmanaged(unreadable); }
  }
  if (snapshot.layout.kind !== "operations")
    return unmanaged("인라인 config.json은 role별 extension을 갖지 않습니다");
  const libdir = snapshot.config.installation.libdir;
  const roles: RoleFile[] = [];
  const missing = new Set<string>();
  for (const [name, authored] of Object.entries(snapshot.authoredRoles)) {
    const role = authored.value;
    const entries = role.extensions;
    if (extensionListProblem(entries) !== null)
      return unmanaged(`role ${name}의 extensions 형식이 올바르지 않습니다`);
    for (const entry of entries as string[]) if (observeExtensionAsset(libdir, entry).kind === "missing") missing.add(entry);
    const { extensions: _authored, ...rest } = role;
    roles.push(Object.freeze({ name, path: authored.path,
      extensions: Object.freeze([...entries as string[]]), rest: Object.freeze(rest) }));
  }
  // A repair input exists only for the missing-file case; anything else that
  // keeps the configuration from loading is not this screen's to fix.
  if (mode === "repair" && missing.size === 0)
    return unmanaged("설정을 읽을 수 없습니다: 없는 extension 파일 때문이 아닙니다");
  const principal = roles.find(role => role.name === principalProfile) ?? null;
  // P0V-51: no Worker profile of its own means no Worker column to edit, never
  // the Principal's role under the Worker's name.
  const worker = workerProfile === null || workerProfile === principalProfile ? null : roles.find(role => role.name === workerProfile) ?? null;
  const scanned = scanLibdir(libdir);
  const referenced = new Set<string>([CORE_EXTENSION]);
  for (const role of roles) for (const entry of role.extensions) referenced.add(entry);
  for (const entry of scanned.entries) referenced.add(entry);
  const available = [CORE_EXTENSION, ...[...referenced].filter(id => id !== CORE_EXTENSION).sort()];
  const editable = principal !== null || worker !== null;
  return Object.freeze({
    editable, libdir, principalRole: principal?.name ?? null, workerRole: worker?.name ?? null,
    roles: Object.freeze(roles), rows: rowsOf(available, principal, worker, missing),
    reason: !editable ? "해당 role 파일이 없습니다"
      : mode === "repair" ? "없는 extension 파일이 선언되어 있습니다. 그 선언만 끌 수 있습니다"
      : scanned.partial ? "extension 목록을 모두 살펴보지 못했습니다(부분 목록)" : null,
    snapshot, mode, scan: scanned.partial ? "partial" : "complete",
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

export function toggleExtension(context: ExtensionContext, id: string, role: "principal" | "workers", enabled: boolean): void {
  if (!context.editable) throw new StoreError("UNSUPPORTED_PROFILE", "이 설정 형식에서는 extension을 바꿀 수 없습니다");
  if (id === CORE_EXTENSION) return;
  const name = role === "principal" ? context.principalRole : context.workerRole;
  if (name === null) throw new StoreError("UNSUPPORTED_PROFILE", `대상 role 파일이 없습니다: ${role}`);
  const target = context.roles.find(entry => entry.name === name);
  if (!target) throw new StoreError("STORE_CORRUPT", "role file disappeared between read and write");
  if (context.snapshot === null) throw new StoreError("UNSUPPORTED_PROFILE", "이 설정은 스냅샷 없이 바꿀 수 없습니다");
  if (enabled) {
    if (context.mode === "repair")
      throw new StoreError("UNSUPPORTED_PROFILE", "없는 extension 선언을 먼저 끄세요; 복구 중에는 다른 extension을 켤 수 없습니다");
    // Only a host-placed file the loader itself accepts is enabled.
    const asset = observeExtensionAsset(context.libdir, id);
    if (asset.kind !== "present")
      throw new StoreError("INVALID_REQUEST", `선택할 수 없는 extension입니다: ${id} (${asset.kind === "missing" ? "파일 없음" : asset.reason})`);
  } else {
    // WP14.03: removing a declaration needs no asset -- only the exact entry.
    if (!target.extensions.includes(id)) return;
    if (context.mode === "repair" && observeExtensionAsset(context.libdir, id).kind !== "missing")
      throw new StoreError("UNSUPPORTED_PROFILE", "복구 중에는 없는 extension 선언만 끌 수 있습니다");
  }
  const entries = nextEntries(target.extensions, id, enabled);
  const problem = extensionListProblem(entries);
  if (problem !== null) throw new StoreError("LIMIT_EXCEEDED", problem);
  // D02/WP13: one generation from the source this screen read; the loader
  // proves the whole published candidate, and a source changed since that read
  // is refused rather than overwritten.
  commitManagedEdit(context.snapshot, context.snapshot.config, { [name]: { extensions: entries } });
}
