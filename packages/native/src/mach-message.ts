/** Darwin Mach message mechanics and kernel audit facts only. Framing, live
 * process pinning, scope membership and authority belong to shared TS owners.
 * Source-reviewed against XNU f6217f89 and Chromium 655c7be0; Darwin NOT_RUN.
 */
import { decode, load } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "./cleanup.js";
import { decodeDarwinAuditToken } from "./audit-token.js";

const HEADER_BYTES = 24, AUDIT_TRAILER_BYTES = 52, INLINE_BYTES = 65536;
const SEND_TIMEOUT = 0x10000004, RECEIVE_TIMEOUT = 0x10004003;
const RECEIVE_TOO_LARGE = 0x10004004;
interface MachCalls {
  readonly task: number; readonly bootstrap: number;
  allocate(task: number, right: number, result: Buffer): number;
  insert(task: number, name: number, right: number, disposition: number): number;
  refs(task: number, name: number, right: number, delta: number): number;
  deallocate(task: number, name: number): number;
  checkIn(bootstrap: number, name: string, result: Buffer): number;
  lookup(bootstrap: number, name: string, result: Buffer): number;
  message(bytes: Buffer, options: number, sendBytes: number, receiveBytes: number,
    receivePort: number, timeoutMs: number, notify: number): number;
  destroy(bytes: Buffer): void;
}
let calls: MachCalls | undefined;
function mach(): MachCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "Mach messages require the Darwin 64-bit backend");
  if (calls !== undefined) return calls;
  const library = load(null);
  calls = {
    task: decode.uint(library.symbol("mach_task_self_")),
    bootstrap: decode.uint(library.symbol("bootstrap_port")),
    allocate: library.func("int mach_port_allocate(unsigned int task, unsigned int right, void *result)"),
    insert: library.func("int mach_port_insert_right(unsigned int task, unsigned int name, unsigned int right, unsigned int disposition)"),
    refs: library.func("int mach_port_mod_refs(unsigned int task, unsigned int name, unsigned int right, int delta)"),
    deallocate: library.func("int mach_port_deallocate(unsigned int task, unsigned int name)"),
    checkIn: library.func("int bootstrap_check_in(unsigned int bootstrap, const char *name, void *result)"),
    lookup: library.func("int bootstrap_look_up(unsigned int bootstrap, const char *name, void *result)"),
    message: library.func("int mach_msg(void *message, unsigned int options, unsigned int sendBytes, unsigned int receiveBytes, unsigned int receivePort, unsigned int timeoutMs, unsigned int notify)"),
    destroy: library.func("void mach_msg_destroy(void *message)"),
  };
  return calls;
}
function success(result: number, operation: string): void {
  if (result !== 0) throw Object.assign(new Error(`${operation} was not observed successful (Mach ${result})`), { machCode: result });
}
function port(name: number): number {
  if (!Number.isSafeInteger(name) || name <= 0 || name >= 0xffffffff) throw new Error("Mach returned an invalid port name");
  return name;
}
function service(name: string): void {
  // Generated endpoint names, never an authority credential or a path.
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(name) || Buffer.byteLength(name) >= 128)
    throw new TypeError("invalid Mach service name");
}
export interface MachAuditSender {
  readonly pid: number; readonly uid: number; readonly gid: number;
  readonly auditSession: number; readonly pidVersion: number;
  readonly token: readonly number[];
}
const observedSenders = new WeakSet<object>();
/** A wire body or a saved token array cannot manufacture receive evidence. */
export function isMachAuditSender(value: unknown): value is MachAuditSender {
  return value !== null && typeof value === "object" && observedSenders.has(value);
}
export type MachMessage = { readonly kind: "again" } | {
  readonly kind: "data"; readonly id: number; readonly bytes: Buffer; readonly sender: MachAuditSender;
};
export interface MachSendRight {
  /** Raw inline Mach body: the transport must supply four-byte alignment. */
  send(id: number, bytes: Uint8Array): "sent" | "again";
  close(): void;
}
export interface MachReceiveRight {
  receive(): MachMessage;
  close(): void;
}
function ownSend(name: number): MachSendRight {
  const native = mach(); port(name); let closed = false;
  return Object.freeze({
    send(id: number, bytes: Uint8Array): "sent" | "again" {
      if (closed) throw new Error("Mach send owner is closed");
      if (!Number.isInteger(id) || id < -0x80000000 || id > 0x7fffffff ||
          !(bytes instanceof Uint8Array) || bytes.length > INLINE_BYTES || bytes.length % 4 !== 0)
        throw new TypeError("inline Mach body must be bounded and four-byte aligned");
      const message = Buffer.alloc(HEADER_BYTES + bytes.length);
      message.writeUInt32LE(19 /* COPY_SEND */, 0);
      message.writeUInt32LE(message.length, 4); message.writeUInt32LE(name, 8); message.writeInt32LE(id, 20);
      message.set(bytes, HEADER_BYTES);
      // No local/voucher/body rights are sent, so timeout transfers no owned
      // resource. "sent" means enqueued only, never application acceptance.
      const result = native.message(message, 1 /* SEND_MSG */ | 0x10 /* SEND_TIMEOUT */,
        message.length, 0, 0, 0, 0);
      if (result === SEND_TIMEOUT) return "again";
      success(result, "Mach send"); return "sent";
    },
    close() { if (closed) return; closed = true; success(native.deallocate(native.task, name), "release Mach send right"); },
  });
}
function ownReceive(name: number): MachReceiveRight {
  const native = mach(); port(name); let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    success(native.refs(native.task, name, 1 /* RECEIVE */, -1), "release Mach receive right");
  };
  return Object.freeze({
    receive(): MachMessage {
      if (closed) throw new Error("Mach receive owner is closed");
      const message = Buffer.alloc(HEADER_BYTES + INLINE_BYTES + AUDIT_TRAILER_BYTES + 4);
      message.writeUInt32LE(message.length, 4); message.writeUInt32LE(name, 12);
      const result = native.message(message,
        2 /* RCV_MSG */ | 0x100 /* RCV_TIMEOUT */ | 4 /* RCV_LARGE */ | (3 << 24) /* AUDIT trailer */,
        0, message.length, name, 0, 0);
      if (result === RECEIVE_TIMEOUT) return { kind: "again" };
      if (result === RECEIVE_TOO_LARGE)
        return withCleanup(() => { throw new Error("Mach message exceeds the inline receive window; endpoint closed"); }, close);
      success(result, "Mach receive");
      // Even rejected messages may carry rights/OOL memory. The SDK's
      // destructor returns those; it does not destroy msgh_local_port.
      return withCleanup(() => {
        const bits = message.readUInt32LE(0), size = message.readUInt32LE(4);
        if ((bits & 0x80000000) !== 0 || message.readUInt32LE(8) !== 0 || message.readUInt32LE(16) !== 0 ||
            message.readUInt32LE(12) !== name || size < HEADER_BYTES || size > HEADER_BYTES + INLINE_BYTES || size % 4 !== 0)
          throw new Error("Mach message has unsupported rights or inline shape");
        const trailer = (size + 3) & ~3;
        if (trailer + AUDIT_TRAILER_BYTES > message.length || message.readUInt32LE(trailer) !== 0 ||
            message.readUInt32LE(trailer + 4) !== AUDIT_TRAILER_BYTES)
          throw new Error("Mach message has no complete kernel audit trailer");
        const token = Object.freeze(Array.from({ length: 8 }, (_, at) => message.readUInt32LE(trailer + 20 + at * 4)));
        const decoded = decodeDarwinAuditToken(token);
        if (decoded.pid < 2 || decoded.pid > 0x7fffffff) throw new Error("Mach sender is not an observed user process");
        const sender = Object.freeze({ ...decoded, token });
        observedSenders.add(sender);
        return { kind: "data", id: message.readInt32LE(20), bytes: Buffer.from(message.subarray(HEADER_BYTES, size)), sender };
      }, () => native.destroy(message));
    },
    close,
  });
}
/** Independent owners for one local endpoint's receive and send references. */
export function createMachEndpoint(): { readonly receive: MachReceiveRight; readonly send: MachSendRight } {
  const native = mach(), output = Buffer.alloc(4);
  success(native.allocate(native.task, 1 /* RECEIVE */, output), "allocate Mach receive right");
  const name = port(output.readUInt32LE(0)), receive = ownReceive(name);
  try {
    success(native.insert(native.task, name, name, 20 /* MAKE_SEND */), "create Mach send right");
    return Object.freeze({ receive, send: ownSend(name) });
  } catch (error) { return withCleanup(() => { throw error; }, () => receive.close()); }
}
/** Check in a launchd-declared service. Anonymous dynamic-name check-in is
 * used by Chromium, but its acceptance is not the public header's contract;
 * OMA must qualify that separately before using it for an ordinary CLI.
 * A rendezvous name and its send right confer no actor authority.
 */
export function listenMachService(name: string): MachReceiveRight {
  service(name); const native = mach(), output = Buffer.alloc(4);
  success(native.checkIn(native.bootstrap, name, output), "check in Mach service");
  return ownReceive(port(output.readUInt32LE(0)));
}
export function lookupMachService(name: string): MachSendRight {
  service(name); const native = mach(), output = Buffer.alloc(4);
  success(native.lookup(native.bootstrap, name, output), "look up Mach service");
  return ownSend(port(output.readUInt32LE(0)));
}
