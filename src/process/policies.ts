import { StoreError } from "../domain/errors.js";
import { runProcess, runProcessSync, decodeProcessText, type ProcessObservation } from "./run.js";

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
export function runQuarantineCommand(executable: "/usr/bin/git" | "systemd-run", argv: readonly string[], timeoutMs: number, maxBuffer: number): TextExit {
  return requireTextExit(runProcessSync({ executable, argv, env: GIT_ENV, timeoutMs, stdoutBytes: maxBuffer, stderrBytes: maxBuffer }), executable);
}
/** A read-only view may expose a bounded, explicitly truncated stdout prefix.
 * That prefix is never passed to a Git/cgroup/ref decision parser.
 */
export async function runJournal(argv: readonly string[], maxBytes: number): Promise<{ bytes: Buffer; truncated: boolean }> {
  const result = await runProcess({ executable: "journalctl", argv, env: { ...process.env },
    timeoutMs: 30000, stdoutBytes: maxBytes, stderrBytes: 16 * 1024,
    // Command diagnostics stay bounded but never terminate the read: only the
    // requested stdout prefix governs this view's success.
    stderrOverflow: "discard" });
  return journalView(result);
}
/** What a journal read shows. A bounded view may resolve with an explicitly
 * truncated prefix, exactly as the previous view implementation did;
 * truncation is never silent. P0V-121 (G10-05): the prefix stands only when
 * this view's own byte bound ended the read, or the reader exited on its
 * own: a read aborted, signalled or unobserved is not a view that was cut
 * short, and fails as what it was. */
export function journalView(result: ProcessObservation): { bytes: Buffer; truncated: boolean } {
  if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "journalctl timed out");
  if (result.stdoutTruncated && (result.kind === "output-limited" || result.kind === "exited"))
    return { bytes: result.stdout, truncated: true };
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("INTERNAL_ERROR", `journalctl outcome is ${result.kind}` +
      (result.stderr.byteLength === 0 ? "" : `: ${result.stderr.toString("utf8").slice(0, 300)}`));
  return { bytes: result.stdout, truncated: false };
}
