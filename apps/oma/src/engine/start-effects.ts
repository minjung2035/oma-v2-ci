/** Product composition: Engine receives only its actual physical settings, integrity and sandbox owners. */
import type { EngineStartEffects, EngineLoginDirectory } from "@oma/engine/ports";
import { engineSettingsFiles } from "./settings-files.js";
import { assertExtensionIntegrity } from "../runtime/extension-integrity.js";
import { ensureOwnedUserDirectory } from "../runtime/user-files.js";
export const engineStartEffects: EngineStartEffects = { settings: engineSettingsFiles, assertExtensions: assertExtensionIntegrity };
export const engineLoginDirectory: EngineLoginDirectory = { ensureOwnedDirectory: ensureOwnedUserDirectory };
