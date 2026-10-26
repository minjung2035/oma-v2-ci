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
 * unreadable or malformed is "not a descendant": the walk fails closed. A walk
 * that revisits a pid -- the only way a parent chain can fail to end at init --
 * is no chain the engine started either, and ends the walk the same way.
 * Failing closed is refusing, not concluding that a process ended: only
 * `processEnded` says that, and only from what the substrate answered.
 */
import { observeLinuxProcess, observeDarwinProcess, type ProcessObservation } from "@oma/native/process-observation";
export type { ProcessObservation };
export interface ProcessIdentity { readonly pid: number; readonly startTime: string }
export type ProcessObservationReader = (pid: number) => ProcessObservation;

/** A platform with no shipped substrate observes nothing. This is not an
 * absent /proc reporting every pid exited -- it is the honest "could not be
 * observed", so authority decisions that ask it fail closed without ever
 * being told a living process ended (INV02). */
const blindStat: ProcessObservationReader = () => ({ kind: "unavailable" });

/** The process-observation port: the four questions the Principal's
 * authority asks of a platform's substrate. */
export interface ProcessProbe {
  /** The actual reader: proc on Linux, libproc on Darwin, none elsewhere.
   * Reader availability alone does not qualify per-message authentication
   * or the complete G-AUTH execution binding. */
  readonly substrate: "proc" | "libproc" | "none";
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

function buildProbe(substrate: "proc" | "libproc" | "none", read: ProcessObservationReader): ProcessProbe {
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
      // No fixed depth: a real chain ends at init (ppid <= 1), and a walk that
      // revisits a pid -- the only other way it could not terminate -- is no
      // chain the engine started. Depth alone is not a refusal.
      let current = pid;
      const chain = new Map<number, { readonly ppid: number; readonly startTime: string }>();
      for (;;) {
        const observed = read(current);
        if (observed.kind !== "running" || chain.has(current)) return false;
        chain.set(current, { ppid: observed.ppid, startTime: observed.startTime });
        if (current === ancestor.pid) {
          if (observed.startTime !== ancestor.startTime) return false;
          // A later parent lookup may have followed a recycled numeric PID
          // after an earlier child was reparented. Re-read every saved identity
          // and relationship, with the pinned ancestor last, before answering.
          // This refuses inconsistent observations; native sender/scope pins
          // are still required and this is not an atomic kernel tree snapshot.
          for (const [pid, previous] of chain) {
            const fresh = read(pid);
            if (fresh.kind !== "running" || fresh.startTime !== previous.startTime || fresh.ppid !== previous.ppid)
              return false;
          }
          return true;
        }
        if (observed.ppid <= 1) return false;
        current = observed.ppid;
      }
    },
  };
}

/** Linux uses /proc; an actual Darwin host uses the public libproc reader.
 * Other hosts observe nothing. Supplying a test reader does not claim that
 * host's native substrate or qualify the broader G-AUTH execution binding.
 */
export function processProbeFor(platform: NodeJS.Platform | string, reader?: ProcessObservationReader): ProcessProbe {
  if (platform === "linux") return buildProbe("proc", reader ?? observeLinuxProcess);
  if (platform === "darwin" && process.platform === "darwin") return buildProbe("libproc", reader ?? observeDarwinProcess);
  return buildProbe("none", reader ?? blindStat);
}

/** The probe this process's platform gets, chosen once: the product's own
 * authority decisions read it, and there is no second way to observe a
 * process. */
export const hostProcessProbe: ProcessProbe = processProbeFor(process.platform);
// Process identity alone does not close G-AUTH; peer pinning remains required.

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
