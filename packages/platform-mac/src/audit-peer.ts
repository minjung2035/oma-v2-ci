/** One Mach sender's OS identity binding. This adapter grants no actor, role,
 * or capability. It observes physical membership; common broker policy owns authority.
 * The queue precedes asynchronous audit validation, avoiding a PID-only binding to
 * a replacement process. Actual Darwin qualification remains NOT_RUN.
 */
import { isMachAuditSender, type MachAuditSender } from "@oma/native/mach-message";
import { StoreError } from "@oma/domain/errors";
import { observeDarwinAuditOrigin } from "@oma/native/audit-origin";
import { watchDarwinProcess } from "@oma/native/process-event";
import { withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { identifyDarwinCoalition } from "@oma/native/audit-session";

export interface MachPeerPin {
  readonly pid: number; readonly uid: number; readonly gid: number;
  readonly token: readonly number[];
  readonly auditSession: number;
  alive(): boolean;
  sameSender(sender: unknown): boolean;
  inScope(identity: unknown): boolean;
  close(): void;
}
export interface MachPeerBinding {
  readonly ready: Promise<void>;
  /** One explicit transfer. Closing before take returns the unclaimed watch. */
  take(): MachPeerPin;
  /** Joins native completion after rejection/cancellation. Authentication
   * refusal is distinct from unconfirmed resource return. */
  close(): Promise<void>;
}
export function bindMachSender(sender: MachAuditSender): MachPeerBinding {
  if (!isMachAuditSender(sender)) throw new TypeError("Mach peer binding requires a freshly received kernel audit sender");
  const watch = watchDarwinProcess(sender.pid);
  let origin: ReturnType<typeof observeDarwinAuditOrigin>;
  try { origin = observeDarwinAuditOrigin(sender.token); }
  catch (error) { return withCleanup(() => { throw error; }, () => watch.close()); }
  let closing = false, matched = false, taken = false, closeResult: Promise<void> | undefined;
  const ready = origin.result.then(observed => {
    if (closing) throw new StoreError("AUTH_FAILED", "Mach peer binding was cancelled");
    if (observed.kind !== "matched")
      throw Object.assign(new StoreError("AUTH_FAILED", "Mach sender audit origin could not be bound to a live image"), { osStatus: observed.osStatus });
    if (watch.state() !== "live") throw new StoreError("AUTH_FAILED", "Mach sender changed or ended during identity binding");
    matched = true;
  });
  void ready.catch(() => {});
  return Object.freeze({
    ready,
    take(): MachPeerPin {
      if (!matched || closing || taken || watch.state() !== "live") throw new StoreError("AUTH_FAILED", "Mach peer binding has no transferable live pin");
      taken = true;
      let closed = false, closeFailure: unknown;
      return Object.freeze({
        pid: sender.pid, uid: sender.uid, gid: sender.gid, token: sender.token, auditSession: sender.auditSession,
        alive: () => !closed && watch.state() === "live",
        // Every packet needs new kernel provenance and the full pidVersion
        // token; claimed PID, UID and descriptor possession are insufficient.
        sameSender(next: unknown): boolean {
          return !closed && isMachAuditSender(next) &&
            next.token.every((word, index) => word === sender.token[index]) && watch.state() === "live";
        },
        inScope(identity: unknown): boolean {
          if (closed || watch.state() !== "live" || identity === null || typeof identity !== "object" || Array.isArray(identity)) return false;
          try {
            if (Object.keys(identity).sort().join() !== "bootId,coalitionId,kind") return false;
            const observed = identifyDarwinCoalition(sender.pid);
            return observed !== null && "kind" in identity && "bootId" in identity && "coalitionId" in identity &&
              identity.kind === observed.kind && identity.bootId === observed.bootId && identity.coalitionId === observed.coalitionId &&
              watch.state() === "live";
          } catch { return false; } // An unanswered membership observation never grants authority or proves death.
        },
        close() {
          if (closeFailure !== undefined) throw closeFailure;
          if (closed) return;
          closed = true;
          try { watch.close(); } catch (error) { closeFailure = error; throw error; }
        },
      });
    },
    close(): Promise<void> {
      if (closeResult !== undefined) return closeResult;
      closing = true;
      closeResult = withAsyncCleanup(async () => {
        await ready.catch(() => {});
        await origin.returned;
      }, () => { if (!taken) watch.close(); });
      return closeResult;
    },
  });
}
