/** DR18 (D-9) / DR25: the Human uses the bundled engine's own login or package
 * command, not an OMA authentication screen. OMA's engine directory (or package
 * store) is explicit; the caller holds its fence until the child actually closes. */
import { dirname, join } from "node:path";
import { PI_AGENT_DIR_ENV, piIsolationEnv, resolvePiRuntime } from "./pi-runtime.js";
import { spawnInteractive } from "@oma/process/async";
import type { EngineLoginDirectory } from "./ports.js";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";

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
  /** DR25: a package command instead of the login -- its arguments, run over
   * the package store as the engine's agent directory. */
  readonly packages?: { readonly store: string; readonly args: readonly string[] } | undefined;
}

/** Runs the engine's interactive mode and answers with its exit status.
 * Preparation failures are rejections of that answer too (NB-09): a function
 * declared `Promise<number>` must not throw synchronously. */
export async function runEngineLogin(directory: EngineLoginDirectory, login: EngineLogin): Promise<number> {
  const runtime = resolvePiRuntime({ stateRoot: login.stateRoot, libdir: login.libdir, override: login.override });
  const agentDir = login.packages?.store ?? runtime.agentDir;
  // P0-8: the engine home is oma's own beside the state root, and so is the
  // package store -- but the store is the caller's spelling, which may sit
  // anywhere, so its boundary is the store itself: the leaf's owner bits are
  // repaired, its ancestors are the caller's and are never touched.
  directory.ensureOwnedDirectory(agentDir, login.packages === undefined ? dirname(login.stateRoot) : agentDir);
  const env: Record<string, string> = {};
  // The user's own Pi settings (its agent and session directories) are not oma's engine's.
  for (const [name, value] of Object.entries(login.env))
    if (typeof value === "string" && !name.startsWith("PI_CODING_AGENT_")) env[name] = value;
  Object.assign(env, piIsolationEnv(runtime), { [PI_AGENT_DIR_ENV]: agentDir });
  const storageArgs = runtime.source === "bundled" ? ["--import", join(login.libdir, DEPLOYMENT_LAYOUT.settingsPreload)] : [];
  const child = spawnInteractive(runtime.executable, [...storageArgs, ...runtime.args, ...(login.packages?.args ?? [])], agentDir, env, login.fence);
  return new Promise(resolve => {
    let failed = false;
    // An error/exit notification cannot return the caller's lock while the
    // child's own handles are still open. Spawn failure also ends with close.
    child.once("close", (code, signal) => { resolve(failed || signal !== null ? 1 : code ?? 1); });
    child.on("error", () => { failed = true; });
  });
}
