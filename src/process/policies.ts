import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { StoreError } from "../domain/errors.js";
import { runProcess, runProcessSync, decodeProcessText, type ProcessObservation, type CommandSpec } from "./run.js";

export const GIT_ENV: Readonly<NodeJS.ProcessEnv> = Object.freeze({
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all",
  GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
});
export interface TextExit { readonly status: number; readonly stdout: string; readonly stderr: string }
export function requireTextExit(result: ProcessObservation, command: string): TextExit {
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", `${command} timed out`);
  if (result.kind === "output-limited") throw new StoreError("LIMIT_EXCEEDED", `${command} output exceeded its bound`);
  if (result.kind !== "exited") throw new StoreError("INTERNAL_ERROR", `${command} outcome is ${result.kind}${result.errorCode ? ` (${result.errorCode})` : ""}`);
  try { return { status: result.exitCode, stdout: decodeProcessText(result.stdout), stderr: decodeProcessText(result.stderr) }; }
  catch { throw new StoreError("INTERNAL_ERROR", `${command} returned invalid UTF-8 text`); }
}
export interface GitTextOptions {
  readonly gitDir?: string; readonly cwd?: string; readonly input?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>; readonly timeout?: number; readonly maxBuffer?: number;
}
export function runGitText(argv: readonly string[], options: GitTextOptions = {}): TextExit {
  const budget = options.maxBuffer ?? 32 * 1024 * 1024;
  return requireTextExit(runProcessSync({ executable: "/usr/bin/git",
    argv: [...(options.gitDir ? ["--git-dir", options.gitDir] : []), ...argv],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.input === undefined ? {} : { input: options.input }),
    env: { ...GIT_ENV, ...options.env },
    timeoutMs: options.timeout ?? 30000, stdoutBytes: budget, stderrBytes: budget,
  }), "git");
}
/** Existing lifecycle call shape, constrained to its named executable policy. */
export function runWorkspaceGit(command: string, argv: readonly string[], options: SpawnSyncOptionsWithStringEncoding): TextExit {
  if (command !== "/usr/bin/git" || options.shell) throw new StoreError("INTERNAL_ERROR", "workspace policy requires direct pinned Git");
  if (options.cwd !== undefined && typeof options.cwd !== "string") throw new StoreError("INTERNAL_ERROR", "workspace Git requires a string cwd");
  if (options.input !== undefined && typeof options.input !== "string" && !Buffer.isBuffer(options.input)) throw new StoreError("INTERNAL_ERROR", "unsupported workspace Git input");
  return requireTextExit(runProcessSync({ executable: command, argv,
    ...(typeof options.cwd === "string" ? { cwd: options.cwd } : {}),
    ...(options.input === undefined ? {} : { input: typeof options.input === "string" ? options.input : Buffer.from(options.input) }),
    env: options.env ?? GIT_ENV,
    timeoutMs: options.timeout ?? 120000, stdoutBytes: options.maxBuffer ?? 4 * 1024 * 1024, stderrBytes: options.maxBuffer ?? 4 * 1024 * 1024,
  }), "workspace git");
}
export function runQuarantineCommand(executable: "/usr/bin/git" | "systemd-run", argv: readonly string[], timeoutMs: number, maxBuffer: number): TextExit {
  return requireTextExit(runProcessSync({ executable, argv, env: GIT_ENV, timeoutMs, stdoutBytes: maxBuffer, stderrBytes: maxBuffer }), executable);
}
/** A read-only view may expose a bounded, explicitly truncated stdout prefix.
 * That prefix is never passed to a Git/cgroup/ref decision parser.
 */
export async function runJournal(argv: readonly string[], maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const result = await runProcess({ executable: "journalctl", argv, env: { ...process.env },
    timeoutMs: 30000, stdoutBytes: maxBytes, stderrBytes: 16 * 1024 });
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "journalctl timed out");
  if (result.kind === "output-limited" && result.stdoutTruncated && !result.stderrTruncated) return { bytes: result.stdout, truncated: true };
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("INTERNAL_ERROR", `journalctl outcome is ${result.kind}` +
      (result.stderr.byteLength === 0 ? "" : `: ${result.stderr.toString("utf8").slice(0, 300)}`));
  return { bytes: result.stdout, truncated: false };
}
/** Explicitly interactive, host-user command policy. No shell concatenation.
 * Its inherited terminal output is not a captured observation or artifact proof.
 */
export function runHostEditor(executable: string, argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const spec: CommandSpec = { executable, argv, cwd, env: { ...env }, timeoutMs: 30 * 60 * 1000, stdoutBytes: 0, stderrBytes: 0 };
  const result = runProcessSync(spec, (command, args, options) => spawnSync(command, args, { ...options, stdio: "inherit" }));
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "host editor timed out");
  if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("INVALID_REQUEST", "editor failed");
}
