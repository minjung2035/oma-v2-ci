/** Darwin resource-coalition observations and fresh kernel-token control.
 * PID enumeration supplies hints only. Population comes from the coalition
 * lookup, never a process count. XNU f6217f89 observation ABI; no control syscall.
 */
import { decode, errno, load } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "./cleanup.js";
import { watchDarwinProcess } from "./process-event.js";

/** Legacy persisted shape. It lacks boot identity and cannot authorize recovery. */
export type DarwinSessionWitness = {
  readonly kind: "darwin-audit-session";
  readonly auditSession: number;
  readonly coalitionId: string;
  readonly pid: number;
  readonly pidVersion: number;
};
/** A physical identity only; admission and role remain with the shared owner. */
export interface DarwinCoalitionIdentity {
  readonly kind: "darwin-resource-coalition";
  readonly bootId: string;
  readonly coalitionId: string;
}
interface ProcCalls {
  readonly task: number;
  list(buffer: Buffer | null, bytes: number): number;
  info(pid: number, flavor: number, arg: bigint, buffer: Buffer, bytes: number): number;
  usage(id: bigint, buffer: Buffer, bytes: number): number;
  sysctl(name: string, output: Buffer, bytes: Buffer, input: null, inputBytes: number): number;
  hostUuid(output: Buffer, timeout: Buffer): number;
  taskName(task: number, pid: number, output: Buffer): number;
  taskInfo(task: number, flavor: number, output: Buffer, count: Buffer): number;
  registered(task: number, output: Buffer, count: Buffer): number;
  kobject(task: number, port: number, type: Buffer, address: Buffer): number;
  freePorts(task: number, address: bigint, bytes: bigint): number;
  deallocate(task: number, port: number): number;
  signal(token: Buffer, signal: number): number;
}
let calls: ProcCalls | undefined;
function native(): ProcCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin coalition control requires the 64-bit libproc backend");
  calls ??= (() => {
    const library = load(null), proc = load("/usr/lib/libproc.dylib");
    return { task: decode.uint(library.symbol("mach_task_self_")),
      list: proc.func("int proc_listallpids(void *buffer, int bytes)"),
      info: proc.func("int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int bytes)"),
      usage: library.func("int coalition_info_resource_usage(uint64_t id, void *buffer, size_t bytes)"),
      sysctl: library.func("int sysctlbyname(const char *name, void *output, void *bytes, const void *input, size_t inputBytes)"),
      hostUuid: library.func("int gethostuuid(void *output, const void *timeout)"),
      taskName: library.func("int task_name_for_pid(unsigned int task, int pid, void *output)"),
      taskInfo: library.func("int task_info(unsigned int task, int flavor, void *output, void *count)"),
      registered: library.func("int mach_ports_lookup(unsigned int task, void *output, void *count)"),
      kobject: library.func("int mach_port_kobject(unsigned int task, unsigned int port, void *type, void *address)"),
      freePorts: library.func("int vm_deallocate(unsigned int task, uint64_t address, uint64_t bytes)"),
      deallocate: library.func("int mach_port_deallocate(unsigned int task, unsigned int port)"),
      signal: proc.func("int proc_signal_with_audittoken(void *token, int signal)") };
  })();
  return calls;
}
function unknown(message: string): never { throw new StoreError("RUN_TERMINATION_UNKNOWN", message); }
const BOOT = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function valid(identity: DarwinCoalitionIdentity): void {
  if (identity.kind !== "darwin-resource-coalition" || !BOOT.test(identity.bootId) ||
      !/^[1-9][0-9]{0,19}$/.test(identity.coalitionId) || BigInt(identity.coalitionId) > 0xffffffffffffffffn)
    throw new TypeError("invalid Darwin resource-coalition identity");
}
function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid < 2 || pid > 0x7fffffff) throw new TypeError("invalid Darwin process PID");
}
export function currentDarwinBootId(): string {
  const output = Buffer.alloc(64), size = Buffer.alloc(8); size.writeBigUInt64LE(BigInt(output.length));
  if (native().sysctl("kern.bootsessionuuid", output, size, null, 0) !== 0 || size.readBigUInt64LE() !== 37n || output[36] !== 0)
    unknown("Darwin kernel boot identity is unavailable");
  const value = output.subarray(0, 36).toString("ascii").toLowerCase();
  if (!BOOT.test(value)) unknown("Darwin kernel boot identity is malformed");
  return value;
}
/** Public host identity, distinct from this kernel boot. Intended for explicit
 * reboot recovery, never process/peer authority. Failure has no generated-ID
 * fallback. OMA does not register a gethostuuid replacement callback. */
export function currentDarwinHostId(): string {
  const output = Buffer.alloc(16), timeout = Buffer.alloc(16);
  timeout.writeBigInt64LE(1n); // Darwin 64-bit timespec: one-second maximum wait.
  if (native().hostUuid(output, timeout) !== 0 || output.every(byte => byte === 0))
    unknown("Darwin host identity is unavailable");
  return output.toString("hex");
}
/** Current controller's kernel token, not a claimed/received sender. It is
 * public correlation data; only a genuine receive trailer proves a sender. */
export function currentDarwinAuditToken(): readonly number[] {
  const api = native(), token = Buffer.alloc(32), count = Buffer.alloc(4); count.writeUInt32LE(8);
  if (api.taskInfo(api.task, 15 /* TASK_AUDIT_TOKEN */, token, count) !== 0 || count.readUInt32LE() !== 8 ||
      token.readUInt32LE(20) !== process.pid || token.readUInt32LE(4) !== process.geteuid?.() || token.readUInt32LE(28) === 0)
    unknown("Darwin controller kernel token is unavailable");
  return Object.freeze(Array.from({ length: 8 }, (_, index) => token.readUInt32LE(index * 4)));
}
/** Transient OS source only. Shared protocol code must still demand genuine
 * received sender provenance and current role/run authority. */
export interface DarwinPeerSourcePin {
  readonly pid: number;
  readonly token: readonly number[];
  readonly coalitionId: string;
  alive(): boolean;
  close(): void;
}
/** Fixed inherited slot 1; no PID, pathname, environment claim or arbitrary
 * caller-supplied port can substitute for it. A source in our own coalition
 * is refused. The trusted launch owner must supply this read-only task name;
 * the private job helper supplies it alongside an independently owned endpoint.
 * This ephemeral pin cannot survive reboot and publishes no durable identity. */
export function pinInheritedDarwinPeer(): DarwinPeerSourcePin {
  const api = native(), address = Buffer.alloc(8), count = Buffer.alloc(4);
  function unavailable(reason: string): never {
    throw new StoreError("AUTH_FAILED", "inherited Darwin peer source could not be bound to a distinct live generation", { details: { reason } });
  }
  if (api.registered(api.task, address, count) !== 0) unavailable("registered-ports");
  const length = count.readUInt32LE(), pointer = address.readBigUInt64LE();
  let names: number[] = [], watch: ReturnType<typeof watchDarwinProcess> | undefined;
  let closed = false, revoked = false, closeFailure: unknown;
  const close = (): void => {
    if (closeFailure !== undefined) throw closeFailure;
    if (closed) return;
    closed = true;
    try {
      cleanupAll([() => watch?.close(), ...names.map(name => () => {
        if (name !== 0 && name !== 0xffffffff && api.deallocate(api.task, name) !== 0)
          unknown("Darwin peer-source send reference was not returned");
      }), () => {
        if (length !== 0 && api.freePorts(api.task, pointer, BigInt(length) * 4n) !== 0)
          unknown("Darwin peer-source port array was not returned");
      }]);
    } catch (error) { closeFailure = error; throw error; }
  };
  try {
    // TASK_PORT_REGISTER_MAX is 3 in the public SDK. All references and the
    // kernel-allocated VM array remain owned together until this pin closes.
    if (length > 3 || length !== 0 && pointer === 0n) unavailable("registered-array");
    if (length !== 0) {
      const decoded: unknown = decode(decode(address, "void *"), "uint32_t", length);
      if (!(decoded instanceof Uint32Array) || decoded.length !== length) unavailable("registered-layout");
      names = Array.from(decoded);
    }
    if (length < 2 || names[1] === 0 || names[1] === 0xffffffff) unavailable("source-missing");
    const source = names[1]!, type = Buffer.alloc(4), ignored = Buffer.alloc(8);
    // Query only genuine TASK_NAME=20. A user receive port could forge MIG
    // replies or block forever if task_info were sent before this check.
    if (api.kobject(api.task, source, type, ignored) !== 0 || type.readUInt32LE() !== 20) unavailable("source-type");
    const token = Buffer.alloc(32), words = Buffer.alloc(4); words.writeUInt32LE(8);
    if (api.taskInfo(source, 15, token, words) !== 0 || words.readUInt32LE() !== 8 ||
        token.readUInt32LE(4) !== process.geteuid?.() || token.readUInt32LE(28) === 0) unavailable("source-token");
    const pid = token.readUInt32LE(20); validPid(pid);
    const observedWatch = watchDarwinProcess(pid); watch = observedWatch;
    const before = Buffer.alloc(56);
    if (api.info(pid, 17, 0n, before, before.length) !== before.length || before.readBigUInt64LE(16) === 0n ||
        before.readUInt32LE(32) !== token.readUInt32LE(28)) unavailable("source-generation");
    const coalitionId = coalition(pid), own = coalition(process.pid);
    if (coalitionId === null || own === null || coalitionId === own) unavailable("source-coalition");
    const alive = (): boolean => {
      if (closed || revoked) return false;
      try {
        if (observedWatch.state() !== "live") { revoked = true; return false; }
        const unique = Buffer.alloc(56), after = Buffer.alloc(56), fresh = Buffer.alloc(32); words.writeUInt32LE(8);
        if (api.info(pid, 17, 0n, unique, unique.length) !== unique.length ||
            unique.readBigUInt64LE(16) !== before.readBigUInt64LE(16) || unique.readUInt32LE(32) !== before.readUInt32LE(32) ||
            coalition(pid) !== coalitionId || coalition(process.pid) !== own ||
            api.taskInfo(source, 15, fresh, words) !== 0 || words.readUInt32LE() !== 8 || !fresh.equals(token) ||
            api.info(pid, 17, 0n, after, after.length) !== after.length ||
            after.readBigUInt64LE(16) !== before.readBigUInt64LE(16) || after.readUInt32LE(32) !== before.readUInt32LE(32) ||
            observedWatch.state() !== "live") { revoked = true; return false; }
        return true;
      } catch { revoked = true; return false; }
    };
    if (!alive()) unavailable("source-live");
    return Object.freeze({ pid, coalitionId,
      token: Object.freeze(Array.from({ length: 8 }, (_, index) => token.readUInt32LE(index * 4))), alive, close });
  } catch (error) { return withCleanup(() => { throw error; }, close); }
}
function coalition(pid: number): string | null {
  errno(0);
  const result = Buffer.alloc(40), size = native().info(pid, 20, 0n, result, result.length), saved = errno();
  if (size === 0 && saved === 3 /* ESRCH */) return null;
  if (size !== result.length || result.readBigUInt64LE(0) === 0n) unknown("Darwin resource membership is unavailable");
  return result.readBigUInt64LE(0).toString();
}
export function identifyDarwinCoalition(pid: number): DarwinCoalitionIdentity | null {
  validPid(pid);
  const bootId = currentDarwinBootId(), coalitionId = coalition(pid);
  if (currentDarwinBootId() !== bootId) unknown("Darwin boot changed while observing resource identity");
  return coalitionId === null ? null : Object.freeze({ kind: "darwin-resource-coalition", bootId, coalitionId });
}
export function observeDarwinCoalitionPopulation(identity: DarwinCoalitionIdentity): "populated" | "empty" | "unknown" {
  valid(identity);
  try {
    // A positively observed different boot cannot retain this boot's tasks.
    if (currentDarwinBootId() !== identity.bootId) return "empty";
    errno(0);
    const counts = Buffer.alloc(16), result = native().usage(BigInt(identity.coalitionId), counts, counts.length), saved = errno();
    // A successful lookup remains populated even when task counters are equal.
    // Only ID removal (ESRCH), not a transient empty scan, closes this identity.
    return result === 0 ? "populated" : result === -1 && saved === 3 ? "empty" : "unknown";
  } catch { return "unknown"; }
}
/** Hints may be incomplete; no result of this function proves scope death. */
export function darwinCoalitionMemberHints(identity: DarwinCoalitionIdentity): readonly number[] {
  valid(identity);
  if (currentDarwinBootId() !== identity.bootId) return [];
  const api = native(), estimate = api.list(null, 0);
  if (estimate < 0) unknown("Darwin process enumeration is unavailable");
  const capacity = Math.min(65536, estimate + 64), buffer = Buffer.alloc(capacity * 4);
  const count = api.list(buffer, buffer.length);
  if (count < 0) unknown("Darwin process hints could not be read");
  const found: number[] = [];
  for (let index = 0; index < Math.min(count, capacity); ++index) {
    const pid = buffer.readInt32LE(index * 4);
    if (pid < 2) continue;
    // An unreadable unrelated process cannot turn the scope into empty.
    try { if (coalition(pid) === identity.coalitionId) found.push(pid); } catch { /* hint only */ }
  }
  return Object.freeze(found);
}
/** A hint PID never supplies signal authority. Acquire a genuine kernel token,
 * correlate its generation and CID, then use the SDK's version-checked effect.
 * false means no effect; it is neither scope death nor a successful stop. */
export function signalDarwinCoalitionMember(identity: DarwinCoalitionIdentity, pid: number): boolean {
  valid(identity); validPid(pid);
  if (currentDarwinBootId() !== identity.bootId) return false;
  if (coalition(process.pid) === identity.coalitionId) unknown("Darwin controller cannot terminate its own resource coalition");
  const api = native(), before = Buffer.alloc(56);
  if (api.info(pid, 17, 0n, before, before.length) !== before.length) return false;
  if (coalition(pid) !== identity.coalitionId) return false;
  // A scanned member may exit between observation and capability acquisition.
  // Only the same generation still observed live keeps the refusal unknown.
  const vanished = (): boolean => {
    const now = Buffer.alloc(56);
    return api.info(pid, 17, 0n, now, now.length) !== now.length ||
      now.readBigUInt64LE(16) !== before.readBigUInt64LE(16) || now.readUInt32LE(32) !== before.readUInt32LE(32);
  };
  const port = Buffer.alloc(4);
  if (api.taskName(api.task, pid, port) !== 0 || !port.readUInt32LE() || port.readUInt32LE() === 0xffffffff) {
    if (vanished()) return false;
    unknown("Darwin member task-name capability is unavailable");
  }
  const token = Buffer.alloc(32), count = Buffer.alloc(4); count.writeUInt32LE(8);
  return withCleanup(() => {
    if (api.taskInfo(port.readUInt32LE(), 15 /* TASK_AUDIT_TOKEN */, token, count) !== 0 || count.readUInt32LE() !== 8) {
      if (vanished()) return false;
      unknown("Darwin member kernel audit token is unavailable");
    }
    const after = Buffer.alloc(56);
    if (api.info(pid, 17, 0n, after, after.length) !== after.length ||
        before.readBigUInt64LE(16) === 0n || before.readBigUInt64LE(16) !== after.readBigUInt64LE(16) ||
        before.readUInt32LE(32) === 0 || before.readUInt32LE(32) !== after.readUInt32LE(32) ||
        token.readUInt32LE(20) !== pid || token.readUInt32LE(4) !== process.geteuid?.() ||
        token.readUInt32LE(28) !== before.readUInt32LE(32) || currentDarwinBootId() !== identity.bootId) return false;
    // libproc returns the errno value itself, not -1 plus ambient errno.
    const status = api.signal(token, 9);
    if (status === 0) return true;
    if (status === 3 /* ESRCH: exact generation already gone */) return false;
    unknown("Darwin exact-token member termination was refused");
  }, () => {
    if (api.deallocate(api.task, port.readUInt32LE()) !== 0) unknown("Darwin member task-name capability was not returned");
  });
}

export type DarwinProcessState = "live" | "stopped" | "changed" | "exited" | "unknown";
/** A freshly acquired kernel generation, not a received sender or role grant.
 * Its controls use only its private kernel token. Neither PID nor the public
 * token copy can reacquire it, and a pin never proves complete scope death. */
export interface DarwinProcessPin {
  readonly pid: number;
  readonly token: readonly number[];
  readonly identity: DarwinCoalitionIdentity;
  state(): DarwinProcessState;
  resume(): boolean;
  terminate(): boolean;
  close(): void;
}
/** A launcher's PID hint may exist before exec has reached START_SUSPENDED.
 * Readiness never proves a generation, selected image, role or scope death. */
export function darwinProcessStopHint(pid: number): "stopped" | "running" | "exited" | "unavailable" {
  validPid(pid);
  const api = native(), bytes = Buffer.alloc(136);
  errno(0);
  const count = api.info(pid, 3 /* PROC_PIDTBSDINFO */, 0n, bytes, bytes.length), saved = errno();
  if (count === 0 && saved === 3) return "exited";
  if (count !== bytes.length || bytes.readUInt32LE(12) !== pid) return "unavailable";
  const state = bytes.readUInt32LE(4);
  return state === 4 ? "stopped" : state >= 1 && state <= 3 ? "running" : state === 5 ? "exited" : "unavailable";
}
export function pinDarwinProcess(pid: number): DarwinProcessPin {
  return acquireDarwinProcess(pid, true);
}
interface DarwinAcquisition {
  readonly uniqueId: bigint;
  readonly pidVersion: number;
  readonly token: Buffer;
  readonly identity: DarwinCoalitionIdentity;
}
const darwinAcquisitions = new WeakMap<DarwinProcessPin, DarwinAcquisition>();
/** Replaces an EXEC-revoked watch with a new watch for exactly the original
 * kernel generation. Caller-shaped pins, unknown/dead/closed pins and any
 * changed kernel fact are refused. This grants no actor or image authority. */
export function reacquireChangedDarwinProcess(pin: DarwinProcessPin): DarwinProcessPin {
  const expected = darwinAcquisitions.get(pin);
  if (expected === undefined || pin.state() !== "changed") unknown("Darwin process has no replaceable changed-watch acquisition");
  return acquireDarwinProcess(pin.pid, false, expected);
}
/** Independently owns exactly a genuine pin's current kernel generation.
 * A retained observation grants no selected-image, role or death authority. */
export function retainDarwinProcessPin(pin: DarwinProcessPin): DarwinProcessPin {
  const expected = darwinAcquisitions.get(pin);
  if (expected === undefined) unknown("Darwin process has no genuine acquisition to retain");
  const state = pin.state();
  if (state !== "live" && state !== "stopped") unknown("Darwin process generation is no longer retainable");
  return acquireDarwinProcess(pin.pid, true, expected);
}
function acquireDarwinProcess(pid: number, retry: boolean, expected?: DarwinAcquisition): DarwinProcessPin {
  validPid(pid);
  const api = native(), bootId = currentDarwinBootId(), before = Buffer.alloc(56);
  if (api.info(pid, 17, 0n, before, before.length) !== before.length ||
      before.readBigUInt64LE(16) === 0n || before.readUInt32LE(32) === 0)
    unknown("Darwin process generation is unavailable");
  if (expected !== undefined && (before.readBigUInt64LE(16) !== expected.uniqueId || before.readUInt32LE(32) !== expected.pidVersion))
    unknown("Darwin process generation changed before acquisition could restart");
  // Register before acquiring the task token. An exec between the first
  // generation read and registration is rejected by the second read below.
  const watch = watchDarwinProcess(pid), port = Buffer.alloc(4);
  let ownsPort = false, closed = false, closeFailure: unknown;
  const close = (): void => {
    if (closeFailure !== undefined) throw closeFailure;
    if (closed) return;
    closed = true;
    try {
      cleanupAll([() => watch.close(), () => {
        if (ownsPort && api.deallocate(api.task, port.readUInt32LE()) !== 0)
          unknown("Darwin process task-name capability was not returned");
      }]);
    } catch (error) { closeFailure = error; throw error; }
  };
  try {
    const acquired = api.taskName(api.task, pid, port);
    if (acquired !== 0 || !port.readUInt32LE() || port.readUInt32LE() === 0xffffffff)
      unknown(`Darwin process task-name capability is unavailable: kernel=${acquired}`);
    ownsPort = true;
    const token = Buffer.alloc(32), count = Buffer.alloc(4); count.writeUInt32LE(8);
    if (api.taskInfo(port.readUInt32LE(), 15, token, count) !== 0 || count.readUInt32LE() !== 8 ||
        token.readUInt32LE(20) !== pid || token.readUInt32LE(4) !== process.geteuid?.() ||
        token.readUInt32LE(28) !== before.readUInt32LE(32))
      unknown("Darwin process kernel token could not be bound");
    const coalitionId = coalition(pid);
    if (coalitionId === null || coalition(process.pid) === coalitionId)
      unknown("Darwin process must belong to a distinct resource coalition");
    const identity: DarwinCoalitionIdentity = Object.freeze({ kind: "darwin-resource-coalition", bootId, coalitionId });
    if (expected !== undefined && (!token.equals(expected.token) || bootId !== expected.identity.bootId || coalitionId !== expected.identity.coalitionId))
      unknown("Darwin process kernel identity changed before acquisition could restart");
    let status: DarwinProcessState = "live";
    const state = (): DarwinProcessState => {
      if (closed) return "unknown";
      if (status !== "live" && status !== "stopped") return status;
      try {
        const event = watch.state();
        if (event !== "live") return status = event;
        if (currentDarwinBootId() !== bootId) return status = "changed";
        const unique = Buffer.alloc(56), bsd = Buffer.alloc(136), fresh = Buffer.alloc(32);
        errno(0);
        const bytes = api.info(pid, 17, 0n, unique, unique.length), saved = errno();
        if (bytes === 0 && saved === 3) return status = "exited";
        if (bytes !== unique.length) return status = "unknown";
        if (unique.readBigUInt64LE(16) !== before.readBigUInt64LE(16) ||
            unique.readUInt32LE(32) !== before.readUInt32LE(32)) return status = "changed";
        if (coalition(pid) !== coalitionId) return status = "changed";
        if (api.info(pid, 3 /* PROC_PIDTBSDINFO */, 0n, bsd, bsd.length) !== bsd.length ||
            bsd.readUInt32LE(12) !== pid) return status = "unknown";
        if (bsd.readUInt32LE(4) === 5 /* SZOMB */) return status = "exited";
        count.writeUInt32LE(8);
        if (api.taskInfo(port.readUInt32LE(), 15, fresh, count) !== 0 || count.readUInt32LE() !== 8)
          return status = "unknown";
        if (!fresh.equals(token)) return status = "changed";
        const after = Buffer.alloc(56);
        if (api.info(pid, 17, 0n, after, after.length) !== after.length) return status = "unknown";
        if (after.readBigUInt64LE(16) !== before.readBigUInt64LE(16) ||
            after.readUInt32LE(32) !== before.readUInt32LE(32)) return status = "changed";
        const finalEvent = watch.state();
        if (finalEvent !== "live") return status = finalEvent;
        const processState = bsd.readUInt32LE(4);
        return status = processState === 4 /* SSTOP */ ? "stopped" :
          processState >= 1 && processState <= 3 ? "live" : "unknown";
      } catch { return status = "unknown"; }
    };
    const initialState = state();
    if (initialState === "changed" && retry) {
      // An initial EXEC event may arrive after the generation read. Never
      // revive this watcher or accept another generation: acquire one fresh
      // watch only if every original kernel fact still agrees. Any real exec,
      // PID reuse, CID change or second event remains a refusal.
      let replacement: DarwinProcessPin | undefined;
      try {
        replacement = acquireDarwinProcess(pid, false, { uniqueId: before.readBigUInt64LE(16),
          pidVersion: before.readUInt32LE(32), token, identity });
        close(); return replacement;
      } catch (error) { return withCleanup(() => { throw error; }, () => replacement?.close()); }
    }
    if (initialState !== "live" && initialState !== "stopped")
      unknown(`Darwin process pin acquisition is ${initialState}`);
    const signal = (number: 9 | 19): boolean => {
      const observed = state();
      if (observed === "changed" || observed === "exited") return false;
      if (observed === "unknown") unknown("Darwin pinned process is unobserved");
      if (number === 19 && observed !== "stopped") return false;
      const result = api.signal(token, number);
      if (result === 0) return true;
      if (result === 3) { status = "changed"; return false; }
      unknown("Darwin pinned process control was refused");
    };
    const pin = Object.freeze({ pid, identity,
      token: Object.freeze(Array.from({ length: 8 }, (_, index) => token.readUInt32LE(index * 4))),
      state, resume: () => signal(19), terminate: () => signal(9), close });
    darwinAcquisitions.set(pin, { uniqueId: before.readBigUInt64LE(16), pidVersion: before.readUInt32LE(32), token, identity });
    return pin;
  } catch (error) { return withCleanup(() => { throw error; }, close); }
}
