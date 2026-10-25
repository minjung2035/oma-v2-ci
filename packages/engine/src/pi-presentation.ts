/** DR35: presentation setup runs inside the engine that already loads Pi.
 * Host path/retry resolution must not import the whole interactive SDK. */
import { join } from "node:path";
import { OMA_THEME, OMA_THEME_NAME } from "./oma-theme.js";
import { prepareEngineFile } from "./pi-runtime.js";
import type { EngineSettingsFiles } from "./pi-compat/settings-files.js";
import { prepareEngineInteractiveSettings } from "./pi-compat/settings.js";

/** Presentation policy persists across Pi's own settings reloads. Only the
 * society's isolated engine files are touched; unrelated choices survive. */
export function preparePiInteractive(files: EngineSettingsFiles, agentDir: string): void {
  // P0-8: the caller owns the agent directory; repair its themes tail here.
  files.ensureThemes(agentDir);
  prepareEngineFile(files, join(agentDir, "themes"), `${OMA_THEME_NAME}.json`, () => ({ ...OMA_THEME }));
  // A4: Pi's own manager continues to parse, migrate and set these fields.
  prepareEngineInteractiveSettings(files, agentDir);
  prepareEngineFile(files, agentDir, "keybindings.json", keys => ({ ...keys, "app.message.copy": keys["app.message.copy"] ?? [],
    "app.models.clearAll": keys["app.models.clearAll"] ?? [] }));
  prepareEngineFile(files, agentDir, "open-tui.json", settings => ({ ...settings, enabled: true,
    telemetry: settings.telemetry ?? { enabled: false }, thinkingPeek: settings.thinkingPeek ?? { lines: 0 } }));
}
