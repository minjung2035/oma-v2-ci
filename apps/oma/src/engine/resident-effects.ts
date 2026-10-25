/** Resident-only platform selection; the engine owns portable argv and lifecycle. */
import type { ResidentEngineEffects } from "@oma/engine/ports";
import { engineStartEffects } from "./start-effects.js";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { SANDBOX_EXECUTABLE, RESIDENT_PATHS, confinedPath } from "@oma/domain/resident-paths";
import { StoreError } from "@oma/domain/errors";
export const residentEngineEffects: ResidentEngineEffects = { ...engineStartEffects, sandbox: {
  pathView: (host, lease, directories) => ({
    map: path => path === lease.socketHostPath ? RESIDENT_PATHS.socket : confinedPath(host, directories, path),
    inference: RESIDENT_PATHS.inference, egress: RESIDENT_PATHS.egress,
  }),
  residentPlan(host, lease, directories, environment, inferenceSocket, egressSocket) {
    const argv = residentArgv(host, lease, directories, environment, inferenceSocket, egressSocket);
    if (argv[0] !== "bwrap") throw new StoreError("UNSUPPORTED_PROFILE", "Linux Worker plan has no fixed sandbox executable");
    return { command: SANDBOX_EXECUTABLE, args: argv.slice(1), cwd: directories.workspace, env: {}, input: sandboxSeccompFilter() };
  },
  spawn: plan => spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input, plan.cwd),
} };
