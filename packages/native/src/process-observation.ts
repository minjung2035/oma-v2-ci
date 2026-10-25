/** Kernel observations only. Ancestry, grants and authorization are shared TS
 * broker policy; a failed observation never reports a dead process. */
import { readFileSync } from "node:fs";
import { errno, load } from "koffi";

export type ProcessObservation =
  | { readonly kind: "running"; readonly ppid: number; readonly startTime: string }
  | { readonly kind: "exited" }
  | { readonly kind: "unavailable" };

export function observeLinuxProcess(pid: number): ProcessObservation {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== "linux") return { kind: "unavailable" };
  let text: string;
  try { text = readFileSync(`/proc/${pid}/stat`, "utf8"); }
  catch (error) { return ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") ? { kind: "exited" } : { kind: "unavailable" }; }
  const close = text.lastIndexOf(")");
  if (close < 0) return { kind: "unavailable" };
  const fields = text.slice(close + 2).trim().split(" "), ppid = Number(fields[1]), startTime = fields[19];
  if (!Number.isSafeInteger(ppid) || ppid < 0 || startTime === undefined || !/^[0-9]+$/.test(startTime)) return { kind: "unavailable" };
  return { kind: "running", ppid, startTime };
}

let procInfo: ((pid: number, flavor: number, arg: bigint, buffer: Buffer, size: number) => number) | undefined;
export function observeDarwinProcess(pid: number): ProcessObservation {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== "darwin") return { kind: "unavailable" };
  try {
    procInfo ??= load("/usr/lib/libproc.dylib").func("int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int size)");
    // Public proc_bsdinfo ABI (PROC_PIDTBSDINFO). CI also checks SDK offsets;
    // size/identity disagreement refuses instead of reading guessed fields.
    const buffer = Buffer.alloc(136), size = procInfo(pid, 3, 0n, buffer, buffer.length);
    if (size <= 0) return errno() === 3 /* ESRCH */ ? { kind: "exited" } : { kind: "unavailable" };
    if (size !== buffer.length || buffer.readUInt32LE(12) !== pid) return { kind: "unavailable" };
    const seconds = buffer.readBigUInt64LE(120), micros = buffer.readBigUInt64LE(128);
    if (micros >= 1_000_000n) return { kind: "unavailable" };
    return { kind: "running", ppid: buffer.readUInt32LE(16), startTime: String(seconds * 1_000_000n + micros) };
  } catch { return { kind: "unavailable" }; }
}
