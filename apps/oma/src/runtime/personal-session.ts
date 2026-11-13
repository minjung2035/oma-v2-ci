/** One history writer until its engine actually exits. No Society lifecycle. */
import { spawnSessionInteractive, stopOwnedChild, type ChildProcess } from "@oma/process/async";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:os";
import { StoreError } from "@oma/domain/errors";
import { HOST_LOSS_SIGNALS } from "@oma/process/host-loss";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { isSessionMode, type SessionMode } from "@oma/domain/session-mode";
import { ProcessLock } from "@oma/native/process-lock";
import { ensureOwnedUserDirectory } from "./user-files.js";
import { newSessionBirth, PERSONAL_SESSIONS, publishSessionBirth, readSessionBirth, type SessionBirth } from "./session-mode.js";
import { PI_AGENT_DIR_ENV, resolvePiRuntime } from "@oma/engine/pi-runtime";

export function personalEnvironment(env: NodeJS.ProcessEnv, agentDir: string): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    if (value !== undefined && !name.startsWith("OMA_") && !name.startsWith("PI_")) clean[name] = value;
  // HOME/PATH and ordinary OS permissions are the Human's, not a role's scratch.
  return { ...clean, [PI_AGENT_DIR_ENV]: agentDir, ...(env.PI_OFFLINE === undefined ? {} : { PI_OFFLINE: env.PI_OFFLINE }) };
}
export function personalBirth(dataRoot: string, cwd: string): { readonly root: string; readonly birth: SessionBirth } {
  const root = join(dataRoot, PERSONAL_SESSIONS, randomUUID());
  const birth = publishSessionBirth(root, newSessionBirth(root, "personal", cwd));
  return { root, birth };
}
/** `next` is the child's declared handoff after a clean exit: `session` is a
 * history to reopen, `mode` a mode re-entry the host restarts. It is never an
 * in-process mode change. */
export type PersonalExit = { readonly code: number; readonly next?: { readonly session?: string; readonly mode?: SessionMode } };
export async function runPersonalSession(options: { readonly root: string; readonly dataRoot: string; readonly libdir: string;
  readonly packages: string; readonly resume?: string; readonly env?: NodeJS.ProcessEnv }): Promise<PersonalExit> {
  const birth = readSessionBirth(options.root);
  if (birth === null || birth.mode !== "personal") throw new StoreError("INVALID_REQUEST", "Personal requires its saved birth record");
  // P0-8: the history directory is inside the session's own root under the
  // data root, all oma-made; repair rather than wedge on a stray's mode.
  ensureOwnedUserDirectory(birth.history, options.dataRoot);
  const lockPath = join(options.root, "history.lock"), lease = ProcessLock.tryAcquire(lockPath);
  if (lease === null) throw new StoreError("BROKER_UNAVAILABLE", "That Personal session is open in another oma window");
  // Host-loss handlers precede the child. A signal that lands between spawn
  // and a later registration would end this host by default and orphan the
  // engine; a JS handler runs only after spawn returns, so it finds the child.
  let child: ChildProcess | undefined, closed = false;
  const errors: unknown[] = [], signals = HOST_LOSS_SIGNALS;
  const attempt = (action: () => void): void => { try { action(); } catch (error) { errors.push(error); } };
  const forward = (signal: NodeJS.Signals): void => {
    if (child === undefined || closed || child.exitCode !== null || child.signalCode !== null) return;
    const target = child;
    attempt(() => {
      if (!target.kill(signal)) throw new StoreError("BROKER_UNAVAILABLE", `Personal could not forward ${signal}`);
    });
  };
  const handlers = signals.map(signal => () => forward(signal));
  const release = (): void => { signals.forEach((name, index) => attempt(() => { process.off(name, handlers[index]!); })); };
  for (const signal of HOST_LOSS_SIGNALS) process.on(signal, handlers[signals.indexOf(signal)]!);
  try {
    const runtime = resolvePiRuntime({ stateRoot: join(options.dataRoot, "personal"), libdir: options.libdir });
    const argv = ["--import", join(options.libdir, DEPLOYMENT_LAYOUT.interactiveToolsPreload),
      join(options.libdir, DEPLOYMENT_LAYOUT.entries.personal), "--root", options.root,
      "--data-root", options.dataRoot, "--libdir", options.libdir, "--packages", options.packages,
      ...(options.resume === undefined ? [] : ["--resume", options.resume])];
    const env = personalEnvironment(options.env ?? process.env, runtime.agentDir);
    if (process.platform === "darwin") env.OMA_PERSONAL_KEYCHAIN = "1";
    lease.assertHeld(lockPath);
    child = spawnSessionInteractive(process.execPath, argv, birth.cwd, env, lease.descriptor);
  } catch (error) {
    release();
    try { lease.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Personal launch and cleanup failed"); }
    throw error;
  }
  const owned = child;
  return new Promise((resolve, reject) => {
    let next: PersonalExit["next"];
    try {
      // Register actual close before acquiring any other listener. Setup failure
      // requests cleanup but cannot return this writer's lease before close.
      owned.once("close", (code, signal) => {
        if (closed) return;
        closed = true;
        release();
        attempt(() => { lease.close(); });
        if (errors.length > 0) {
          reject(errors.length === 1 ? errors[0] : new AggregateError(errors, "Personal execution and cleanup failed"));
          return;
        }
        const status = code ?? (signal === null ? 1 : 128 + (constants.signals[signal] ?? 0));
        resolve({ code: status, ...(status === 0 && next !== undefined ? { next } : {}) });
      });
      owned.on("error", error => { errors.push(error); });
      owned.on("message", value => {
        if (closed || !value || typeof value !== "object" || Array.isArray(value)) return;
        const message = value as Record<string, unknown>;
        if (next !== undefined || message.type !== "switch" || Object.keys(message).some(key => key !== "type" && key !== "session" && key !== "mode")) return;
        if ([message.session, message.mode].filter(value => value !== undefined).length > 1) return;
        if (message.mode !== undefined) { if (isSessionMode(message.mode)) next = { mode: message.mode }; return; }
        if (message.session === undefined) next = {};
        else if (typeof message.session === "string") next = { session: message.session };
      });
    } catch (error) {
      errors.push(error);
      attempt(() => { stopOwnedChild(owned); });
    }
  });
}
