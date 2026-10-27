// Mechanism only: callers decide whether a known nonzero exit is a domain fact.
// A timeout/signal/spawn failure is never represented as an empty successful read.
import { spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { validateCommand, processErrorCode as errorCode, type CommandSpec, type ProcessObservation, type Capture } from "./command.js";
import { decodeUtf8 } from "@oma/domain/utf8";
import { fencedStdio, inheritedFence, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./fence.js";
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
 * section. This direct-child result is not proof that an entire execution scope is dead.
 */
export function runProcessSync(spec: CommandSpec, invoke: SyncInvoker = spawnSync, inheritedFds: readonly number[] = []): ProcessObservation {
  validateCommand(spec);
  if (spec.timeoutMs === null || spec.stdoutOverflow === "discard")
    throw new TypeError("the synchronous runner requires a native bounded deadline and stdout capture; use runProcess");
  if (spec.timeoutMs > 0x7fffffff)
    throw new RangeError("the synchronous runner cannot represent this native timeout; use runProcess");
  if (inheritedFds.some(fd => !Number.isInteger(fd) || fd < 0)) throw new TypeError("invalid inherited descriptor");
  // Honesty, not capability: a synchronous spawn sees no bytes mid-flight, so
  // a silence window would be a fixed deadline in disguise. Spilling is the
  // opposite case -- a descriptor the child writes to directly keeps the
  // whole stream with no buffer bound at all.
  if (spec.silenceMs !== undefined)
    throw new TypeError("the synchronous runner cannot observe progress; use runProcess");
  const started = performance.now();
  const fence = inheritedFds.length === 0 ? inheritedFence() : undefined;
  // A spooled stream is handed to the child as its own descriptor: the
  // complete bytes land in the caller's file and the observation's buffer is
  // empty (the path is in `stdoutSpooledTo`/`stderrSpooledTo`). The fds are
  // this call's -- opened here, closed here -- never the child's to keep.
  const spoolFd = (path: string | undefined): number | null =>
    path === undefined ? null : openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  const outFd = spoolFd(spec.stdoutSpool);
  // The second open sits ahead of the invoke try/finally that returns these
  // descriptors, so its failure must close the first one itself: the error is
  // the open's own and still reaches the caller, but nothing else ever sees
  // the fd it would strand.
  let errFd: number | null;
  try {
    errFd = spoolFd(spec.stderrSpool);
  } catch (error) {
    if (outFd !== null) try { closeSync(outFd); } catch { /* the file is the caller's; the descriptor was ours */ }
    throw error;
  }
  let result: NativeSyncResult;
  try {
    result = invoke(spec.executable, [...spec.argv], { env: { ...spec.env,
      ...(fence === undefined ? {} : { [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) }) }, cwd: spec.cwd,
      // The output encoding "buffer" is not a valid Buffer.from string encoding.
      // Encode stdin first so native spawnSync never applies it to a string.
      input: spec.input === undefined ? undefined : Buffer.from(spec.input),
      encoding: "buffer", shell: false, timeout: spec.timeoutMs, killSignal: "SIGKILL",
      // Preserve the existing native cap, not the sum of two legacy caps.
      maxBuffer: Math.max(1, spec.stdoutBytes, spec.stderrBytes), stdio: inheritedFds.length > 0
        ? [spec.stdinFd ?? "pipe", outFd ?? "pipe", errFd ?? "pipe", ...inheritedFds]
        : fencedStdio([spec.stdinFd ?? "pipe", outFd ?? "pipe", errFd ?? "pipe"] as const, "ignore", fence),
    });
  } catch (error) {
    return { kind: "spawn-failed", exitCode: null, signal: null, errorCode: errorCode(error), elapsedMs: performance.now() - started,
      stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false };
  } finally {
    if (outFd !== null) try { closeSync(outFd); } catch { /* the file is the caller's; the descriptor was ours */ }
    if (errFd !== null) try { closeSync(errFd); } catch { /* same */ }
  }
  const stdout = bytes(result.stdout); const stderr = bytes(result.stderr);
  const stdoutTruncated = outFd === null && stdout !== null && stdout.length > spec.stdoutBytes;
  const stderrTruncated = errFd === null && stderr !== null && stderr.length > spec.stderrBytes;
  const limited = stdoutTruncated || (stderrTruncated && spec.stderrOverflow !== "discard");
  const kind = stdout === null || stderr === null ? "unobserved" : classify(result, limited);
  const capture: Capture = {
    stdout: Buffer.from((stdout ?? Buffer.alloc(0)).subarray(0, outFd === null ? spec.stdoutBytes : 0)),
    stderr: Buffer.from((stderr ?? Buffer.alloc(0)).subarray(0, errFd === null ? spec.stderrBytes : 0)),
    ...(outFd === null ? {} : { stdoutSpooledTo: spec.stdoutSpool }),
    ...(errFd === null ? {} : { stderrSpooledTo: spec.stderrSpool }),
    stdoutTruncated, stderrTruncated, signal: result.signal, errorCode: errorCode(result.error), elapsedMs: performance.now() - started,
  };
  if (kind === "exited" && typeof result.status === "number") return { ...capture, kind, exitCode: result.status };
  return { ...capture, kind: kind === "exited" ? "unobserved" : kind, exitCode: result.status };
}
export function decodeProcessText(bytes: Uint8Array): string { return decodeUtf8(bytes); }
