/** One Mach sender's OS identity binding. This adapter grants no actor, role,
 * scope membership or capability. Common broker policy owns those decisions.
 * The queue precedes dynamic audit validation, avoiding a PID-only binding to
 * a replacement process. Actual Darwin qualification remains NOT_RUN.
 */
import { isMachAuditSender, type MachAuditSender } from "@oma/native/mach-message";
import { observeDarwinAuditOrigin } from "@oma/native/audit-origin";
import { watchDarwinProcess } from "@oma/native/process-event";
import { withCleanup } from "@oma/native/cleanup";

export interface MachPeerPin {
  readonly pid: number; readonly uid: number; readonly gid: number;
  readonly token: readonly number[];
  alive(): boolean;
  sameSender(sender: unknown): boolean;
  close(): void;
}
export function pinMachSender(sender: MachAuditSender): MachPeerPin {
  if (!isMachAuditSender(sender)) throw new TypeError("Mach peer binding requires a freshly received kernel audit sender");
  const watch = watchDarwinProcess(sender.pid);
  try {
    const observed = observeDarwinAuditOrigin(sender.token);
    if (observed.kind !== "matched")
      throw Object.assign(new Error("Mach sender audit origin could not be bound to a live image"), { osStatus: observed.osStatus });
    if (watch.state() !== "live") throw new Error("Mach sender changed or ended during identity binding");
    let closed = false;
    return Object.freeze({
      pid: sender.pid, uid: sender.uid, gid: sender.gid, token: sender.token,
      alive: () => !closed && watch.state() === "live",
      // Every byte packet needs new kernel provenance and the complete token,
      // including pidVersion. Claimed PID, same UID and descriptor possession
      // do not identify the sender of a later packet.
      sameSender(next: unknown): boolean {
        return !closed && isMachAuditSender(next) &&
          next.token.every((word, index) => word === sender.token[index]) && watch.state() === "live";
      },
      close() { if (closed) return; closed = true; watch.close(); },
    });
  } catch (error) { return withCleanup(() => { throw error; }, () => watch.close()); }
}
