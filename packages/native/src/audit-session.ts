/** Darwin resource-coalition observations and fresh kernel-token control.
 * PID enumeration supplies hints only. Population comes from the coalition
 * lookup, never a process count. XNU f6217f89 observation ABI; no control syscall.
 */
import { decode, errno, load } from "koffi";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "./cleanup.js";

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
  taskName(task: number, pid: number, output: Buffer): number;
  taskInfo(task: number, flavor: number, output: Buffer, count: Buffer): number;
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
      taskName: library.func("int task_name_for_pid(unsigned int task, int pid, void *output)"),
      taskInfo: library.func("int task_info(unsigned int task, int flavor, void *output, void *count)"),
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
  const port = Buffer.alloc(4);
  if (api.taskName(api.task, pid, port) !== 0 || !port.readUInt32LE() || port.readUInt32LE() === 0xffffffff)
    unknown("Darwin member task-name capability is unavailable");
  const token = Buffer.alloc(32), count = Buffer.alloc(4); count.writeUInt32LE(8);
  return withCleanup(() => {
    if (api.taskInfo(port.readUInt32LE(), 15 /* TASK_AUDIT_TOKEN */, token, count) !== 0 || count.readUInt32LE() !== 8)
      unknown("Darwin member kernel audit token is unavailable");
    const after = Buffer.alloc(56);
    if (api.info(pid, 17, 0n, after, after.length) !== after.length ||
        before.readBigUInt64LE(16) === 0n || before.readBigUInt64LE(16) !== after.readBigUInt64LE(16) ||
        before.readUInt32LE(32) === 0 || before.readUInt32LE(32) !== after.readUInt32LE(32) ||
        token.readUInt32LE(20) !== pid || token.readUInt32LE(4) !== process.geteuid?.() ||
        token.readUInt32LE(28) !== before.readUInt32LE(32) || currentDarwinBootId() !== identity.bootId) return false;
    errno(0);
    if (api.signal(token, 9) === 0) return true;
    if (errno() === 3 /* ESRCH: exact generation already gone */) return false;
    unknown("Darwin exact-token member termination was refused");
  }, () => {
    if (api.deallocate(api.task, port.readUInt32LE()) !== 0) unknown("Darwin member task-name capability was not returned");
  });
}
