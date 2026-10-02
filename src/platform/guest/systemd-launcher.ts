/** The production `SessionLauncher`: each society session is a transient
 * user unit (`systemd-run --user`) of the oma user, whose manager runs
 * without a login (linger). Being its own unit is what lets the session
 * outlive a guesthost restart, which would otherwise take every process in
 * guesthost's cgroup with it. */
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { runProcess, type CommandSpec } from "../../process/run.js";
import { listening, type SessionLauncher } from "./host.js";
import { RESUME_SESSION_ENV } from "../../runtime/session-catalog.js";

export interface SystemdLauncherOptions {
  /** Where the holders listen: the oma user's runtime directory. */
  readonly sessionsDir: string;
  /** The image's node and the product tree. */
  readonly node: string;
  readonly libdir: string;
  /** What the session's `oma` runs with: HOME, XDG_DATA_HOME, XDG_RUNTIME_DIR, PATH, LANG. */
  readonly env: Readonly<Record<string, string>>;
}

const unitOf = (society: string): string => `oma-session-${society}`;
const command = (executable: string, argv: readonly string[], env: Readonly<Record<string, string>>, timeoutMs: number): CommandSpec =>
  ({ executable, argv, env, timeoutMs, stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024 });

export function systemdSessionLauncher(options: SystemdLauncherOptions): SessionLauncher {
  const socketPath = (society: string): string => join(options.sessionsDir, `${society}.sock`);
  return {
    socketPath,
    async start(society, projectDir, resume) {
      // P0V-106 (G13-04): a society is started only when its session is not
      // serving (host.ts opens one at a time), so a unit under its name is a
      // leftover -- one that never listened, or ended failed -- and is
      // cleared before the new one takes the name. Not loaded is the usual
      // answer; anything else shows in the start that follows.
      await runProcess(command("/usr/bin/systemctl", ["--user", "stop", unitOf(society)], options.env, 30_000));
      await runProcess(command("/usr/bin/systemctl", ["--user", "reset-failed", unitOf(society)], options.env, 10_000));
      const env = { ...options.env, TERM: "xterm-256color" };
      delete (env as Record<string, string>)[RESUME_SESSION_ENV];
      if (resume !== undefined) (env as Record<string, string>)[RESUME_SESSION_ENV] = resume;
      const setenv = Object.entries(env).map(([key, value]) => `--setenv=${key}=${value}`);
      const result = await runProcess(command("/usr/bin/systemd-run", [
        "--user", `--unit=${unitOf(society)}`, "--collect", "--quiet",
        // SIGTERM to the holder alone, which asks `oma` to shut down; the rest
        // only if that has not ended everything in time.
        "--property=KillMode=mixed", "--property=TimeoutStopSec=120",
        `--working-directory=${projectDir}`, ...setenv, "--",
        options.node, join(options.libdir, "dist", "src", "entry", "guest-session.js"),
        "--socket", socketPath(society), "--cwd", projectDir, "--",
        options.node, join(options.libdir, "dist", "src", "entry", "oma.js"), "--society", society,
      ], options.env, 30_000));
      if (result.kind !== "exited" || result.exitCode !== 0)
        throw new StoreError("BROKER_UNAVAILABLE", "the society session could not be started");
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
        if (await listening(socketPath(society), Math.min(500, remaining))) return;
        const pause = Math.min(50, deadline - performance.now());
        if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
      }
      throw new StoreError("BROKER_UNAVAILABLE", "the society session did not come up");
    },
    async stop(society, deadlineMs) {
      const result = await runProcess(command("/usr/bin/systemctl", ["--user", "stop", unitOf(society)], options.env, deadlineMs));
      if (result.kind !== "exited" || result.exitCode !== 0) return "unknown";
      try { return (await listening(socketPath(society))) ? "unknown" : "stopped"; }
      catch { return "unknown"; }
    },
  };
}
