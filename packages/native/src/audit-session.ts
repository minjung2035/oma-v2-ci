/** Read-only process/coalition observations and exact-token termination.
 * Launchd provisioning and authority/recovery policy stay with shared owners. */
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";

export type DarwinSessionWitness = {
  readonly kind: "darwin-audit-session";
  readonly auditSession: number;
  readonly coalitionId: string;
  readonly pid: number;
  readonly pidVersion: number;
};
interface ProcCalls {
  list(buffer: Buffer, bytes: number): number;
  info(pid: number, flavor: number, arg: bigint, buffer: Buffer, bytes: number): number;
  signal(token: Buffer, signal: number): number;
}
let calls: ProcCalls | undefined;
function native(): ProcCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "Darwin scope observation requires the 64-bit libproc backend");
  calls ??= (() => {
    const library = load("/usr/lib/libproc.dylib");
    return { list: library.func("int proc_listallpids(void *buffer, int bytes)"),
      info: library.func("int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int bytes)"),
      signal: library.func("int proc_signal_with_audittoken(void *token, int signal)") };
  })();
  return calls;
}
function validWitness(witness: DarwinSessionWitness): void {
  if (witness.kind !== "darwin-audit-session" || !/^[0-9]{1,20}$/.test(witness.coalitionId) ||
      ![witness.auditSession, witness.pid, witness.pidVersion].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff))
    throw new TypeError("invalid Darwin execution witness");
}
function failed(operation: string): never {
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`${operation}: ${code}`), { code });
}
function coalition(pid: number): string | null {
  const result = Buffer.alloc(32), size = native().info(pid, 20, 0n, result, result.length);
  if (size === 0) return null;
  if (size !== result.length) failed("coalition observation");
  return result.readBigUInt64LE(0).toString();
}
function processToken(pid: number, auditSession: number, auid: number): Buffer | null {
  const unique = Buffer.alloc(56), uniqueSize = native().info(pid, 17, 0n, unique, unique.length);
  if (uniqueSize === 0) return null;
  if (uniqueSize !== unique.length) failed("process version observation");
  const bsd = Buffer.alloc(136), bsdSize = native().info(pid, 3, 0n, bsd, bsd.length);
  if (bsdSize === 0) return null;
  if (bsdSize !== bsd.length || bsd.readUInt32LE(12) !== pid) failed("process identity observation");
  const token = Buffer.alloc(32);
  token.writeUInt32LE(auid, 0); token.writeUInt32LE(bsd.readUInt32LE(20), 4);
  token.writeUInt32LE(bsd.readUInt32LE(24), 8); token.writeUInt32LE(bsd.readUInt32LE(28), 12);
  token.writeUInt32LE(bsd.readUInt32LE(32), 16); token.writeUInt32LE(pid, 20);
  token.writeUInt32LE(auditSession, 24); token.writeUInt32LE(unique.readUInt32LE(36), 28);
  return token;
}
function members(witness: DarwinSessionWitness): number[] | null {
  try {
    const api = native();
    for (let bytes = 65536; bytes <= 4 * 1024 * 1024; bytes *= 4) {
      const buffer = Buffer.alloc(bytes), count = api.list(buffer, bytes);
      if (count < 0 || count % 4 !== 0) return null;
      if (count === bytes) continue;
      const found: number[] = [];
      for (let offset = 0; offset < count; offset += 4) {
        const pid = buffer.readUInt32LE(offset);
        if (pid !== 0 && coalition(pid) === witness.coalitionId) found.push(pid);
      }
      return found;
    }
    return null;
  } catch { return null; }
}
export function observeDarwinExecutionLeader(pid: number, auditSession: number, coalitionId: string, auid = 0): DarwinSessionWitness | null {
  if (!Number.isSafeInteger(pid) || pid < 2 || !Number.isSafeInteger(auditSession) || auditSession <= 0 || !/^[0-9]{1,20}$/.test(coalitionId)) return null;
  const token = processToken(pid, auditSession, auid);
  return token === null ? null : { kind: "darwin-audit-session", auditSession, coalitionId, pid, pidVersion: token.readUInt32LE(28) };
}
export function observeDarwinSessionPopulation(witness: DarwinSessionWitness): "populated" | "empty" | "unknown" {
  validWitness(witness);
  const current = members(witness);
  return current === null ? "unknown" : current.length === 0 ? "empty" : "populated";
}
/** Every effect targets a fresh PID+pidversion token. Coalition observation
 * selects scope membership; numeric saved PIDs alone are never signaled. */
export function terminateDarwinSessionMembers(witness: DarwinSessionWitness, auid = 0): void {
  validWitness(witness);
  const current = members(witness);
  if (current === null) throw new StoreError("RUN_TERMINATION_UNKNOWN", "Darwin scope membership could not be observed");
  for (const pid of current) {
    const token = processToken(pid, witness.auditSession, auid);
    if (token === null) continue;
    if (native().signal(token, 9) !== 0) {
      if (errno() === 3 /* ESRCH */) continue;
      failed("signal Darwin scope member");
    }
  }
}
