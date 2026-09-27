/** DR18 (D-9): how a Human logs the society's engine in and picks its model.
 *
 * PRODUCT asks for two things at once: OMA builds no authentication screen of
 * its own, and the engine's sessions run only in RPC mode. Both hold here.
 * `oma login` hands the terminal to the bundled engine's own interactive mode
 * over this society's engine directory -- the one every session of this
 * society reads its credentials and model settings from -- and the Human uses
 * the engine's own login and model selection there. When it exits, the next
 * `oma` start runs its session in RPC mode over what was written. */
import { piIsolationEnv, resolvePiRuntime } from "../runtime/pi-runtime.js";
import { spawnInteractive } from "../process/async.js";
import { ensureDirectory } from "../storage/directory.js";

export interface EngineLogin {
  readonly stateRoot: string;
  readonly libdir: string;
  /** OMA_PI_COMMAND, the host-pinned engine, as the session uses it. */
  readonly override?: string | undefined;
  /** The society lease this login holds. */
  readonly fence: number;
  /** The Human's environment, which the engine's own flows need (a browser,
   * a terminal type); the engine directory is set over it. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Runs the engine's interactive mode and answers with its exit status. */
export function runEngineLogin(login: EngineLogin): Promise<number> {
  const runtime = resolvePiRuntime({ stateRoot: login.stateRoot, libdir: login.libdir, override: login.override });
  ensureDirectory(runtime.agentDir, 0o700);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(login.env)) if (typeof value === "string") env[name] = value;
  Object.assign(env, piIsolationEnv(runtime));
  const child = spawnInteractive(runtime.executable, runtime.args, runtime.agentDir, env, login.fence);
  return new Promise(resolve => {
    child.once("error", () => { resolve(1); });
    // Ended by a signal: not a login that finished.
    child.once("exit", code => { resolve(code ?? 1); });
  });
}
