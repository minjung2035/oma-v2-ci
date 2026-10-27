/** Resident-only platform selection; the engine owns portable argv and lifecycle. */
import type { ResidentEngineEffects } from "@oma/engine/ports";
import { engineStartEffects } from "./start-effects.js";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { SANDBOX_EXECUTABLE, residentPathView } from "@oma/domain/resident-paths";
import { macResidentPathView } from "@oma/platform-mac/path-view";
import { residentSeatbelt } from "@oma/platform-mac/resident-sandbox";
import { spawnWithPrivateInputs } from "@oma/process/async";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { StoreError } from "@oma/domain/errors";
export const residentEngineEffects: ResidentEngineEffects = { ...engineStartEffects, sandbox: {
  pathView: (host, lease, directories, endpoints = {}) => process.platform === "darwin"
    ? macResidentPathView(host, lease, directories, endpoints)
    : residentPathView(host, directories, { socket: lease.socketHostPath, ...endpoints }, "mounted"),
  residentPlan(host, lease, directories, environment, inferenceSocket, egressSocket) {
    if (process.platform === "darwin") {
      const recipe = residentSeatbelt(host, lease, directories, environment, {
        ...(inferenceSocket === undefined ? {} : { inference: inferenceSocket }),
        ...(egressSocket === undefined ? {} : { egress: egressSocket }),
      });
      return { command: recipe.command.executable, args: [...recipe.command.argv], cwd: recipe.command.cwd!,
        env: Object.fromEntries(Object.entries(recipe.command.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        privateInputs: recipe.privateInputs };
    }
    const argv = residentArgv(host, lease, directories, environment, inferenceSocket, egressSocket);
    if (argv[0] !== "bwrap") throw new StoreError("UNSUPPORTED_PROFILE", "Linux Worker plan has no fixed sandbox executable");
    return { command: SANDBOX_EXECUTABLE, args: argv.slice(1), cwd: directories.workspace, env: {}, input: sandboxSeccompFilter() };
  },
  spawn(plan) {
    if (process.platform === "darwin") {
      // Do not activate this path before the native runtime scope/file/auth
      // qualification is real. The existing outer execution owner must fence
      // the complete run; no host state-directory FD enters a Worker.
      assertNativeRuntime();
      if (plan.privateInputs === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker has no private profile owner");
      return spawnWithPrivateInputs(plan.command, plan.args, plan.cwd, plan.env, plan.privateInputs);
    }
    return spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input, plan.cwd);
  },
} };
