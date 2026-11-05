/** Physical Darwin capture consumes native generation and fileport facts.
 * Shared execution owners still publish, authorize, release and retire. */
import { Socket } from "node:net";
import { closeSync } from "node:fs";
import { constants } from "node:os";
import { snapshotCommand, ExecutionNotStarted, type CommandSpec } from "@oma/domain/process-command";
import { observeProcessIO, type ProcessIO, type ProcessIOOptions } from "./async.js";
import type { BlockedExecution } from "./execution-scope.js";
import { runProcessSync } from "./run.js";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import type { DarwinCoalitionIdentity } from "@oma/native/audit-session";
import { controlPipe } from "@oma/native/control-socket";
import { startDarwinJobControl, type DarwinJobControl, type DarwinJobFile, type DarwinJobImageDigests } from "@oma/native/darwin-job-control";
import { bundledSeatbeltHelper } from "@oma/native/darwin-job-assets";
import { inheritedFence, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./fence.js";
import type { DarwinJobPeer } from "@oma/native/darwin-job-peer";
export { inheritedDarwinJobPeer, peerFromMachReceiver, type DarwinJobPeer } from "@oma/native/darwin-job-peer";
export interface DarwinJobScopeOptions extends ProcessIOOptions {
  /** Borrowed exact directory; no pathname reopen or /dev/fd traversal. */
  readonly directoryFd?: number;
  /** Trusted producer selection, checked against held main-image bytes before creation. */
  readonly imageDigests?: DarwinJobImageDigests;
  readonly files?: readonly DarwinJobFile[];
  readonly stderrFd?: number;
  readonly peer?: DarwinJobPeer;
}
interface Inputs extends DarwinJobScopeOptions {
  readonly images: readonly string[];
  readonly privateInputs?: readonly { readonly fd: number; readonly bytes: Uint8Array }[];
}
/** The same fixed setup subprocess owner, including inherited fence behavior. */
export const darwinSetupProcess = (argv: readonly string[], budgetMs: number) => runProcessSync({ executable: "/bin/launchctl", argv,
  env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" }, timeoutMs: budgetMs, stdoutBytes: 65536, stderrBytes: 65536 });
export async function launchDarwinJobScope(source: CommandSpec, options: DarwinJobScopeOptions = {}): Promise<BlockedExecution<DarwinCoalitionIdentity>> {
  let command: CommandSpec;
  try { command = snapshotCommand(source); } catch (error) { throw new ExecutionNotStarted(error); }
  return launch(command, { ...options, images: [command.executable] });
}
/** Only the package-owned native Seatbelt image may run during preparation.
 * The final target remains stopped until its shared owner's authority check. */
export async function launchPreparedDarwinJobScope(source: CommandSpec, target: string,
  privateInputs: readonly { readonly fd: number; readonly bytes: Uint8Array }[], options: DarwinJobScopeOptions = {}): Promise<BlockedExecution<DarwinCoalitionIdentity>> {
  let command: CommandSpec;
  try {
    command = snapshotCommand(source);
    if (command.executable !== bundledSeatbeltHelper() || typeof target !== "string" || !target.startsWith("/") || target.includes("\0") ||
        Object.entries(command.env).some(([key, value]) => value !== undefined && /^(?:DYLD_|LD_)/.test(key)))
      throw new StoreError("UNSUPPORTED_PROFILE", "Darwin preparation requires the owned Seatbelt image and explicit target");
  } catch (error) { throw new ExecutionNotStarted(error); }
  return launch(command, { ...options, images: [command.executable, target], privateInputs });
}
function terminalStatus(status: number): { code: number | null; signal: NodeJS.Signals | null } {
  if (!Number.isSafeInteger(status) || status < 0 || status > 65535)
    throw new StoreError("RUN_TERMINATION_UNKNOWN", "invalid native child wait status");
  const signal = status & 127;
  if (signal === 0) return { code: status >>> 8 & 255, signal: null };
  const name = Object.entries(constants.signals).find(([, number]) => number === signal)?.[0];
  if (signal === 127 || name === undefined) throw new StoreError("RUN_TERMINATION_UNKNOWN", "native child terminal signal is unobserved");
  return { code: null, signal: name as NodeJS.Signals };
}
async function launch(source: CommandSpec, options: Inputs): Promise<BlockedExecution<DarwinCoalitionIdentity>> {
  const signal = options.signal, stderrFd = options.stderrFd, directoryFd = options.directoryFd;
  const captureOptions: ProcessIOOptions = { ...(signal === undefined ? {} : { signal }),
    ...(options.stdoutSink === undefined ? {} : { stdoutSink: options.stdoutSink }),
    ...(options.stderrSink === undefined ? {} : { stderrSink: options.stderrSink }) };
  let imageDigests: DarwinJobImageDigests | undefined;
  let command: CommandSpec, images: readonly string[], extra: readonly DarwinJobFile[], inputs: readonly { fd: number; bytes: Buffer }[];
  try {
    command = snapshotCommand(source);
    imageDigests = options.imageDigests === undefined ? undefined : Object.freeze({ helper: options.imageDigests.helper,
      images: Object.freeze([...options.imageDigests.images]) });
    images = [...options.images]; extra = (options.files ?? []).map(file => ({ ...file }));
    inputs = (options.privateInputs ?? []).map(input => ({ fd: input.fd, bytes: Buffer.from(input.bytes) }));
    const targets = [...extra.map(file => file.target), ...inputs.map(input => input.fd)];
    if (process.platform !== "darwin" || (process.getuid?.() ?? 0) <= 0 || images.length !== 1 && images.length !== 2 || images[0] !== command.executable ||
        inputs.length > 0 && images.length !== 2 || new Set(targets).size !== targets.length ||
        directoryFd !== undefined && (!Number.isSafeInteger(directoryFd) || directoryFd < 0 || command.cwd !== undefined) ||
        targets.some(fd => !Number.isSafeInteger(fd) || fd < 3 || fd > 65535) ||
        stderrFd !== undefined && (command.stderrBytes !== 0 || captureOptions.stderrSink !== undefined))
      throw new StoreError("UNSUPPORTED_PROFILE", "invalid Darwin job scope inputs");
    if (signal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "job was cancelled before creation");
    // File handoff must retain the parent's cooperation socket too. Explicit
    // preparation/stdio slots may already occupy FD4; the declared child slot
    // follows the actual handoff rather than replacing another capability.
    // This transports an already-held socket; it does not identify a lease
    // or authorize a Host/Broker role.
    const fence = inheritedFence();
    if (fence !== undefined) {
      let target = extra.find(file => file.fd === fence)?.target;
      if (target === undefined) {
        target = SOCIETY_FENCE_FD;
        while (targets.includes(target) && target <= 65535) target++;
        if (target > 65535) throw new StoreError("UNSUPPORTED_PROFILE", "Darwin job has no free cooperation socket slot");
        extra = [...extra, { target, fd: fence }];
      }
      // The trusted scope owner keeps its own fileport reference through
      // independent scope death and capture drain. A workload may close all
      // of its descriptors without giving the Society away.
      extra = extra.map(file => file.fd === fence ? { ...file, retainUntilEmpty: true } : file);
      command = snapshotCommand({ ...command, env: { ...command.env, [SOCIETY_FENCE_ENV]: String(target) } });
    }
  } catch (error) { throw new ExecutionNotStarted(error); }
  const raw = new Set<number>(), streams: Socket[] = [], inputReturns: Promise<void>[] = [], privateDrains: Promise<void>[] = [];
  const pipe = () => { const value = controlPipe(); raw.add(value.read); raw.add(value.write); return value; };
  const closeRaw = () => cleanupAll([...raw].map(fd => () => { raw.delete(fd); closeSync(fd); }));
  const socket = (fd: number, readable: boolean, writable: boolean): Socket => {
    const stream = new Socket({ fd, readable, writable }); raw.delete(fd); streams.push(stream);
    inputReturns.push(new Promise<void>(yes => stream.once("close", yes))); return stream;
  };
  let control: DarwinJobControl | undefined, stopRequested = false, attempted = false;
  let onError: Parameters<ProcessIO["onError"]>[0] = () => {}, onExit: Parameters<ProcessIO["onExit"]>[0] = () => {},
    onClose: Parameters<ProcessIO["onClose"]>[0] = () => {};
  let status: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };
  let task: ReturnType<typeof observeProcessIO> | undefined;
  try {
    const input = command.stdinFd === undefined ? pipe() : undefined, output = pipe();
    const errors = stderrFd === undefined ? pipe() : undefined;
    const files: DarwinJobFile[] = [{ target: 0, fd: input?.read ?? command.stdinFd! }, { target: 1, fd: output.write },
      { target: 2, fd: errors?.write ?? stderrFd! }, ...extra];
    const stdin = input ? socket(input.write, false, true) : null, stdout = socket(output.read, true, false),
      stderr = errors ? socket(errors.read, true, false) : null;
    const privateWriters = inputs.map(entry => {
      const channel = pipe(), writer = socket(channel.write, false, true); files.push({ target: entry.fd, fd: channel.read });
      const drained = new Promise<void>((yes, no) => { writer.once("error", no); writer.once("close", yes); });
      void drained.catch(() => {}); privateDrains.push(drained); return { writer, bytes: entry.bytes };
    });
    const io: ProcessIO = { stdin, stdout, stderr, ...(errors ? {} : { stderrForwarded: true }),
      onError: listener => { onError = listener; }, onExit: listener => { onExit = listener; }, onClose: listener => { onClose = listener; },
      terminate() { stopRequested = true; control?.terminate(); } };
    task = observeProcessIO(command, io, captureOptions);
    for (const { writer, bytes } of privateWriters) {
      writer.on("error", error => onError(error, "unobserved")); writer.end(bytes);
    }
    // After child creation is attempted, first acquire its blocked kernel
    // identity. A late cancellation stops that identity before any setup gate.
    attempted = true; control = await startDarwinJobControl(command, files, images, darwinSetupProcess, undefined, options.peer, directoryFd, imageDigests);
    const job = control, capture = task;
    void job.terminal.then(ended => {
      if (ended.kind === "waited") { status = terminalStatus(ended.waitStatus); onExit(status.code, status.signal); }
    })
      .catch(error => onError(error instanceof Error ? error : new Error("job terminal is unobserved", { cause: error }), "unobserved"));
    void job.closed.then(() => onClose(status.code, status.signal));
    closeRaw();
    if (stopRequested || signal?.aborted) job.terminate();
    const closed = Promise.all([capture.closed, job.closed, ...inputReturns]).then(() => {});
    let prepared: Promise<void> | undefined;
    const terminal = job.terminal.then(() => {}); void terminal.catch(() => {});
    return Object.freeze({ witness: job.identity, result: capture.result, closed,
      pinChild: () => job.pinChild(),
      get prepared() {
        prepared ??= (stopRequested ? Promise.reject(new StoreError("CANCELLED_BEFORE_COMMIT", "job setup was cancelled")) :
          Promise.all([job.prepared, ...privateDrains])).then(() => {});
        void prepared.catch(() => {}); return prepared;
      },
      terminal, population: () => job.population(),
      release() { if (stopRequested) throw new StoreError("CANCELLED_BEFORE_COMMIT", "job release was cancelled"); job.release(); },
      terminate() { stopRequested = true; job.terminate(); }, close: () => job.close() });
  } catch (error) {
    if (!attempted) error = new ExecutionNotStarted(error);
    if (control) try { control.terminate(); } catch (cause) { error = new AggregateError([error, cause]); }
    onError(error instanceof Error ? error : new Error("job source acquisition failed", { cause: error }),
      error instanceof ExecutionNotStarted ? "spawn-failed" : "unobserved");
    if (error instanceof ExecutionNotStarted) onClose(null, null);
    return withAsyncCleanup(async () => {
      for (const stream of streams) stream.destroy();
      await Promise.all(inputReturns);
      if (control) {
        await control.closed;
        if (control.population() === "empty") control.close();
      }
      throw error;
    }, closeRaw);
  }
}
