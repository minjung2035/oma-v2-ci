import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
export type { ChildProcess, ChildProcessWithoutNullStreams };
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { deadline } from "./deadline.js";
import { snapshotCommand, processErrorCode, type CommandSpec, type ProcessObservation, type Capture } from "./command.js";
import { StoreError } from "@oma/domain/errors";
import { fencedStdio, SOCIETY_FENCE_FD, SOCIETY_FENCE_ENV } from "./fence.js";
export { SOCIETY_FENCE_FD, SOCIETY_FENCE_ENV };

const PROCESS_GROUP_PLATFORMS = new Set<NodeJS.Platform>(["linux", "darwin"]);

export interface AsyncProcessOptions {
  /** Synchronous streaming consumer. Bytes are borrowed only for this call;
   * consumer failure terminates the owned child and remains unobserved. */
  readonly stdoutSink?: (bytes: Uint8Array) => void;
  readonly stderrSink?: (bytes: Uint8Array) => void;
  /** A trusted helper can pass its own stderr through without a second
   * unbounded stream buffer. Caller owns this descriptor until child close. */
  readonly stderrFd?: number;
  /** Host/coordinator cancellation only. Connection close must not cancel accepted work. */
  readonly signal?: AbortSignal;
  /** A POSIX direct child may own a process group; this is no descendant fence. */
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

/** This is not an arbitrary-descendant death oracle. Group termination
 * is requested only while the original direct child is still alive; an exited
 * PID is never reused as a signal target. Escaped descendants require the native
 * profile's separate proof and cannot authorize artifact cleanup here.
 */
export function startProcess(source: CommandSpec, options: AsyncProcessOptions = {}): ProcessTask {
  const spec = snapshotCommand(source);
  const ownGroup = options.processGroup === true;
  if (ownGroup && !PROCESS_GROUP_PLATFORMS.has(process.platform))
    throw new TypeError("owned process-group execution requires a supported POSIX platform");
  const signal = options.signal;
  const inheritedFds = [...(options.inheritedFds ?? [])];
  if (inheritedFds.some(fd => !Number.isInteger(fd) || fd < 0)) throw new TypeError("invalid inherited descriptor");
  if (options.stderrFd !== undefined && (!Number.isSafeInteger(options.stderrFd) || options.stderrFd < 0 || options.stderrSink !== undefined || spec.stderrSpool !== undefined))
    throw new TypeError("invalid stderr descriptor or conflicting sink");
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
      detached: ownGroup, stdio: [spec.stdinFd ?? "pipe", "pipe", options.stderrFd ?? "pipe", ...inheritedFds] });
  } catch (error) { resolveResult(empty("spawn-failed", error)); resolveClosed(); return { result, closed, cancel() {} }; }
  const out: Buffer[] = [], err: Buffer[] = [];
  let outBytes = 0, errBytes = 0, outLimited = false, errLimited = false;
  let failure: ProcessObservation["kind"] | null = null, nativeError: unknown = null;
  let returned = false, observedClose = false, exited = false, terminationRequested = false;
  let observedExit: number | null = null, observedSignal: NodeJS.Signals | null = null;
  let drainTimer: (() => void) | undefined;
  let silenceTimer: (() => void) | undefined;
  // An overflowed stream that names a spill file keeps its in-memory head and
  // writes the head plus every later byte to the file, so size alone never
  // kills a command whose output the caller asked to keep whole. The file is
  // this invocation's while it is open; the caller owns it afterwards.
  interface Spool { readonly fd: number; readonly path: string }
  let outSpool: Spool | null = null, errSpool: Spool | null = null;
  const writeAll = (fd: number, value: Buffer): void => {
    for (let at = 0; at < value.length;) {
      const count = writeSync(fd, value, at, value.length - at);
      if (count <= 0) throw new StoreError("INTERNAL_ERROR", "a spill write made no progress");
      at += count;
    }
  };
  const spill = (output: boolean, head: readonly Buffer[]): Spool | null => {
    const path = output ? spec.stdoutSpool! : spec.stderrSpool!;
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { for (const chunk of head) writeAll(fd, chunk); }
      catch (error) { try { closeSync(fd); } catch { /* the open file is the failure's to keep */ } throw error; }
      return { fd, path };
    } catch (error) { nativeError ??= error; return null; }
  };
  const finish = (kind: ProcessObservation["kind"], exitCode: number | null, exitSignal: NodeJS.Signals | null): void => {
    if (returned) return;
    returned = true; timer(); drainTimer?.(); silenceTimer?.();
    signal?.removeEventListener("abort", onAbort);
    for (const spool of [outSpool, errSpool]) if (spool !== null) {
      try { closeSync(spool.fd); } catch (error) { nativeError ??= error; }
    }
    const capture: Capture = { stdout: Buffer.concat(out, outBytes), stderr: Buffer.concat(err, errBytes),
      stdoutTruncated: outLimited, stderrTruncated: errLimited,
      ...(outSpool === null ? {} : { stdoutSpooledTo: outSpool.path }),
      ...(errSpool === null ? {} : { stderrSpooledTo: errSpool.path }),
      ...(options.stderrFd === undefined ? {} : { stderrForwarded: true as const }),
      signal: exitSignal, errorCode: processErrorCode(nativeError), elapsedMs: performance.now() - started };
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
    drainTimer ??= deadline(spec.timeoutMs, drainExpired);
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
  const timer = deadline(spec.timeoutMs, () => terminate("timed-out"));
  // Output is the progress this runner can observe: every byte the command
  // writes re-arms the silence window, so a working command is never cut by
  // the clock and one that says nothing for the whole window ends "stalled".
  const armSilence = (): void => {
    if (spec.silenceMs === undefined || returned || observedClose) return;
    silenceTimer?.();
    silenceTimer = deadline(spec.silenceMs, () => terminate("stalled"));
  };
  armSilence();
  const collect = (value: Buffer, output: boolean): void => {
    if (returned) return;
    if (!Buffer.isBuffer(value)) { terminate("unobserved"); return; }
    const sink = output ? options.stdoutSink : options.stderrSink;
    if (sink !== undefined) {
      try { sink(value); }
      catch (error) { nativeError ??= error; terminate("unobserved"); return; }
    }
    armSilence();
    const budget = output ? spec.stdoutBytes : spec.stderrBytes;
    const kept = output ? outBytes : errBytes;
    const remaining = Math.max(0, budget - kept);
    if (remaining > 0) {
      const keep = Buffer.from(value.subarray(0, remaining));
      (output ? out : err).push(keep);
      if (output) outBytes += keep.length; else errBytes += keep.length;
    }
    if (value.length <= remaining) return;
    // The stream outgrew its in-memory budget. With a spill path the retained
    // head and every later byte go to the file the caller owns -- complete,
    // and the command keeps running; without one the command is ended as
    // before (stdout always, stderr unless the spec said to discard it).
    if (output) outLimited = true; else errLimited = true;
    if ((output ? spec.stdoutSpool : spec.stderrSpool) !== undefined) {
      let spool = output ? outSpool : errSpool;
      if (spool === null) {
        spool = spill(output, output ? out : err);
        if (output) outSpool = spool; else errSpool = spool;
        if (spool === null) { terminate("unobserved"); return; }
      }
      try { writeAll(spool.fd, Buffer.from(value.subarray(remaining))); }
      catch (error) { nativeError ??= error; terminate("unobserved"); }
      return;
    }
    if ((output ? spec.stdoutOverflow : spec.stderrOverflow) !== "discard") terminate("output-limited");
  };
  const streamError = (error: Error): void => { nativeError ??= error; terminate("unobserved"); };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
  child.stdout?.on("error", streamError); child.stderr?.on("error", streamError); child.stdin?.on("error", streamError);
  child.once("error", error => { nativeError ??= error; failure ??= "spawn-failed"; startDrainDeadline(); });
  child.once("exit", (code, exitSignal) => { exited = true; observedExit = code; observedSignal = exitSignal; startDrainDeadline(); });
  child.once("close", (code, exitSignal) => {
    observedClose = true; timer(); drainTimer?.();
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
/** The slot the private channel takes in every fenced child of this product,
 * and the slot the society lease takes.
 *
 * They are fixed numbers rather than "whichever slot came next". A child that
 * starts a child of its own has to hand the fence down -- an engine that runs
 * the model-facing CLI is a real writer of the society's private state, and a
 * CLI still running after its engine is gone is exactly the second writer the
 * lease exists to prevent -- and it can only pass on a descriptor it can name.
 * A slot that moved depending on whether a channel had been requested could be
 * named only by a child that already knew how its own parent had been spawned.
 *
 * So the fence is always descriptor 4, the channel slot below it is held open
 * (as `ignore`) when there is no channel, and the number is declared to the
 * child in `SOCIETY_FENCE_ENV`. Declaring it is safe in a way that declaring
 * the credential would not be: a descriptor number grants nothing to a process
 * that does not already hold the descriptor, and a process that holds it
 * already holds the society open whether or not it knows what it is. */
export const CHANNEL_FD = 3;
/** P0-4: a failed setup never handed its child to a runtime owner. Return every
 * private stream and request termination, attempting all cleanup. This is not
 * an observation of death; callers retaining a lease must still observe it. */
export function stopOwnedChild(child: ChildProcess): void {
  const errors: unknown[] = [];
  const attempt = (action: () => void): void => { try { action(); } catch (error) { errors.push(error); } };
  const ignore = (): void => {};
  attempt(() => { child.on("error", ignore); });
  for (const stream of new Set(child.stdio)) if (stream) {
    attempt(() => { stream.on("error", ignore); });
    attempt(() => { stream.destroy(); });
  }
  if (child.exitCode === null && child.signalCode === null)
    attempt(() => { child.kill("SIGKILL"); });
  if (errors.length > 0) throw new AggregateError(errors, "Owned child cleanup failed");
}

/** Names the fence descriptor to a child that must pass it on. */

/** `channel` adds descriptor 3: a socketpair only this parent holds. It is a
 * socket rather than a pipe on purpose -- another process of the same user
 * can reopen an inherited pipe through /proc/<pid>/fd, but not a socket -- so
 * it can carry a value that must reach this one child and nobody else.
 *
 * `fence` adds descriptor 4: the society lease. The child never reads it. It
 * is inherited so that the lock the lease lives on stays held until this child
 * is gone, which is how "the society does not change hands while this engine
 * runs" survives a parent that is killed outright and runs no teardown at
 * all. */
export function spawnOwnedRpc(executable: string, argv: readonly string[], cwd: string,
  env: Readonly<Record<string, string>>, channel = false, fence?: number): ChildProcessWithoutNullStreams {
  validDirectSpawn(executable, argv, cwd, env);
  return spawn(executable, [...argv], { cwd, env: { ...env }, shell: false,
    stdio: fencedStdio(["pipe", "pipe", "pipe"], channel ? "pipe" : "ignore", fence) }) as ChildProcessWithoutNullStreams;
}
/** The interactive child owns the real terminal; RPC and UI control use private
 * sockets. Credential/fence slots keep their meaning across both launch modes. */
export function spawnOwnedInteractive(executable: string, argv: readonly string[], cwd: string,
  env: Readonly<Record<string, string>>, fence: number): ChildProcess {
  validDirectSpawn(executable, argv, cwd, env);
  return spawn(executable, [...argv], { cwd, env: { ...env }, shell: false,
    stdio: ["inherit", "inherit", "pipe", "pipe", fence, "pipe", "pipe"] });
}

/** A long-lived service this process owns, such as the society's broker.
 *
 * stdin is closed and stdout discarded: a supervised service shares the
 * product's terminal, and anything it wrote there would corrupt the screen.
 * stderr stays open because it is the service's operational channel, and a
 * service that failed silently is indistinguishable from one that is idle.
 */
/** A supervised service child. `extraPipe` gives it descriptor 3: a socketpair
 * only this parent holds. It is the service's supervision channel -- the
 * service learns this parent's identity from it and treats its closing as this
 * parent's death -- and, being a socket, it cannot be reopened by another
 * process through /proc/<pid>/fd the way an inherited pipe can. `fence` gives
 * it the society lease descriptor, so the society cannot pass to another host
 * while this service is still able to write to it. */
/** DR7, D03: a supervised service leads its own session. Its lifetime is its
 * supervision channel and an explicit stop, never the terminal of the process
 * that started it: a hang-up or a job-control signal there does not reach it. */
export function spawnSupervisedService(executable: string, argv: readonly string[],
  env: Readonly<Record<string, string>>, extraPipe = false, fence?: number): ChildProcess {
  validDirectSpawn(executable, argv, "/", env);
  return spawn(executable, [...argv], { env: { ...env }, shell: false, detached: true,
    stdio: fencedStdio(["ignore", "ignore", "pipe"], extraPipe ? "pipe" : "ignore", fence) });
}

/** Lays out a fenced child's descriptors so that the channel is always slot
 * `CHANNEL_FD` and the fence always slot `SOCIETY_FENCE_FD`. An unfenced child
 * gets neither slot: holding one open for nothing would make `ignore` at slot
 * 4 indistinguishable from a fence, and a child that read the environment
 * would pass the wrong descriptor down. */

/** DR18 (D-9): a program the Human uses directly, on this process's own
 * terminal -- stdin, stdout and stderr inherited -- while this process waits.
 * It is started because this process holds the society lease, so it holds
 * the lease too, at SOCIETY_FENCE_FD, like everything the lease starts
 * (REC-007): the society cannot change hands while it runs. */
export function spawnInteractive(executable: string, argv: readonly string[], cwd: string,
  env: Readonly<Record<string, string>>, fence: number): ChildProcess {
  validDirectSpawn(executable, argv, cwd, env);
  const terminal: ("inherit" | "ignore" | number)[] = ["inherit", "inherit", "inherit"];
  while (terminal.length < SOCIETY_FENCE_FD) terminal.push("ignore");
  return spawn(executable, [...argv], { cwd, env: { ...env }, shell: false, stdio: [...terminal, fence] });
}
/** MODE-003/005: an independent Human session, not a Society child. Its
 * history lock is inherited at 3 and Node IPC occupies 4; the caller retains
 * the lock until actual close. No Society credential or lease is passed. */
export function spawnSessionInteractive(executable: string, argv: readonly string[], cwd: string,
  env: Readonly<Record<string, string>>, historyLock: number): ChildProcess {
  validDirectSpawn(executable, argv, cwd, env);
  if (!Number.isSafeInteger(historyLock) || historyLock < 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "a Human session needs its history lock descriptor");
  return spawn(executable, [...argv], { cwd, env: { ...env }, shell: false,
    stdio: ["inherit", "inherit", "inherit", historyLock, "ipc"] });
}
/** Explicit private bootstrap descriptors. OS adapters choose their grammar;
 * this owner validates, copies, delivers and closes every pipe and child. */
export function spawnWithPrivateInputs(executable: string, argv: readonly string[], cwd: string,
  env: Readonly<Record<string, string>>, inputs: readonly { readonly fd: number; readonly bytes: Uint8Array }[]): ChildProcessWithoutNullStreams {
  validDirectSpawn(executable, argv, cwd, env);
  const slots = new Map<number, Buffer>();
  for (const input of inputs) {
    if (!Number.isSafeInteger(input.fd) || input.fd < 3 || input.fd > 0x7fffffff || slots.has(input.fd) || !(input.bytes instanceof Uint8Array))
      throw new StoreError("UNSUPPORTED_PROFILE", "invalid or duplicate private input descriptor");
    slots.set(input.fd, Buffer.from(input.bytes));
  }
  const stdio: ("pipe" | "ignore")[] = ["pipe", "pipe", "pipe"];
  for (let fd = 3; fd <= Math.max(2, ...slots.keys()); fd++) stdio.push(slots.has(fd) ? "pipe" : "ignore");
  const child = spawn(executable, [...argv], { cwd, env: { ...env }, shell: false, stdio }) as ChildProcessWithoutNullStreams;
  try {
    for (const [fd, bytes] of slots) {
      const stream = child.stdio[fd] as { on(event: "error", listener: () => void): void; end(bytes: Uint8Array): void } | null;
      if (!stream || typeof stream.end !== "function") throw new StoreError("INTERNAL_ERROR", "child has no owned private input pipe");
      // EPIPE is an observation for the child owner, never permission to retry
      // an effect. All other setup failures still terminate the owned child.
      stream.on("error", () => {}); stream.end(bytes);
    }
    return child;
  } catch (error) {
    try { stopOwnedChild(child); } catch (cleanup) { throw new AggregateError([error, cleanup], "Private child setup and cleanup failed"); }
    throw error;
  }
}
