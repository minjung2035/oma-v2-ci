/** Resident-only platform selection; the engine owns portable argv and lifecycle. */
import type { ResidentEngineEffects } from "@oma/engine/ports";
import { engineStartEffects } from "./start-effects.js";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { SANDBOX_EXECUTABLE, residentPathView } from "@oma/domain/resident-paths";
import { macResidentPathView } from "@oma/platform-mac/path-view";
import { StoreError } from "@oma/domain/errors";
export const residentEngineEffects: ResidentEngineEffects = { ...engineStartEffects, sandbox: {
  pathView: (host, lease, directories, endpoints = {}) => process.platform === "darwin"
    ? macResidentPathView(host, lease, directories, endpoints)
    : residentPathView(host, directories, { socket: lease.socketHostPath, ...endpoints }, "mounted"),
  residentPlan(host, lease, directories, environment, inferenceSocket, egressSocket) {
    const argv = residentArgv(host, lease, directories, environment, inferenceSocket, egressSocket);
    if (argv[0] !== "bwrap") throw new StoreError("UNSUPPORTED_PROFILE", "Linux Worker plan has no fixed sandbox executable");
    return { command: SANDBOX_EXECUTABLE, args: argv.slice(1), cwd: directories.workspace, env: {}, input: sandboxSeccompFilter() };
  },
  spawn: plan => spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input, plan.cwd),
} };
