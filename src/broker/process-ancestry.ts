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
 * and every step of the walk reads the observation substrate fresh. Anything
 * unreadable, malformed or too deep is "not a descendant": the walk fails
 * closed. Failing closed is refusing, not concluding that a process ended:
 * only `processEnded` says that, and only from what the substrate answered.
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

/** What the substrate says about a pid: running (with its parent and start
 * time), exited (the kernel has no such process), or unavailable -- unreadable
 * for any other reason (too many open files, no memory, a hidden /proc),
 * malformed, or a platform with no substrate at all. Unavailable is not
 * exited (INV02). */
export type ProcessObservation =
  | { readonly kind: "running"; readonly ppid: number; readonly startTime: string }
  | { readonly kind: "exited" }
  | { readonly kind: "unavailable" };

/** One observation. The seam a platform's substrate plugs into. */
export type ProcessObservationReader = (pid: number) => ProcessObservation;

/** Linux's substrate: /proc/<pid>/stat. */
function procStat(pid: number): ProcessObservation {
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

/** A platform with no shipped substrate observes nothing. This is not an
 * absent /proc reporting every pid exited -- it is the honest "could not be
 * observed", so authority decisions that ask it fail closed without ever
 * being told a living process ended (INV02). */
const blindStat: ProcessObservationReader = () => ({ kind: "unavailable" });

/** The process-observation port: the four questions the Principal's
 * authority asks of a platform's substrate. */
export interface ProcessProbe {
  /** Which substrate answers: "proc" on Linux, "none" where none is
   * shipped. The macOS equivalence lane is explicitly NOT_RUN -- no native
   * darwin substrate is claimed; where a verification lane needs to say so,
   * this field is what it reads. */
  readonly substrate: "proc" | "none";
  /** The identity of a running process, or null if it is not observed running. */
  identity(pid: number): ProcessIdentity | null;
  /** The parent of a running process, or null if it cannot be observed. */
  parentOf(pid: number): number | null;
  /** Whether the process an identity pins has ended (INV02). */
  ended(identity: ProcessIdentity): "running" | "ended" | "unknown";
  /** True only if `pid` is `ancestor` itself or was started, directly or
   * through its descendants, by the very process `ancestor` names. */
  descendsFrom(pid: number, ancestor: ProcessIdentity): boolean;
}

function buildProbe(substrate: "proc" | "none", read: ProcessObservationReader): ProcessProbe {
  return {
    substrate,
    identity(pid) {
      const observed = read(pid);
      return observed.kind === "running" ? Object.freeze({ pid, startTime: observed.startTime }) : null;
    },
    parentOf(pid) {
      const observed = read(pid);
      return observed.kind === "running" ? observed.ppid : null;
    },
    ended(identity) {
      const observed = read(identity.pid);
      if (observed.kind === "unavailable") return "unknown";
      return observed.kind === "running" && observed.startTime === identity.startTime ? "running" : "ended";
    },
    descendsFrom(pid, ancestor) {
      let current = pid;
      for (let depth = 0; depth <= MAXIMUM_DEPTH; depth += 1) {
        const observed = read(current);
        if (observed.kind !== "running") return false;
        if (current === ancestor.pid) return observed.startTime === ancestor.startTime;
        if (observed.ppid <= 1) return false;
        current = observed.ppid;
      }
      return false;
    },
  };
}

/** The substrate this platform is shipped: Linux reads /proc. Every other
 * platform -- including darwin, where /proc does not exist and reading one
 * anyway would call every pid "exited" -- gets the blind probe: the macOS
 * equivalence lane is NOT_RUN, so no native substrate is claimed and nothing
 * is observed. `reader` is a test's own substrate. */
export function processProbeFor(platform: NodeJS.Platform | string, reader?: ProcessObservationReader): ProcessProbe {
  return platform === "linux" ? buildProbe("proc", reader ?? procStat) : buildProbe("none", reader ?? blindStat);
}

/** The probe this process's platform gets, chosen once: the product's own
 * authority decisions read it, and there is no second way to observe a
 * process. */
export const hostProcessProbe: ProcessProbe = processProbeFor(process.platform);
// macOS and every other platform: blind. A Principal endpoint is never
// opened over a substrate that cannot observe -- the supervision channel's
// host identity comes back unobserved and the broker declines the channel.

/** The identity of a running process, or null if it is not observed running. */
export function processIdentity(pid: number): ProcessIdentity | null {
  return hostProcessProbe.identity(pid);
}

/** The parent of a running process, or null if it cannot be observed. */
export function parentOf(pid: number): number | null {
  return hostProcessProbe.parentOf(pid);
}

/** Whether the process an identity pins has ended (INV02). "ended" only when
 * the substrate says so: the pid names no process, or names one that started
 * at another time. What cannot be read is "unknown", which refuses what the
 * process would have been trusted for but ends nothing on its behalf. */
export function processEnded(identity: ProcessIdentity): "running" | "ended" | "unknown" {
  return hostProcessProbe.ended(identity);
}

/** True only if `pid` is `ancestor` itself or was started, directly or
 * through its descendants, by the very process `ancestor` names. */
export function descendsFrom(pid: number, ancestor: ProcessIdentity): boolean {
  return hostProcessProbe.descendsFrom(pid, ancestor);
}
