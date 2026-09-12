// Mechanism only: callers decide whether a known nonzero exit is a domain fact.
// A timeout/signal/spawn failure is never represented as an empty successful read.
import { spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
import { performance } from "node:perf_hooks";
import { validateCommand, processErrorCode as errorCode, type CommandSpec, type ProcessObservation, type Capture } from "./command.js";
export { validateCommand, snapshotCommand } from "./command.js";
export type { CommandSpec, ProcessObservation } from "./command.js";
export { runProcess, startProcess } from "./async.js";
export type { AsyncProcessOptions, ProcessTask } from "./async.js";

export interface NativeSyncResult {
  readonly status: number | null; readonly signal: NodeJS.Signals | null;
  readonly stdout: unknown; readonly stderr: unknown; readonly error?: Error;
}
export type SyncInvoker = (command: string, argv: string[], options: SpawnSyncOptionsWithBufferEncoding) => NativeSyncResult;
function bytes(value: unknown): Buffer | null {
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  return typeof value === "string" ? Buffer.from(value, "utf8") : null;
}
function classify(result: NativeSyncResult, limited: boolean): ProcessObservation["kind"] {
  const code = errorCode(result.error);
  if (code === "ETIMEDOUT") return "timed-out";
  if (code === "ENOBUFS" || limited) return "output-limited";
  if (result.error) return "spawn-failed";
  if (result.signal) return "signalled";
  return typeof result.status === "number" && Number.isSafeInteger(result.status) && result.status >= 0 ? "exited" : "unobserved";
}
/** Bounded synchronous commands remain available for the final authority/CAS
 * section. This direct-child result is not proof that an entire cgroup is dead.
 */
export function runProcessSync(spec: CommandSpec, invoke: SyncInvoker = spawnSync): ProcessObservation {
  validateCommand(spec);
  const started = performance.now();
  let result: NativeSyncResult;
  try {
    result = invoke(spec.executable, [...spec.argv], { env: { ...spec.env }, cwd: spec.cwd,
      input: spec.input === undefined ? undefined : typeof spec.input === "string" ? spec.input : Buffer.from(spec.input),
      encoding: "buffer", shell: false, timeout: spec.timeoutMs, killSignal: "SIGKILL",
      // Preserve the existing native cap, not the sum of two legacy caps.
      maxBuffer: Math.max(1, spec.stdoutBytes, spec.stderrBytes), stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return { kind: "spawn-failed", exitCode: null, signal: null, errorCode: errorCode(error), elapsedMs: performance.now() - started,
      stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false };
  }
  const stdout = bytes(result.stdout); const stderr = bytes(result.stderr);
  const stdoutTruncated = stdout !== null && stdout.length > spec.stdoutBytes;
  const stderrTruncated = stderr !== null && stderr.length > spec.stderrBytes;
  const limited = stdoutTruncated || (stderrTruncated && spec.stderrOverflow !== "discard");
  const kind = stdout === null || stderr === null ? "unobserved" : classify(result, limited);
  const capture: Capture = {
    stdout: Buffer.from((stdout ?? Buffer.alloc(0)).subarray(0, spec.stdoutBytes)),
    stderr: Buffer.from((stderr ?? Buffer.alloc(0)).subarray(0, spec.stderrBytes)),
    stdoutTruncated, stderrTruncated, signal: result.signal, errorCode: errorCode(result.error), elapsedMs: performance.now() - started,
  };
  if (kind === "exited" && typeof result.status === "number") return { ...capture, kind, exitCode: result.status };
  return { ...capture, kind: kind === "exited" ? "unobserved" : kind, exitCode: result.status };
}
export function decodeProcessText(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
