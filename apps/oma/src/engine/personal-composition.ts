import type { PersonalEnginePorts } from "@oma/engine/personal-ports";
import type { PersonalSettingsLocation } from "../runtime/personal-settings.js";
import { personalExtensions, personalExtensionEntry, updatePersonalSettings } from "../runtime/personal-settings.js";
import { packageResourcePaths, readPackageIndex } from "../runtime/packages/index.js";
import { sessionBirthForHistory, sessionHistoryDirectories } from "../runtime/session-catalog.js";
import { personalModels } from "../runtime/personal-models.js";
import { engineStartEffects } from "./start-effects.js";
import { enginePresentation } from "./presentation.js";
export function personalEnginePorts(location: PersonalSettingsLocation, agentDir: string): PersonalEnginePorts {
  return { ...engineStartEffects, presentation: enginePresentation,
    extensions: {
      load: () => personalExtensions(location, updatePersonalSettings(location)),
      readSelection: () => updatePersonalSettings(location),
      availableEntries: () => readPackageIndex(location.packages).flatMap(item => item.entries),
      entry: personalExtensionEntry,
      select: (entry, enabled) => { updatePersonalSettings(location, [], { entry, enabled }); },
      resources: () => packageResourcePaths(location.packages),
    }, history: {
      target: (file, cwd) => sessionBirthForHistory(location.dataRoot, file, cwd),
      directories: cwd => sessionHistoryDirectories(location.dataRoot, cwd),
    }, acquireCredentials: () => personalModels(location.libdir, agentDir),
  };
}
