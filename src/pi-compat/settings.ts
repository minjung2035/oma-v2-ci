/** A4/A7: Pi owns the semantics of `settings.json` fields it has setters for;
 * OMA owns how those bytes persist.
 *
 * `SettingsManager` 1.0.1 parses, migrates, merges and knows the setters. Its
 * own `FileSettingsStorage` replaces the file with an in-place `writeFileSync`
 * on an async queue whose failures only surface through `drainErrors()` --
 * OMA's settings write is a locked read-modify-replace that reports
 * synchronously instead, so the durable half is this `SettingsStorage` over
 * the owned user-file primitives.
 *
 * The two halves meet inside one `withLock` hold: the manager is constructed
 * on an ephemeral storage seeded with the bytes the lock already vouches for,
 * the setters run, and the locked slot takes the serialized result. A second
 * lock hold between load and commit never exists, so Pi's modified-field merge
 * cannot be needed -- a concurrent write would have had to cross the lock.
 * What does not round-trip through this path (retry numbers, keybindings,
 * open-tui, themes, auth) keeps its direct writer.
 */
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { StoreError } from "../domain/errors.js";
import { lockedOwnedReplace } from "../runtime/locked-files.js";
import { OMA_THEME_NAME } from "../runtime/oma-theme.js";

/** `SettingsStorage`/`SettingsScope` are not root-exported in 1.0.1; the
 * interface is named through the public factory's parameter, as A4 states. */
type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];
type SettingsScope = Parameters<SettingsStorage["withLock"]>[0];
type SettingsLockBody = Parameters<SettingsStorage["withLock"]>[1];

const SETTINGS_BYTES = 1024 * 1024;

/** The settings object check every writer shares: absent is an empty object,
 * anything else that is not a plain object is a profile the engine was never
 * given and the bytes stay untouched. */
export function settingsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("UNSUPPORTED_PROFILE", "engine settings must be an object");
  return value as Record<string, unknown>;
}

/** A `SettingsStorage` that is OMA's settings slot, not a file layout. There
 * is one scope: the society engine home's `settings.json`, replaced under the
 * writer's lock with the user-file guarantees -- bounded read, single name,
 * atomic replace, and no write when nothing changed. */
export class OmaSettingsStorage implements SettingsStorage {
  constructor(private readonly agentDir: string) {}
  withLock(scope: SettingsScope, fn: SettingsLockBody): void {
    // Project settings have no OMA file: the engine home is the only settings
    // fact this storage owns. A read answers absent; a write would be one this
    // bridge was never asked to carry, so it is refused rather than dropped.
    if (scope === "project") {
      if (fn(undefined) !== undefined)
        throw new StoreError("UNSUPPORTED_PROFILE", "engine project settings have no OMA storage");
      return;
    }
    // P0-8/DR32: the engine home is oma's own; a damaged leaf mode is
    // repaired before the locked replace rather than wedging on it.
    lockedOwnedReplace(this.agentDir, this.agentDir, "settings.json", SETTINGS_BYTES, fn);
  }
}

/** The bytes a locked slot currently holds, answered as `SettingsStorage`
 * answers them. Constructing a `SettingsManager` on this gives the locked
 * content Pi's own parse and migration; the writes its queued saves perform
 * land here and are never read -- only the synchronous return value is. */
class EphemeralSettingsStorage implements SettingsStorage {
  constructor(private current: string | undefined) {}
  withLock(scope: SettingsScope, fn: SettingsLockBody): void {
    const next = fn(scope === "global" ? this.current : undefined);
    if (scope === "global" && next !== undefined) this.current = next;
  }
}

/** A load that reported through `drainErrors` is no load: the malformed bytes
 * stay and the failure is the caller's, as the direct writer's `JSON.parse`
 * threw before it. The bytes this manager parsed came from the locked
 * settings slot, so an error it reports is that file's corruption -- the same
 * STORE_CORRUPT `prepareEngineFile` raises on its own read, never the raw
 * engine error escaping the taxonomy (the file may have gone bad between the
 * two reads). */
function loadedSettings(manager: SettingsManager): Record<string, unknown> {
  const errors = manager.drainErrors();
  if (errors.length > 0)
    throw new StoreError("STORE_CORRUPT", "engine file settings.json could not be loaded", { cause: errors[0]!.error });
  return settingsObject(manager.getGlobalSettings());
}

/** The interactive `settings.json` fields that have Pi setters (A4): theme,
 * thinking-block, quiet start, both telemetries, skill commands and the
 * fullscreen exit text. What the Human chose is kept; the defaults land only
 * where she never chose, and telemetry to Pi is always off. */
export function prepareEngineInteractiveSettings(agentDir: string): void {
  new OmaSettingsStorage(agentDir).withLock("global", current => {
    const manager = SettingsManager.fromStorage(new EphemeralSettingsStorage(current));
    const stored = loadedSettings(manager);
    manager.setTheme(typeof stored.theme === "string" ? stored.theme : OMA_THEME_NAME);
    // `?? true` keeps the direct writer's reading: absent (or null) chooses
    // the default, a present value keeps its truthiness as Pi's getters do.
    manager.setHideThinkingBlock(Boolean(stored.hideThinkingBlock ?? true));
    // `QuietStartup` widened to `boolean | "header"` in Pi 1.0.1 -- the literal
    // shows the startup header but still hides the details, so it is not
    // truthiness: passing it through keeps the choice the Human made.
    manager.setQuietStartup(stored.quietStartup === "header" ? "header" : Boolean(stored.quietStartup ?? true));
    manager.setEnableInstallTelemetry(false);
    manager.setEnableAnalytics(false);
    manager.setFullscreenExitOutput("resume-hint");
    const nextSettings = manager.getGlobalSettings() as Record<string, unknown>;
    // C16: skill commands are Pi's ordinary surface and stay enabled; an
    // earlier suppression persisted in this file is scrubbed once here rather
    // than pinned over again.
    delete nextSettings.enableSkillCommands;
    const next = `${JSON.stringify(nextSettings, null, 2)}\n`;
    return next === current ? undefined : next;
  });
}
