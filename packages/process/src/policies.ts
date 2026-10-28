import { StoreError } from "@oma/domain/errors";
import { runProcessSync, decodeProcessText, type ProcessObservation } from "./run.js";

export const GIT_ENV: Readonly<NodeJS.ProcessEnv> = Object.freeze({
  HOME: "/nonexistent", PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_CONFIG_COUNT: "3",
  GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsync", GIT_CONFIG_VALUE_1: "all",
  GIT_CONFIG_KEY_2: "core.fsyncMethod", GIT_CONFIG_VALUE_2: "fsync",
});
export interface TextExit { readonly status: number; readonly stdout: string; readonly stderr: string }
export function requireTextExit(result: ProcessObservation, command: string): TextExit {
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", `${command} timed out`);
  if (result.kind === "stalled") throw new StoreError("DEADLINE_EXCEEDED", `${command} produced no output within its silence window`);
  if (result.kind === "output-limited") throw new StoreError("LIMIT_EXCEEDED", `${command} output exceeded its bound`);
  if (result.kind !== "exited") throw new StoreError("INTERNAL_ERROR", `${command} outcome is ${result.kind}${result.errorCode ? ` (${result.errorCode})` : ""}`);
  try { return { status: result.exitCode, stdout: decodeProcessText(result.stdout), stderr: decodeProcessText(result.stderr) }; }
  catch { throw new StoreError("INTERNAL_ERROR", `${command} returned invalid UTF-8 text`); }
}
export interface GitTextOptions {
  readonly gitDir?: string; readonly cwd?: string; readonly input?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>; readonly timeout?: number; readonly maxBuffer?: number;
  /** Descriptors the child keeps, from 3 on: a preparation lease (R6-04). */
  readonly inheritedFds?: readonly number[];
}
export function runGitText(argv: readonly string[], options: GitTextOptions = {}): TextExit {
  const budget = options.maxBuffer ?? 32 * 1024 * 1024;
  return requireTextExit(runProcessSync({ executable: "/usr/bin/git",
    argv: [...(options.gitDir ? ["--git-dir", options.gitDir] : []), ...argv],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.input === undefined ? {} : { input: options.input }),
    env: { ...GIT_ENV, ...options.env },
    timeoutMs: options.timeout ?? 30000, stdoutBytes: budget, stderrBytes: budget,
  }, undefined, options.inheritedFds ?? []), "git");
}
