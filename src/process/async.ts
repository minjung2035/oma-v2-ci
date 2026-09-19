import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
export type { ChildProcess, ChildProcessWithoutNullStreams };
import { performance } from "node:perf_hooks";
import { snapshotCommand, processErrorCode, type CommandSpec, type ProcessObservation, type Capture } from "./command.js";
import { StoreError } from "../domain/errors.js";

export interface AsyncProcessOptions {
  /** Host/coordinator cancellation only. Connection close must not cancel accepted work. */
  readonly signal?: AbortSignal;
  /** Pinned preparation commands may own a Linux process group, never a systemd scope. */
  readonly processGroup?: boolean;
  /** Owned file capabilities mapped to child descriptors 3, 4, ...; never pathname reopens. */
  readonly inheritedFds?: readonly number[];
}
export interface ProcessTask {
  readonly result: Promise<ProcessObservation>;
  /** Direct child and its stdio actually closed. A bounded unknown result may precede this. */
  readonly closed: Promise<void>;
  cancel(): void;
}
/** This is not an arbitrary-descendant/cgroup death oracle. Group termination
 * is requested only while the original direct child is still alive; an exited
 * PID is never reused as a signal target. Escaped descendants require the native
 * profile's separate proof and cannot authorize artifact cleanup here.
 */
export function startProcess(source: CommandSpec, options: AsyncProcessOptions = {}): ProcessTask {
  const spec = snapshotCommand(source);
  const ownGroup = options.processGroup === true;
  if (ownGroup && process.platform !== "linux") throw new TypeError("owned process-group preparation requires Linux");
  const signal = options.signal;
  const inheritedFds = [...(options.inheritedFds ?? [])];
  if (inheritedFds.some(fd => !Number.isInteger(fd) || fd < 0)) throw new TypeError("invalid inherited descriptor");
  const started = performance.now();
  let resolveResult!: (value: ProcessObservation) => void;
  let resolveClosed!: () => void;
  const result = new Promise<ProcessObservation>(resolve => { resolveResult = resolve; });
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const empty = (kind: "aborted" | "spawn-failed", error: unknown = null): ProcessObservation => ({ kind, exitCode: null,
    signal: null, errorCode: processErrorCode(error), elapsedMs: performance.now() - started,
    stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false });
  if (signal?.aborted) { resolveResult(empty("aborted")); resolveClosed(); return { result, closed, cancel() {} }; }
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(spec.executable, [...spec.argv], { cwd: spec.cwd, env: { ...spec.env }, shell: false,
      detached: ownGroup, stdio: ["pipe", "pipe", "pipe", ...inheritedFds] });
  } catch (error) { resolveResult(empty("spawn-failed", error)); resolveClosed(); return { result, closed, cancel() {} }; }
  const out: Buffer[] = [], err: Buffer[] = [];
  let outBytes = 0, errBytes = 0, outLimited = false, errLimited = false;
  let failure: ProcessObservation["kind"] | null = null, nativeError: unknown = null;
  let returned = false, observedClose = false, exited = false, terminationRequested = false;
  let observedExit: number | null = null, observedSignal: NodeJS.Signals | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = (kind: ProcessObservation["kind"], exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
    if (returned) return;
    returned = true; clearTimeout(timer); if (drainTimer) clearTimeout(drainTimer);
    signal?.removeEventListener("abort", onAbort);
    const capture: Capture = { stdout: Buffer.concat(out, outBytes), stderr: Buffer.concat(err, errBytes),
      stdoutTruncated: outLimited, stderrTruncated: errLimited, signal: exitSignal, errorCode: processErrorCode(nativeError), elapsedMs: performance.now() - started };
    out.length = 0; err.length = 0;
    if (kind === "exited" && typeof exitCode === "number") resolveResult({ ...capture, kind, exitCode });
    else resolveResult({ ...capture, kind: kind === "exited" ? "unobserved" : kind, exitCode });
  };
  const drainExpired = (): void => {
    if (observedClose) return;
    // Retention is already byte-bounded. Close our own handles, not purported
    // worker descendants. The owner keeps an uncertain preparation slot blocked.
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    child.unref();
    finish("unobserved", observedExit, observedSignal);
  };
  const startDrainDeadline = (): void => {
    // Reuse the existing per-command timeout for a separate bounded drain phase;
    // no new host resource field or magic grace interval is introduced.
    drainTimer ??= setTimeout(drainExpired, spec.timeoutMs);
  };
  const terminate = (reason: ProcessObservation["kind"]): void => {
    if (observedClose || returned) return;
    failure ??= reason; startDrainDeadline();
    if (terminationRequested || exited) return;
    terminationRequested = true;
    try {
      if (ownGroup && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (error) {
      nativeError ??= error;
      // A group signal error is not group death. Still attempt this owned child.
      try { if (!exited) child.kill("SIGKILL"); } catch (secondary) { nativeError ??= secondary; }
    }
  };
  const onAbort = (): void => terminate("aborted");
  const timer = setTimeout(() => terminate("timed-out"), spec.timeoutMs);
  const collect = (value: Buffer, output: boolean): void => {
    if (returned) return;
    if (!Buffer.isBuffer(value)) { terminate("unobserved"); return; }
    const remaining = Math.max(0, output ? spec.stdoutBytes - outBytes : spec.stderrBytes - errBytes);
    if (remaining > 0) {
      const keep = Buffer.from(value.subarray(0, remaining));
      (output ? out : err).push(keep);
      if (output) outBytes += keep.length; else errBytes += keep.length;
    }
    if (value.length > remaining) {
      if (output) outLimited = true; else errLimited = true;
      if (output || spec.stderrOverflow !== "discard") terminate("output-limited");
    }
  };
  const streamError = (error: Error): void => { nativeError ??= error; terminate("unobserved"); };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
  child.stdout?.on("error", streamError); child.stderr?.on("error", streamError); child.stdin?.on("error", streamError);
  child.once("error", error => { nativeError ??= error; failure ??= "spawn-failed"; startDrainDeadline(); });
  child.once("exit", (code, exitSignal) => { exited = true; observedExit = code; observedSignal = exitSignal; startDrainDeadline(); });
  child.once("close", (code, exitSignal) => {
    observedClose = true; clearTimeout(timer); if (drainTimer) clearTimeout(drainTimer);
    signal?.removeEventListener("abort", onAbort);
    const kind = failure ?? (exitSignal ? "signalled" : typeof code === "number" && Number.isSafeInteger(code) && code >= 0 ? "exited" : "unobserved");
    finish(kind, code, exitSignal); resolveClosed();
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try { child.stdin?.end(spec.input === undefined ? undefined : typeof spec.input === "string" ? spec.input : Buffer.from(spec.input)); }
  catch (error) { nativeError ??= error; terminate("unobserved"); }
  return Object.freeze({ result, closed, cancel: onAbort });
}
export function runProcess(spec: CommandSpec, options: AsyncProcessOptions = {}): Promise<ProcessObservation> {
  return startProcess(spec, options).result;
}

function validDirectSpawn(executable: string, argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>): void {
  if (!executable.startsWith("/") || executable.includes("\0") || !cwd.startsWith("/") || cwd.includes("\0") ||
      argv.some(value => typeof value !== "string" || value.includes("\0")))
    throw new StoreError("UNSUPPORTED_PROFILE", "owned child requires absolute NUL-free paths and direct argv");
  for (const [key, value] of Object.entries(env))
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0"))
      throw new StoreError("UNSUPPORTED_PROFILE", "owned child environment is invalid");
}
export function spawnOwnedRpc(executable: string, argv: readonly string[], cwd: string, env: Readonly<Record<string, string>>): ChildProcessWithoutNullStreams {
  validDirectSpawn(executable, argv, cwd, env);
  return spawn(executable, [...argv], { cwd, env: { ...env }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
}
/** A long-lived service this process owns, such as the society's broker.
 *
 * stdin is closed and stdout discarded: a supervised service shares the
 * product's terminal, and anything it wrote there would corrupt the screen.
 * stderr stays open because it is the service's operational channel, and a
 * service that failed silently is indistinguishable from one that is idle.
 */
/** A supervised service child. `extraPipe` gives it one additional write end at
 * descriptor 3: a channel only this parent holds, for a value that must not be
 * published anywhere a third process could read it. */
export function spawnSupervisedService(executable: string, argv: readonly string[],
  env: Readonly<Record<string, string>>, extraPipe = false): ChildProcess {
  validDirectSpawn(executable, argv, "/", env);
  const stdio: ("ignore" | "pipe")[] = ["ignore", "ignore", "pipe"];
  if (extraPipe) stdio.push("pipe");
  return spawn(executable, [...argv], { env: { ...env }, shell: false, stdio });
}
export function spawnSandboxed(argv: readonly string[], env: Readonly<Record<string, string>>): ChildProcessWithoutNullStreams {
  if ((argv[0] !== "bwrap" && argv[0] !== "/usr/bin/bwrap") || argv.length < 2)
    throw new StoreError("UNSUPPORTED_PROFILE", "sandbox spawn requires direct pinned bubblewrap argv");
  validDirectSpawn("/usr/bin/bwrap", argv.slice(1), "/", env);
  return spawn("/usr/bin/bwrap", argv.slice(1), { env: { ...env }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
}
