/** The bundled CLI shares settings storage with OMA's SDK hosts. */
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createEngineSettings } from "./settings.js";

SettingsManager.create = createEngineSettings;
