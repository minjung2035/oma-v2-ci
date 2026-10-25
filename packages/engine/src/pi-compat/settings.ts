import type { EngineSettingsFiles } from "./settings-files.js";
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
import { SettingsManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { StoreError } from "@oma/domain/errors";
import { OMA_THEME_NAME } from "../oma-theme.js";
import { settingsObject } from "./settings-object.js";

/** `SettingsStorage`/`SettingsScope` are not root-exported in 1.0.1; the
 * interface is named through the public factory's parameter, as A4 states. */
type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];
type SettingsScope = Parameters<SettingsStorage["withLock"]>[0];
type SettingsLockBody = Parameters<SettingsStorage["withLock"]>[1];


/** The global file uses OMA's owned writer lock. Trusted project settings
 * also take Pi's public file lock and retain user-file atomic replacement. */
export class OmaSettingsStorage implements SettingsStorage {
  constructor(private readonly files: EngineSettingsFiles, private readonly agentDir: string, private readonly cwd?: string) {}
  withLock(scope: SettingsScope, fn: SettingsLockBody): void {
    // Standalone OMA transforms address only the owned global scope. An
    // interactive engine supplies its cwd; Pi's project trust gate controls
    // whether that user scope is read or written.
    if (scope === "project") {
      if (this.cwd === undefined) {
        if (fn(undefined) !== undefined)
          throw new StoreError("UNSUPPORTED_PROFILE", "engine project settings require a working directory");
        return;
      }
      this.files.withProjectSettings(this.agentDir, this.cwd, fn);
      return;
    }
    // P0-8/DR32: the engine home is oma's own; a damaged leaf mode is
    // repaired before the locked replace rather than wedging on it.
    this.files.withOwnedFile(this.agentDir, "settings.json", fn);
  }
}

/** Pi merges modified fields; all OMA interactive writers share this storage. */
export function createEngineSettings(files: EngineSettingsFiles, cwd: string, agentDir: string,
  options: Parameters<typeof SettingsManager.create>[2] = {}): SettingsManager {
  return SettingsManager.fromStorage(new OmaSettingsStorage(files, agentDir, cwd), options);
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
export function prepareEngineInteractiveSettings(files: EngineSettingsFiles, agentDir: string): void {
  new OmaSettingsStorage(files, agentDir).withLock("global", current => {
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
    // Pi owns skill-command defaults. Preserve an explicit Human choice;
    // historical automatic suppression cannot be distinguished from it.
    const next = `${JSON.stringify(nextSettings, null, 2)}\n`;
    return next === current ? undefined : next;
  });
}

/** The CLI and SDK hosts use the same physical slot owner; SDK patching stays here. */
export function installEngineSettings(files: EngineSettingsFiles): void {
  SettingsManager.create = (cwd, agentDir = getAgentDir(), options = {}) => createEngineSettings(files, cwd, agentDir, options);
}
