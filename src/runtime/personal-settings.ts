/** P0-3 / DR25: Personal extension choices are the Human's, never a role.
 * One locked read/transform/commit; package reconciliation uses the role rule. */
import { join, resolve } from "node:path";
import { StoreError } from "../domain/errors.js";
import { withAsyncCleanup, withCleanup } from "../process/cleanup.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { extensionEntryProblem, observeExtensionAsset, type ExtensionRoots } from "../config/operations.js";
import { ensureUserDirectory, readUserFile, replaceUserFile } from "./user-files.js";
import { ProcessLock } from "./process-lock.js";
import { packageStoreRoot, readPackageIndex, reconciledEntries, type InstalledPackage } from "./pi-packages.js";
import { PERSONAL_SESSIONS } from "./session-mode.js";
import type { VerifiedExtension } from "./extension-integrity.js";

const KIND = "oma-personal-settings-v1";
const MAX_BYTES = 1024 * 1024;
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
  value.every(item => typeof item === "string" && item !== DEPLOYMENT_LAYOUT.extension && extensionEntryProblem(item) === null);
function checked(value: unknown): PersonalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "extensions,kind,packages,revision" || record.kind !== KIND ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 || !entries(record.extensions) || !Array.isArray(record.packages)) return invalid();
  const sources = new Set<string>();
  for (const item of record.packages) {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join(",") !== "entries,source" ||
        typeof item.source !== "string" || !item.source || sources.has(item.source) || !entries(item.entries) ||
        !item.entries.every((entry: string) => entry.startsWith("packages:"))) return invalid();
    sources.add(item.source);
  }
  return Object.freeze({ kind: KIND, revision: record.revision as number, extensions: Object.freeze([...record.extensions]),
    packages: Object.freeze(record.packages.map(item => Object.freeze({ source: item.source as string, entries: Object.freeze([...item.entries as string[]]) }))) });
}
export function readPersonalSettings(dataRoot: string): PersonalSettings | null {
  const bytes = readUserFile(join(dataRoot, PERSONAL_SESSIONS, "settings.json"), MAX_BYTES);
  if (bytes === null) return null;
  try { return checked(JSON.parse(bytes)); } catch { return invalid(); }
}
export function personalExtensionRoots(location: PersonalSettingsLocation): ExtensionRoots {
  return { libdir: location.libdir, packages: packageStoreRoot(location.packages) ?? location.packages };
}
function selectedAsset(roots: ExtensionRoots, entry: string): ReturnType<typeof observeExtensionAsset> {
  const asset = observeExtensionAsset(roots, entry);
  if (entry === DEPLOYMENT_LAYOUT.extension || (asset.kind === "present" && asset.path === resolve(roots.libdir, DEPLOYMENT_LAYOUT.extension)))
    throw new StoreError("INVALID_REQUEST", "Personal sessions do not load the Society extension");
  return asset;
}
/** Reconciliation is committed here even without a toggle, so restarting after
 * package removal cannot resurrect a removed entry from stale preferences. */
export function updatePersonalSettings(location: PersonalSettingsLocation, seed: readonly string[] | (() => readonly string[]) = [],
  toggle?: { readonly entry: string; readonly enabled: boolean }): PersonalSettings {
  const directory = join(location.dataRoot, PERSONAL_SESSIONS);
  ensureUserDirectory(directory);
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
 * Existing choices do not depend on an app, a project or a running guest. */
export async function updatePersonalSettingsAsync(location: PersonalSettingsLocation,
  seed: () => Promise<readonly string[]>): Promise<PersonalSettings> {
  const directory = join(location.dataRoot, PERSONAL_SESSIONS);
  ensureUserDirectory(directory);
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
      if (extensionEntryProblem(toggle.entry) !== null || toggle.entry === DEPLOYMENT_LAYOUT.extension)
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
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw new StoreError("INVALID_REQUEST", "Personal settings exceed their document bound");
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
