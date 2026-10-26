/** P0-3 / DR25: Personal extension choices are the Human's, never a role.
 * One locked read/transform/commit; package reconciliation uses the role rule. */
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { extensionEntryProblem, observeExtensionAsset, PACKAGE_ENTRY_PREFIX, type ExtensionRoots } from "@oma/config/operations";
import { ensureOwnedUserDirectory, readUserFile, replaceUserFile } from "./user-files.js";
import { ProcessLock } from "@oma/native/process-lock";
import { PACKAGE_INDEX_BYTES, packageStoreRoot, readPackageIndex, reconciledEntries, decodePackageIndex, type InstalledPackage } from "./packages/index.js";
import { PERSONAL_SESSIONS } from "./session-mode.js";
import { fileDigest } from "@oma/storage/file-digest";
import type { VerifiedExtension } from "@oma/contracts/assets";

const KIND = "oma-personal-settings-v2";
/** UX-20: the document embeds the whole package index (every package's
 * entries and resource lists, so a Personal session's argv can name them) plus
 * the Human's enabled entries, so its DoS ceiling is the index's twice over
 * plus headroom -- a bound bytes placed into it can approach, never a size a
 * real choice is meant to reach. */
export const PERSONAL_SETTINGS_BYTES = 2 * PACKAGE_INDEX_BYTES + 1024 * 1024;
/** C20: a Personal extension may also be an absolute file path, written
 * `local:/absolute/path.js`. Personal runs on the Human's own permissions and
 * confinement is not its guarantee, so a path that lives outside libdir and
 * the package store is a real extension for it -- still digest-pinned before
 * every session, like every other entry. */
export const LOCAL_ENTRY_PREFIX = "local:";
/** The shape of a `local:` entry's payload: a normalized absolute JS/TS path.
 * `..` and `.` segments are refused as everywhere else, so the entry spells
 * one file. A symlink resolves at observation; the real path is what is
 * pinned, so a moved link cannot silently change what runs. */
export function localEntryProblem(path: unknown): string | null {
  if (typeof path !== "string" || !path || path.includes("\0") || path.includes("\\") || !isAbsolute(path) ||
      // The leading segment of an absolute path is the root's empty spelling;
      // every segment after it must be a real name -- no `//`, `.` or `..`.
      path.split("/").slice(1).some(part => !part || part === "." || part === "..") ||
      !/\.(?:js|mjs|ts)$/.test(path))
    return "a local extension entry must be a normalized absolute JS/TS path";
  return null;
}
/** The entry a Personal choice is stored under: absolute input becomes a
 * `local:` entry; anything else is the installation/package spelling as-is. */
export function personalExtensionEntry(input: string): string {
  return isAbsolute(input) ? `${LOCAL_ENTRY_PREFIX}${input}` : input;
}
/** Whether an entry is a valid Personal extension choice: relative to the
 * installation, `packages:`-pinned, or an absolute `local:` file (C20). */
export function personalEntryProblem(entry: string): string | null {
  if (entry.startsWith(LOCAL_ENTRY_PREFIX)) return localEntryProblem(entry.slice(LOCAL_ENTRY_PREFIX.length));
  return extensionEntryProblem(entry);
}
export interface PersonalSettings {
  readonly kind: typeof KIND;
  readonly revision: number;
  readonly extensions: readonly string[];
  readonly packages: readonly InstalledPackage[];
}
export interface PersonalSettingsLocation {
  readonly dataRoot: string;
  readonly libdir: string;
  readonly packages: string;
}
const invalid = (): never => { throw new StoreError("STORE_CORRUPT", "Personal settings are malformed"); };
const entries = (value: unknown): value is string[] => Array.isArray(value) && new Set(value).size === value.length &&
  value.every(item => typeof item === "string" && item !== DEPLOYMENT_LAYOUT.extension && personalEntryProblem(item) === null);
function checked(value: unknown): PersonalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (typeof record.kind === "string" && record.kind !== KIND)
    throw new StoreError("UNSUPPORTED_PROFILE", "Personal settings format is unsupported; use a new development state directory");
  if (Object.keys(record).sort().join(",") !== "extensions,kind,packages,revision" || record.kind !== KIND ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 || !entries(record.extensions) || !Array.isArray(record.packages)) return invalid();
  let packages: readonly InstalledPackage[];
  try { packages = decodePackageIndex(record.packages); } catch { return invalid(); }
  return Object.freeze({ kind: KIND, revision: record.revision as number,
    extensions: Object.freeze([...record.extensions]), packages });
}
export function readPersonalSettings(dataRoot: string): PersonalSettings | null {
  const path = join(dataRoot, PERSONAL_SESSIONS, "settings.json");
  let bytes: string | null;
  try { bytes = readUserFile(path, PERSONAL_SETTINGS_BYTES); }
  catch (error) {
    // An oversized regular file is a limit, not corrupt bytes; the refusal
    // names the configured bound.
    if (error instanceof StoreError && error.code === "STORE_CORRUPT") {
      const observed = lstatSync(path, { throwIfNoEntry: false });
      if (observed?.isFile() && observed.size > PERSONAL_SETTINGS_BYTES)
        throw new StoreError("LIMIT_EXCEEDED", `Personal settings exceed their ${PERSONAL_SETTINGS_BYTES}-byte bound`);
    }
    throw error;
  }
  if (bytes === null) return null;
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { return invalid(); }
  return checked(value);
}
export function personalExtensionRoots(location: PersonalSettingsLocation): ExtensionRoots {
  return { libdir: location.libdir, packages: packageStoreRoot(location.packages) ?? location.packages };
}
/** C20: a `local:` entry is judged on its own ground: the real file must
 * exist and be regular, its resolved path and digest are what get pinned.
 * There is no root to escape, so the rule is file-ness plus normalization,
 * not containment. */
function observeLocalAsset(entry: string): ReturnType<typeof observeExtensionAsset> {
  const path = entry.slice(LOCAL_ENTRY_PREFIX.length);
  const problem = localEntryProblem(path);
  if (problem !== null) return Object.freeze({ kind: "refused", reason: problem });
  try {
    if (!lstatSync(path, { throwIfNoEntry: false })) return Object.freeze({ kind: "missing" });
    const actual = realpathSync(path);
    if (!lstatSync(actual).isFile())
      return Object.freeze({ kind: "refused", reason: "a local extension must be a regular file" });
    return Object.freeze({ kind: "present", path: actual, sha256: fileDigest(actual).sha256 });
  } catch (error) {
    return Object.freeze({ kind: "refused", reason: error instanceof Error ? error.message : String(error) });
  }
}
function selectedAsset(roots: ExtensionRoots, entry: string): ReturnType<typeof observeExtensionAsset> {
  const asset = entry.startsWith(LOCAL_ENTRY_PREFIX) ? observeLocalAsset(entry) : observeExtensionAsset(roots, entry);
  if (entry === DEPLOYMENT_LAYOUT.extension || (asset.kind === "present" && asset.path === resolve(roots.libdir, DEPLOYMENT_LAYOUT.extension)))
    throw new StoreError("INVALID_REQUEST", "Personal sessions do not load the Society extension");
  return asset;
}
/** Reconciliation is committed here even without a toggle, so restarting after
 * package removal cannot resurrect a removed entry from stale preferences. */
export function updatePersonalSettings(location: PersonalSettingsLocation, seed: readonly string[] | (() => readonly string[]) = [],
  toggle?: { readonly entry: string; readonly enabled: boolean }): PersonalSettings {
  const directory = join(location.dataRoot, PERSONAL_SESSIONS);
  // P0-8: Personal's session directory is oma's own under the data root.
  ensureOwnedUserDirectory(directory, location.dataRoot);
  const lock = ProcessLock.tryAcquire(join(directory, "settings.lock"));
  if (lock === null) throw new StoreError("BROKER_UNAVAILABLE", "Personal settings are being edited; try again");
  return withCleanup(() => {
    const before = readPersonalSettings(location.dataRoot);
    const packages = readPackageIndex(location.packages);
    // A project's first choice is observed only while this writer still has no
    // Personal choice. Existing preferences never depend on that old project.
    const initial = before === null ? typeof seed === "function" ? seed() : seed : [];
    return commitPersonalSettings(location, before, packages, initial, lock, toggle);
  }, () => lock.close());
}

/** A remote first-choice observation retains this same writer while awaiting.
 * Existing choices do not depend on an app, a project or another running session. */
export async function updatePersonalSettingsAsync(location: PersonalSettingsLocation,
  seed: () => Promise<readonly string[]>): Promise<PersonalSettings> {
  const directory = join(location.dataRoot, PERSONAL_SESSIONS);
  // P0-8: Personal's session directory is oma's own under the data root.
  ensureOwnedUserDirectory(directory, location.dataRoot);
  const lock = ProcessLock.tryAcquire(join(directory, "settings.lock"));
  if (lock === null) throw new StoreError("BROKER_UNAVAILABLE", "Personal settings are being edited; try again");
  return await withAsyncCleanup(async () => {
    const before = readPersonalSettings(location.dataRoot);
    const initial = before === null ? await seed() : [];
    return commitPersonalSettings(location, before, readPackageIndex(location.packages), initial, lock);
  }, () => lock.close());
}

function commitPersonalSettings(location: PersonalSettingsLocation, before: PersonalSettings | null,
  packages: readonly InstalledPackage[], initial: readonly string[], lock: ProcessLock,
  toggle?: { readonly entry: string; readonly enabled: boolean }): PersonalSettings {
    let chosen = before === null ? [...new Set(initial.filter(entry => entry !== DEPLOYMENT_LAYOUT.extension))]
      : [...reconciledEntries(before.extensions, before.packages, packages)];
    if (!entries(chosen)) return invalid();
    if (toggle !== undefined) {
      if (personalEntryProblem(toggle.entry) !== null || toggle.entry === DEPLOYMENT_LAYOUT.extension)
        throw new StoreError("INVALID_REQUEST", "invalid Personal extension");
      if (toggle.enabled) {
        const asset = selectedAsset(personalExtensionRoots(location), toggle.entry);
        if (asset.kind !== "present") throw new StoreError("UNSUPPORTED_PROFILE", `extension cannot be enabled: ${toggle.entry}`);
        if (!chosen.includes(toggle.entry)) chosen.push(toggle.entry);
      } else chosen = chosen.filter(entry => entry !== toggle.entry);
    }
    if (before !== null && JSON.stringify(before.extensions) === JSON.stringify(chosen) && JSON.stringify(before.packages) === JSON.stringify(packages)) return before;
    const next = checked({ kind: KIND, revision: (before?.revision ?? 0) + 1, extensions: chosen, packages });
    const bytes = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(bytes) > PERSONAL_SETTINGS_BYTES)
      throw new StoreError("LIMIT_EXCEEDED", `Personal settings exceed their ${PERSONAL_SETTINGS_BYTES}-byte bound`);
    lock.assertHeld(join(location.dataRoot, PERSONAL_SESSIONS, "settings.lock"));
    replaceUserFile(join(location.dataRoot, PERSONAL_SESSIONS, "settings.json"), bytes);
    return next;
}
/** A package command reconciles an existing choice, but never consumes the first
 * project's seed by creating empty preferences. The writer re-reads under lock. */
export function reconcilePersonalSettings(location: PersonalSettingsLocation): PersonalSettings | null {
  return readPersonalSettings(location.dataRoot) === null ? null : updatePersonalSettings(location);
}
export function personalExtensions(location: PersonalSettingsLocation, settings: PersonalSettings): {
  readonly extensions: readonly VerifiedExtension[]; readonly missing: readonly string[];
} {
  const roots = personalExtensionRoots(location), extensions: VerifiedExtension[] = [], missing: string[] = [];
  for (const entry of settings.extensions) {
    const asset = selectedAsset(roots, entry);
    if (asset.kind === "missing") { missing.push(entry); continue; }
    if (asset.kind === "refused") throw new StoreError("UNSUPPORTED_PROFILE", `${entry}: ${asset.reason}`);
    extensions.push({ path: asset.path, sha256: asset.sha256 });
  }
  return { extensions: Object.freeze(extensions), missing: Object.freeze(missing) };
}
