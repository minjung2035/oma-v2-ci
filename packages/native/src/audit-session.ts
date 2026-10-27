/** Kernel audit-session identity and exact-process effects only. Launchd job
 * provisioning, scope population and recovery policy belong to their owners. */
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { decodeDarwinAuditToken } from "./audit-token.js";

export type DarwinSessionWitness = {
  readonly kind: "darwin-audit-session";
  readonly auditSession: number;
  readonly pid: number;
  readonly pidVersion: number;
};
interface SessionCalls {
  list(buffer: Buffer, bytes: number): number;
  signal(token: Buffer, signal: number): number;
}
let calls: SessionCalls | undefined;
function native(): SessionCalls {
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "audit-session observation requires Darwin 64-bit libproc");
  calls ??= (() => {
    const library = load("/usr/lib/libproc.dylib");
    return { list: library.func("int proc_listallpids(void *buffer, int bytes)"),
      signal: library.func("int proc_signal_with_audittoken(void *token, int signal)") };
  })();
  return calls;
}
function failed(operation: string): never {
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`${operation}: ${code}`), { code });
}
function validWitness(witness: DarwinSessionWitness): void {
  if (witness.kind !== "darwin-audit-session" ||
      ![witness.auditSession, witness.pid, witness.pidVersion].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff))
    throw new TypeError("invalid Darwin audit-session witness");
}
/** A complete snapshot attempt. A buffer that cannot hold the kernel's answer
 * is not evidence that the scope is empty. */
export function observeDarwinSessionPopulation(witness: DarwinSessionWitness): "populated" | "empty" | "unknown" {
  validWitness(witness);
  try {
    const api = native();
    for (let bytes = 65536; bytes <= 4 * 1024 * 1024; bytes *= 4) {
      const buffer = Buffer.alloc(bytes), count = api.list(buffer, bytes);
      if (count < 0 || count % 4 !== 0) return "unknown";
      if (count === bytes) continue;
      for (let offset = 0; offset < count; offset += 4) {
        const pid = buffer.readUInt32LE(offset);
        if (pid === 0) continue;
        if (pid === witness.pid) return "populated";
        const token = observeDarwinProcessToken(pid);
        if (token?.auditSession === witness.auditSession) return "populated";
      }
      return "empty";
    }
    return "unknown";
  } catch { return "unknown"; }
}
export function terminateDarwinSessionMember(witness: DarwinSessionWitness): void {
  validWitness(witness);
  const token = Buffer.alloc(32);
  // Only the leader's exact PID+pidversion is a signal target. Descendant
  // tokens are acquired from current audit-session observations, never stored.
  const current = observeDarwinProcessToken(witness.pid);
  if (current?.pidVersion !== witness.pidVersion || current.auditSession !== witness.auditSession)
    throw new StoreError("RUN_TERMINATION_UNKNOWN", "Darwin execution leader identity no longer matches");
  for (const [index, word] of current.token.entries()) token.writeUInt32LE(word, index * 4);
  if (native().signal(token, 9) !== 0) failed("signal Darwin execution leader");
}
export interface DarwinProcessToken extends ReturnType<typeof decodeDarwinAuditToken> {
  readonly token: readonly number[];
}
export function observeDarwinProcessToken(token: readonly number[]): DarwinProcessToken | null {
  if (!Array.isArray(token) || token.length !== 8 || token.some(word => !Number.isSafeInteger(word) || word < 0 || word > 0xffffffff))
    throw new TypeError("invalid audit token");
  return { ...decodeDarwinAuditToken(token), token: Object.freeze([...token]) };
}
