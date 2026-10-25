/** Resident-only sandbox providers; Personal composition does not load this closure. */
import type { ResidentEngineEffects } from "@oma/engine/ports";
import { engineStartEffects } from "./start-effects.js";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
export const residentEngineEffects: ResidentEngineEffects = { ...engineStartEffects,
  sandbox: { residentArgv, seccompFilter: sandboxSeccompFilter } };
