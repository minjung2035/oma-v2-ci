/** Physical file/lock ownership for Engine settings. SDK parsing and setters live in Engine. */
import { join } from "node:path";
import { lockSync } from "proper-lockfile";
import { withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { lockedOwnedReplace, withOwnedSettingsLock } from "../runtime/locked-files.js";
import { ensureUserDirectory, ensureOwnedUserDirectory, readUserFile, replaceUserFile } from "../runtime/user-files.js";
import type { EngineSettingsFiles } from "@oma/engine/pi-compat/settings-files";
const SETTINGS_BYTES = 1024 * 1024;
export const engineSettingsFiles: EngineSettingsFiles = Object.freeze<EngineSettingsFiles>({
  withOwnedFile: (directory, name, body) => lockedOwnedReplace(directory, directory, name, SETTINGS_BYTES, body),
  withProjectSettings(agentDir, cwd, body) {
    withOwnedSettingsLock(agentDir, () => {
      const directory = join(cwd, ".pi"), path = join(directory, "settings.json");
      const current = readUserFile(path, SETTINGS_BYTES, { singleName: true });
      const next = body(current ?? undefined);
      if (next !== undefined && next !== current) {
        ensureUserDirectory(directory);
        const release = lockSync(path, { realpath: false });
        withCleanup(() => {
          if (readUserFile(path, SETTINGS_BYTES, { singleName: true }) !== current)
            throw new StoreError("BROKER_UNAVAILABLE", "project settings changed before the writer lock was acquired");
          replaceUserFile(path, next);
        }, release);
      }
    });
  },
  ensureThemes: agentDir => { ensureOwnedUserDirectory(join(agentDir, "themes"), agentDir); },
});
