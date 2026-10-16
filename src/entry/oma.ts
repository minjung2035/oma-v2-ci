#!/usr/bin/env node
/** Birth-only routing. A Personal start never loads the Society product. */
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseOmaArguments } from "../runtime/host-arguments.js";
import { hostLaunchLocation } from "../runtime/assets.js";
import { sessionBirthForHistory, RESUME_SESSION_ENV } from "../runtime/session-catalog.js";
import { requireSessionMode } from "../runtime/session-mode.js";
import { codeFor, fail } from "../application/exit.js";
import { errorWords } from "../tui/words.js";

async function main(argv: readonly string[]): Promise<void> {
  if (process.platform === "darwin") { await import("./oma-mac.js"); return; }
  const command = parseOmaArguments(argv);
  if (command.kind !== "session") { await import("./oma-society.js"); return; }
  const cwd = realpathSync(process.cwd());
  const dataRoot = dirname(hostLaunchLocation("personal", process.env).stateRoot);
  const resume = command.resume ?? process.env[RESUME_SESSION_ENV];
  let mode = command.mode;
  if (resume !== undefined) {
    const birth = await sessionBirthForHistory(dataRoot, resume, cwd);
    requireSessionMode(birth, mode); mode = birth.mode;
  } else if (command.society !== undefined) {
    const birth = (await import("../runtime/session-mode.js")).readSessionBirth(join(dataRoot, command.society));
    if (birth !== null) requireSessionMode(birth, "society");
    mode = "society";
  } else if (mode === undefined) {
    mode = "society";
  }
  if (mode === "personal") {
    const { personalMain } = await import("./personal-host.js");
    await personalMain({ dataRoot, cwd, ...(resume === undefined ? {} : { resume }),
      ...(command.noProjectExtensions ? { noProjectExtensions: true } : {}) });
  } else {
    if (resume !== undefined) process.env[RESUME_SESSION_ENV] = resume;
    await import("./oma-society.js");
  }
}
main(process.argv.slice(2)).catch(error => fail(errorWords(error), codeFor(error)));
