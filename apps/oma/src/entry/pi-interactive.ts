import "../runtime/client-preload.js";
import { readFileSync } from "node:fs";
import { engineSettingsFiles } from "../engine/settings-files.js";
import { enginePresentation } from "../engine/presentation.js";
import { runInteractive } from "@oma/engine/interactive";

// A start that failed is a failure: the engine's own SIGTERM handling would
// turn a self-signal into a clean exit, which the host would read as a quit.
void runInteractive({ settings: engineSettingsFiles, presentation: enginePresentation,
  version: (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version }).catch(error => {
  process.stderr.write(`OMA interactive startup failed: ${String(error)}\n`);
  process.exit(1);
});
