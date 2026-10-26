/** Darwin kernel events for one process, never an arbitrary-descendant scope.
 * A watcher starts at registration. Binding it to an earlier audit token needs
 * fresh sender evidence after registration; a PID/start-time lookup is not that
 * evidence. XNU event.h f6217f89 supplies the fixed kevent64 ABI. NOT_RUN on Mac.
 */
import { closeSync } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { closeOnExec } from "./control-socket.js";
import { withCleanup } from "./cleanup.js";

export type ProcessEventState = "live" | "exited" | "changed" | "unknown";
export interface ProcessEventWatch { state(): ProcessEventState; close(): void }
interface EventCalls {
  queue(): number;
  event(fd: number, changes: Buffer | null, count: number, events: Buffer, maximum: number,
    flags: number, timeout: Buffer): number;
}
let calls: EventCalls | undefined;
function native(): EventCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "process events require the Darwin 64-bit backend");
  if (calls !== undefined) return calls;
  const library = load(null);
  calls = { queue: library.func("int kqueue()"),
    event: library.func("int kevent64(int queue, const void *changes, int count, void *events, int maximum, unsigned int flags, const void *timeout)") };
  return calls;
}
function failed(operation: string): never {
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`${operation}: ${code}`), { code });
}
/** The returned queue observes only this registration; it sends no signals.
 * NOTE_TRACK/NOTE_CHILD are deliberately absent: Darwin refuses that tracking.
 */
export function watchDarwinProcess(pid: number): ProcessEventWatch {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 0x7fffffff) throw new TypeError("invalid process event PID");
  const system = native(), fd = system.queue();
  if (fd < 0) failed("kqueue");
  const marker = 0x4f4d4101n, pidValue = BigInt(pid), timeout = Buffer.alloc(16);
  const valid = (event: Buffer): boolean => event.readBigUInt64LE(0) === pidValue &&
    event.readInt16LE(8) === -5 /* EVFILT_PROC */ && event.readBigUInt64LE(24) === marker;
  try {
    closeOnExec(fd);
    const change = Buffer.alloc(48), receipt = Buffer.alloc(48);
    change.writeBigUInt64LE(pidValue, 0); change.writeInt16LE(-5, 8);
    change.writeUInt16LE(1 /* ADD */ | 4 /* ENABLE */ | 0x20 /* CLEAR */ | 0x40 /* RECEIPT */, 10);
    change.writeUInt32LE(0xa0000000 /* EXIT | EXEC, unsigned */, 12);
    change.writeBigUInt64LE(marker, 24);
    const count = system.event(fd, change, 1, receipt, 1, 0, timeout);
    if (count < 0) failed("register process event");
    if (count !== 1 || !valid(receipt) || (receipt.readUInt16LE(10) & 0x4000 /* ERROR/receipt */) === 0 ||
        receipt.readBigInt64LE(16) !== 0n)
      throw new Error("process event registration was not confirmed");
  } catch (error) { return withCleanup(() => { throw error; }, () => closeSync(fd)); }
  let closed = false, closeFailure: unknown, status: ProcessEventState = "live";
  return Object.freeze({
    state(): ProcessEventState {
      if (closed) return "unknown";
      if (status !== "live") return status;
      const event = Buffer.alloc(48);
      const count = system.event(fd, null, 0, event, 1, 0, timeout);
      if (count === 0) return "live";
      // Observation failure is sticky uncertainty, never process death. A new
      // binding must acquire a new watcher and fresh sender evidence.
      if (count !== 1 || !valid(event) || (event.readUInt16LE(10) & 0x4000) !== 0) return status = "unknown";
      const flags = event.readUInt32LE(12);
      if ((flags & 0x80000000) !== 0) return status = "exited";
      if ((flags & 0x20000000) !== 0) return status = "changed";
      return status = "unknown";
    },
    close() {
      if (closeFailure !== undefined) throw closeFailure;
      if (closed) return;
      closed = true;
      try { closeSync(fd); } catch (error) { closeFailure = error; throw error; }
    },
  });
}
