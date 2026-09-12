// Mechanism only: callers decide whether a known nonzero exit is a domain fact.
// A timeout/signal/spawn failure is never represented as an empty successful read.
import { spawn, spawnSync, type SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface CommandSpec {
  readonly executable: string; readonly argv: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv>; readonly cwd?: string;
  readonly input?: string | Uint8Array;
  readonly timeoutMs: number; readonly stdoutBytes: number; readonly stderrBytes: number;
  /** Discard is only for diagnostics. Decision stdout always fails on overflow. */
  readonly stderrOverflow?: "limit" | "discard";
}
interface Capture {
  readonly stdout: Buffer; readonly stderr: Buffer;
  readonly stdoutTruncated: boolean; readonly stderrTruncated: boolean;
  readonly signal: NodeJS.Signals | null; readonly errorCode: string | null; readonly elapsedMs: number;
}
export type ProcessObservation = Capture & (
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "timed-out" | "output-limited" | "signalled" | "spawn-failed" | "unobserved"; readonly exitCode: number | null }
);
export interface NativeSyncResult {
  readonly status: number | null; readonly signal: NodeJS.Signals | null;
  readonly stdout: unknown; readonly stderr: unknown; readonly error?: Error;
}
export type SyncInvoker = (command: string, argv: string[], options: SpawnSyncOptionsWithBufferEncoding) => NativeSyncResult;
function positive(value: number, label: string, zero = false): void {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new RangeError(`invalid subprocess ${label}`);
}
export function validateCommand(spec: CommandSpec): void {
  if (!spec.executable || spec.executable.includes("\0") || spec.argv.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("invalid subprocess command");
  positive(spec.timeoutMs, "timeout"); positive(spec.stdoutBytes, "stdout budget", true); positive(spec.stderrBytes, "stderr budget", true);
  if (spec.timeoutMs > 0x7fffffff) throw new RangeError("subprocess timeout exceeds the supported native timer interval");
  positive(spec.stdoutBytes + spec.stderrBytes, "combined output budget", true);
  if (spec.stderrOverflow !== undefined && spec.stderrOverflow !== "limit" && spec.stderrOverflow !== "discard") throw new TypeError("invalid subprocess stderr policy");
}
function errorCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
function bytes(value: unknown): Buffer | null {
  if (value === null || value === undefined) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  // String results are permitted only for an explicitly injected legacy adapter.
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
/** Native synchronous execution returns only after its direct child has settled.
 * It is not evidence that an entire cgroup or unrelated descendant tree is dead.
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
      // Native ENOBUFS is uncertain even when diagnostic discard is requested.
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

/** Resolve only on close, not exit/error or a kill request. All output prefixes
 * and listeners belong to this invocation until that settlement point.
 */
export function runProcess(spec: CommandSpec): Promise<ProcessObservation> {
  validateCommand(spec);
  const started = performance.now();
  return new Promise(resolve => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(spec.executable, [...spec.argv], { cwd: spec.cwd, env: { ...spec.env }, shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (error) {
      resolve({ kind: "spawn-failed", exitCode: null, signal: null, errorCode: errorCode(error), elapsedMs: performance.now() - started,
        stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false }); return;
    }
    const out: Buffer[] = []; const err: Buffer[] = [];
    let outBytes = 0; let errBytes = 0; let outLimited = false; let errLimited = false;
    let failure: ProcessObservation["kind"] | null = null; let nativeError: unknown = null; let settled = false;
    const terminate = (reason: ProcessObservation["kind"]) => {
      failure ??= reason;
      try { child.kill("SIGKILL"); } catch (error) { nativeError ??= error; }
    };
    const timer = setTimeout(() => terminate("timed-out"), spec.timeoutMs);
    const collect = (value: Buffer, output: boolean) => {
      if (!Buffer.isBuffer(value)) { terminate("unobserved"); return; }
      const remaining = Math.max(0, (output ? spec.stdoutBytes - outBytes : spec.stderrBytes - errBytes));
      if (remaining > 0) {
        const retained = Buffer.from(value.subarray(0, remaining));
        (output ? out : err).push(retained);
        if (output) outBytes += retained.length; else errBytes += retained.length;
      }
      if (value.length > remaining) {
        if (output) outLimited = true; else errLimited = true;
        if (output || spec.stderrOverflow !== "discard") terminate("output-limited");
      }
    };
    const streamError = (error: Error) => { nativeError ??= error; terminate("unobserved"); };
    child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stdout?.on("error", streamError); child.stderr?.on("error", streamError);
    child.once("error", error => { nativeError = error; failure ??= "spawn-failed"; });
    child.stdin?.on("error", streamError);
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const capture: Capture = { stdout: Buffer.concat(out, outBytes), stderr: Buffer.concat(err, errBytes),
        stdoutTruncated: outLimited, stderrTruncated: errLimited, signal, errorCode: errorCode(nativeError), elapsedMs: performance.now() - started };
      const kind = failure ?? (signal ? "signalled" : typeof exitCode === "number" && Number.isSafeInteger(exitCode) && exitCode >= 0 ? "exited" : "unobserved");
      if (kind === "exited" && typeof exitCode === "number") resolve({ ...capture, kind, exitCode });
      else resolve({ ...capture, kind: kind === "exited" ? "unobserved" : kind, exitCode });
    });
    try { child.stdin?.end(spec.input === undefined ? undefined : typeof spec.input === "string" ? spec.input : Buffer.from(spec.input)); }
    catch (error) { nativeError ??= error; terminate("unobserved"); }
  });
}
export function decodeProcessText(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
