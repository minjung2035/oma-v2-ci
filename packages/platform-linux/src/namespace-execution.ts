/** bubblewrap launch mechanics. Shared execution policy publishes the witness
 * before releasing this blocked init. The init retains the gate's writer via
 * --sync-fd: parent EOF cannot accidentally authorize arbitrary execution.
 */
import { closeSync, createReadStream, writeSync } from "node:fs";
import { once } from "node:events";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import { namespaceControlPipe, pinNamespaceInit, type NamespaceInitIdentity, type NamespaceInitPin } from "@oma/native/pid-namespace";
import { startProcess } from "@oma/process/async";
import type { CommandSpec } from "@oma/process/command";
import { ExecutionNotStarted, type BlockedExecution } from "@oma/process/owned-execution";
import { StoreError } from "@oma/domain/errors";
import { parseBubblewrapArguments } from "./bubblewrap-arguments.js";

export type { NamespaceInitIdentity };
export interface NamespaceLaunchOptions {
  readonly signal?: AbortSignal; readonly inheritedFds?: readonly number[];
  readonly stdoutSink?: (bytes: Uint8Array) => void; readonly stderrSink?: (bytes: Uint8Array) => void;
  readonly stderrFd?: number;
}
export async function launchBlockedNamespace(command: CommandSpec, controls: NamespaceLaunchOptions = {}): Promise<BlockedExecution<NamespaceInitIdentity>> {
  if (controls.signal?.aborted) throw new ExecutionNotStarted(new StoreError("CANCELLED_BEFORE_COMMIT", "namespace launch was cancelled"));
  if (process.platform !== "linux" || command.executable !== "/usr/bin/bwrap") throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "namespace execution requires the fixed Linux bubblewrap backend"));
  let options: readonly string[];
  try { options = parseBubblewrapArguments(command.argv).options.map(option => option.flag); }
  catch (error) { throw new ExecutionNotStarted(error); }
  if (!(options.includes("--unshare-pid") || options.includes("--unshare-all")) || !options.includes("--die-with-parent") ||
      options.includes("--share-pid") || options.includes("--as-pid-1") ||
      options.some(value => ["--info-fd", "--block-fd", "--sync-fd", "--args"].includes(value)))
    throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "namespace launch requires its own init and owned control descriptors"));
  let info: ReturnType<typeof namespaceControlPipe>;
  try { info = namespaceControlPipe(); } catch (error) { throw new ExecutionNotStarted(error); }
  const gate = (() => {
    try { return namespaceControlPipe(); }
    catch (error) {
      try { return withCleanup(() => { throw error; }, () => cleanupAll([() => closeSync(info.read), () => closeSync(info.write)])); }
      catch (failure) { throw new ExecutionNotStarted(failure); }
    }
  })();
  let writer: number | undefined = gate.write, pin: NamespaceInitPin | undefined;
  let informationReader: number | undefined = info.read, informationWriter: number | undefined = info.write;
  let blocker: number | undefined = gate.read;
  const closeControls = (): void => {
    const write = informationWriter, read = blocker;
    informationWriter = undefined; blocker = undefined;
    cleanupAll([() => { if (write !== undefined) closeSync(write); }, () => { if (read !== undefined) closeSync(read); }]);
  };
  let task: ReturnType<typeof startProcess> | undefined;
  let reader: ReturnType<typeof createReadStream> | undefined;
  const abort = (): void => task?.cancel();
  try {
    task = startProcess({ ...command, argv: ["--info-fd", "3", "--block-fd", "4", "--sync-fd", "5", ...command.argv] },
      { inheritedFds: [info.write, gate.read, gate.write, ...(controls.inheritedFds ?? [])],
        ...(controls.stdoutSink === undefined ? {} : { stdoutSink: controls.stdoutSink }),
        ...(controls.stderrFd === undefined ? {} : { stderrFd: controls.stderrFd }),
        ...(controls.stderrSink === undefined ? {} : { stderrSink: controls.stderrSink }) });
    controls.signal?.addEventListener("abort", abort, { once: true });
    if (controls.signal?.aborted) task.cancel();
    // Ownership of the read end moves to ReadStream, including every error.
    reader = createReadStream("", { fd: info.read, autoClose: true });
    informationReader = undefined;
    closeControls();
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of reader) {
      const value = Buffer.from(chunk); bytes += value.length;
      if (bytes > 4096) throw new Error("namespace launch identity exceeds its bound");
      chunks.push(value);
    }
    if (!reader.closed) await once(reader, "close");
    const infoValue: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (infoValue === null || typeof infoValue !== "object" || Array.isArray(infoValue)) throw new Error("invalid namespace launch identity");
    const pid = (infoValue as Record<string, unknown>)["child-pid"];
    if (typeof pid !== "number") throw new Error("namespace init was not observed");
    pin = pinNamespaceInit(pid);
    const scope = pin, ownedTask = task;
    let released = false, closed = false;
    controls.signal?.removeEventListener("abort", abort);
    return Object.freeze({ witness: scope.identity, result: ownedTask.result, closed: ownedTask.closed,
      population: () => scope.population(),
      release() {
        if (released || closed || writer === undefined) throw new Error("namespace execution gate is no longer owned");
        if (scope.population() !== "populated") throw new StoreError("RUN_TERMINATION_UNKNOWN", "namespace init is not live before release");
        if (writeSync(writer, Buffer.from([1])) !== 1) throw new Error("namespace execution gate made no progress");
        released = true;
        const fd = writer; writer = undefined; closeSync(fd);
      },
      terminate: () => scope.terminate(),
      close() {
        if (closed) return;
        closed = true;
        const fd = writer; writer = undefined;
        cleanupAll([() => { if (fd !== undefined) closeSync(fd); }, () => scope.close()]);
      },
    });
  } catch (error) {
    controls.signal?.removeEventListener("abort", abort);
    task?.cancel();
    try { pin?.terminate(); } catch (cleanup) { error = new AggregateError([error, cleanup], "namespace launch and termination failed"); }
    reader?.destroy();
    if (reader !== undefined && !reader.closed) { try { await once(reader, "close"); } catch (cleanup) { error = new AggregateError([error, cleanup]); } }
    if (task !== undefined) await task.closed;
    const observation = task === undefined ? undefined : await task.result;
    const notStarted = task === undefined || observation?.kind === "spawn-failed";
    // Keep setup stderr available when init disappears before it can be pinned.
    // These diagnostics never promote child close to whole-scope death.
    if (observation !== undefined && error instanceof Error) {
      try { Object.defineProperty(error, "namespaceLaunch", { enumerable: true, value: Object.freeze({
        kind: observation.kind, exitCode: observation.exitCode, signal: observation.signal,
        stderr: observation.stderr.toString("utf8"), stderrTruncated: observation.stderrTruncated,
        stderrForwarded: observation.stderrForwarded === true,
      }) }); }
      catch (diagnosticFailure) { error = new AggregateError([error, diagnosticFailure], "namespace launch diagnostics could not be retained"); }
    }
    try { return withCleanup(() => { throw error; }, () => cleanupAll([
      closeControls,
      () => { if (informationReader !== undefined) { const fd = informationReader; informationReader = undefined; closeSync(fd); } },
      () => { if (writer !== undefined) { const fd = writer; writer = undefined; closeSync(fd); } },
      () => pin?.close(),
    ])); } catch (failure) { if (notStarted) throw new ExecutionNotStarted(failure); throw failure; }
  }
}
