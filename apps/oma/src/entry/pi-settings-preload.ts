/** Application composition for the bundled CLI's current Engine settings adapter. */
import { installEngineSettings } from "@oma/engine/pi-compat/settings";
import { engineSettingsFiles } from "../engine/settings-files.js";
import { enableProcessCompileCache } from "../runtime/compile-cache.js";
enableProcessCompileCache();
installEngineSettings(engineSettingsFiles);
