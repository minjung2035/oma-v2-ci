import { personalMain } from "../engine/personal-entry.js";
void personalMain().catch(error => { process.stderr.write(`oma: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
