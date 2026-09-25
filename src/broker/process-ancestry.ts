/** AUTH-003/PR-001: whether a peer is a descendant of the Principal engine.
 *
 * The credential says a connection belongs to this broker's run. It does not
 * say which process presented it, and any process of this user that learned
 * it could present it. Descent from the engine the host registered does say
 * that: a process becomes a descendant of another only by being started by it,
 * and a process that is not one cannot make itself one without tracing the
 * engine -- which the kernel's ptrace restriction (Yama, scope >= 1) refuses
 * for a process that is not its ancestor. On a host that permits ptrace
 * between any two processes of a user, no user-space check separates them;
 * that is a property of the host, stated rather than hidden.
 *
 * A pid alone can be reused, so the engine is pinned by its start time as well,
 * and every step of the walk reads /proc fresh. Anything unreadable, malformed
 * or too deep is "not a descendant": the walk fails closed. Failing closed is
 * refusing, not concluding that a process ended: only `processEnded` says
 * that, and only from what /proc answered.
 */
import { readFileSync } from "node:fs";

export interface ProcessIdentity {
  readonly pid: number;
  /** Clock ticks since boot at which the process started (proc(5), field 22). */
  readonly startTime: string;
}

/** Deeper than any chain the engine starts (engine, then the CLI it runs). A
 * longer walk is not a descendant OMA started. */
const MAXIMUM_DEPTH = 16;

/** What /proc says about a pid: running (with its parent and start time),
 * exited (the kernel has no such process), or unavailable -- unreadable for
 * any other reason (too many open files, no memory, a hidden /proc) or
 * malformed. Unavailable is not exited (INV02). */
type ProcessObservation =
  | { readonly kind: "running"; readonly ppid: number; readonly startTime: string }
  | { readonly kind: "exited" }
  | { readonly kind: "unavailable" };

function stat(pid: number): ProcessObservation {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { kind: "unavailable" };
  let text: string;
  try { text = readFileSync(`/proc/${pid}/stat`, "utf8"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ESRCH" ? { kind: "exited" } : { kind: "unavailable" };
  }
  // The command name is parenthesised and may itself contain ") ", so the
  // fields are counted from the last closing parenthesis.
  const close = text.lastIndexOf(")");
  if (close < 0) return { kind: "unavailable" };
  const fields = text.slice(close + 2).trim().split(" ");
  // After the name: state(3) ppid(4) ... starttime(22).
  const ppid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isSafeInteger(ppid) || ppid < 0 || startTime === undefined || !/^[0-9]+$/.test(startTime)) return { kind: "unavailable" };
  return { kind: "running", ppid, startTime };
}

/** The identity of a running process, or null if it is not observed running. */
export function processIdentity(pid: number): ProcessIdentity | null {
  const observed = stat(pid);
  return observed.kind === "running" ? Object.freeze({ pid, startTime: observed.startTime }) : null;
}

/** The parent of a running process, or null if it cannot be observed. */
export function parentOf(pid: number): number | null {
  const observed = stat(pid);
  return observed.kind === "running" ? observed.ppid : null;
}

/** Whether the process an identity pins has ended (INV02). "ended" only when
 * /proc says so: the pid names no process, or names one that started at
 * another time. What cannot be read is "unknown", which refuses what the
 * process would have been trusted for but ends nothing on its behalf. */
export function processEnded(identity: ProcessIdentity): "running" | "ended" | "unknown" {
  const observed = stat(identity.pid);
  if (observed.kind === "unavailable") return "unknown";
  return observed.kind === "running" && observed.startTime === identity.startTime ? "running" : "ended";
}

/** True only if `pid` is `ancestor` itself or was started, directly or
 * through its descendants, by the very process `ancestor` names. */
export function descendsFrom(pid: number, ancestor: ProcessIdentity): boolean {
  let current = pid;
  for (let depth = 0; depth <= MAXIMUM_DEPTH; depth += 1) {
    const observed = stat(current);
    if (observed.kind !== "running") return false;
    if (current === ancestor.pid) return observed.startTime === ancestor.startTime;
    if (observed.ppid <= 1) return false;
    current = observed.ppid;
  }
  return false;
}
