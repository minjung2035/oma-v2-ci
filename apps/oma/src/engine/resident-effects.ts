/** Resident-only platform selection; common engine policy owns argv/lifecycle. */
import type { ResidentEngineEffects, ResidentSandbox, PiSpawnPlan } from "@oma/engine/ports";
import { engineStartEffects } from "./start-effects.js";
import { hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { assertResidentContext } from "@oma/protocol/resident-context";
import { residentArgv } from "@oma/platform-linux/sandbox";
import { SANDBOX_EXECUTABLE, sandboxSeccompFilter } from "@oma/platform-linux/sandbox-seccomp";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { residentPathView } from "@oma/domain/resident-paths";
import { macResidentPathView } from "@oma/platform-mac/path-view";
import { residentSeatbelt } from "@oma/platform-mac/resident-sandbox";
import { decodeMacDeveloperTools, type MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { spawnWithPrivateInputs } from "@oma/process/async";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { StoreError } from "@oma/domain/errors";

// The same concrete spawn owner/exemption as before: no host-state directory
// capability enters the Worker; the outer execution owner retains full scope.
function spawn(plan: PiSpawnPlan) {
  if (process.platform === "darwin") {
    assertNativeRuntime();
    if (plan.privateInputs === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker has no private profile owner");
    return spawnWithPrivateInputs(plan.command, plan.args, plan.cwd, plan.env, plan.privateInputs);
  }
  return spawnSandboxed([plan.command, ...plan.args], plan.env, plan.input, plan.cwd);
}
/** Explicit Mac recipe also serves pure planner tests; spawn still selects
 * the real OS and cannot manufacture a Darwin scope on another kernel. */
export function macResidentSandbox(toolsInput: MacDeveloperTools | undefined): ResidentSandbox {
  const tools = toolsInput === undefined ? undefined : decodeMacDeveloperTools(toolsInput);
  return {
    pathView: macResidentPathView,
    residentPlan(host, lease, directories, environment, inference, egress) {
      if (tools === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker requires broker-observed developer tools");
      const recipe = residentSeatbelt(host, lease, directories, tools, environment, {
        ...(inference === undefined ? {} : { inference }), ...(egress === undefined ? {} : { egress }),
      });
      return { command: recipe.command.executable, args: [...recipe.command.argv], cwd: recipe.command.cwd!,
        env: Object.fromEntries(Object.entries(recipe.command.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
        privateInputs: recipe.privateInputs };
    },
    spawn,
  };
}
export function createResidentEngineEffects(tools?: MacDeveloperTools): ResidentEngineEffects {
  if (process.platform === "darwin") return { ...engineStartEffects, sandbox: macResidentSandbox(tools) };
  if (tools !== undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Linux Worker cannot consume a Mac toolchain launch");
  return { ...engineStartEffects, sandbox: {
    pathView: (host, lease, directories, endpoints = {}) => residentPathView(host, directories, { socket: lease.socketHostPath, ...endpoints }, "mounted"),
    residentPlan(host, lease, directories, environment, inference, egress) {
      assertResidentContext(host, lease, directories);
      const argv = residentArgv(host, lease, directories, hostSystemLayout().binds, environment, inference, egress);
      if (argv[0] !== "bwrap") throw new StoreError("UNSUPPORTED_PROFILE", "Linux Worker plan has no fixed sandbox executable");
      return { command: SANDBOX_EXECUTABLE, args: argv.slice(1), cwd: directories.workspace, env: {}, input: sandboxSeccompFilter() };
    },
    spawn,
  } };
}
export const residentEngineEffects: ResidentEngineEffects = createResidentEngineEffects();
