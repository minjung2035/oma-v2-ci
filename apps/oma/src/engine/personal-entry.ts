import { readFileSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";
import { readSessionBirth } from "../runtime/session-mode.js";
import { PI_AGENT_DIR_ENV } from "@oma/engine/pi-runtime";
import { runPersonal } from "@oma/engine/personal";
import { personalEnginePorts } from "./personal-composition.js";
const value = (name: string): string => {
  const at = process.argv.indexOf(name), result = process.argv[at + 1];
  if (at < 0 || result === undefined || process.argv.indexOf(name, at + 1) !== -1)
    throw new StoreError("INVALID_REQUEST", `Missing ${name}`);
  return result;
};
export async function personalMain(): Promise<void> {
  const root = value("--root"), dataRoot = value("--data-root"), libdir = value("--libdir"), packages = value("--packages");
  const birth = readSessionBirth(root), agentDir = process.env[PI_AGENT_DIR_ENV];
  if (birth === null || birth.mode !== "personal" || agentDir === undefined || birth.cwd !== process.cwd())
    throw new StoreError("INVALID_REQUEST", "Personal engine requires its saved birth and cwd");
  const version = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  await runPersonal({ birth, agentDir, libdir, version,
    ...(process.argv.includes("--resume") ? { resume: value("--resume") } : {}) },
    personalEnginePorts({ dataRoot, libdir, packages }, agentDir));
}
