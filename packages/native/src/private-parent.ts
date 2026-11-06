/** A directly inherited private socket's original parent. This is neither a
 * public socket authenticator nor per-message sender evidence. The spawning
 * owner must keep the parent's endpoint private and never forward it. */
import { load } from "koffi";
import { decodeDarwinAuditToken } from "./audit-token.js";
import { observeDarwinProcess } from "./process-observation.js";
import { watchDarwinProcess, type ProcessEventWatch } from "./process-event.js";
import { withCleanup } from "./cleanup.js";
import { StoreError } from "@oma/domain/errors";

export interface PrivateParentPin {
  readonly identity: { readonly pid: number; readonly startTime: string };
  alive(): boolean;
  close(): void;
}
const children = new WeakMap<PrivateParentPin, readonly number[]>();
let calls: {
  token(fd: number, level: number, option: number, bytes: Buffer, size: Uint32Array): number;
  ids(fd: number, uid: Buffer, gid: Buffer): number;
} | undefined;
export function pinDarwinPrivateParent(fd: number): PrivateParentPin | null {
  return pinPrivatePeer(fd, process.ppid, true);
}
/** Caller owns the unreaped child and keeps this endpoint private. A PID or
 * public socket alone cannot establish this relationship. */
export function pinDarwinPrivateChild(fd: number, pid: number): PrivateParentPin | null {
  return pinPrivatePeer(fd, pid, false);
}
/** A connection borrows the generation owner's watch; it cannot keep an old
 * Broker authorized after that owner closes or replaces the generation. */
export function borrowDarwinPrivateChild(pin: PrivateParentPin): { readonly token: readonly number[]; alive(): boolean; close(): void } {
  const token = children.get(pin);
  if (token === undefined || !pin.alive()) throw new StoreError("AUTH_FAILED", "expected peer has no live private child acquisition");
  return Object.freeze({ token, alive: () => pin.alive(), close() {} });
}
function pinPrivatePeer(fd: number, parent: number, isParent: boolean): PrivateParentPin | null {
  if (process.platform !== "darwin" || !Number.isSafeInteger(fd) || fd < 0) return null;
  let watch: ProcessEventWatch | undefined;
  try {
    if (calls === undefined) {
      const library = load(null);
      calls = {
        token: library.func("int getsockopt(int fd, int level, int option, void *bytes, unsigned int *size)"),
        ids: library.func("int getpeereid(int fd, void *uid, void *gid)"),
      };
    }
    const system = calls;
    if (!Number.isSafeInteger(parent) || parent < 2 || parent > 0x7fffffff) return null;
    const uid = Buffer.alloc(4), gid = Buffer.alloc(4);
    if (parent < 2 || system.ids(fd, uid, gid) !== 0 || uid.readUInt32LE() !== process.geteuid?.()) return null;
    const token = (): Buffer | null => {
      const bytes = Buffer.alloc(32), size = new Uint32Array([32]);
      return system.token(fd, 0 /* SOL_LOCAL */, 6 /* LOCAL_PEERTOKEN */, bytes, size) === 0 && size[0] === 32 ? bytes : null;
    };
    const before = token();
    if (before === null) return null;
    const decoded = decodeDarwinAuditToken(Array.from({ length: 8 }, (_, index) => before.readUInt32LE(index * 4)));
    if (decoded.pid !== parent || decoded.uid !== uid.readUInt32LE() || decoded.pidVersion === 0) return null;
    watch = watchDarwinProcess(parent);
    const held = watch, observed = observeDarwinProcess(parent);
    const after = token();
    const related = (value: ReturnType<typeof observeDarwinProcess>): boolean => value.kind === "running" &&
      (isParent ? process.ppid === parent : value.ppid === process.pid);
    if (!related(observed) || observed.kind !== "running" || held.state() !== "live" || after === null || !after.equals(before))
      return withCleanup(() => null, () => held.close());
    const identity = Object.freeze({ pid: parent, startTime: observed.startTime });
    let closed = false, failed = false, closeFailure: unknown;
    const pin = Object.freeze({
      identity,
      alive(): boolean {
        if (closed || failed) return false;
        try {
          const current = observeDarwinProcess(parent), fresh = token();
          if (related(current) && held.state() === "live" && current.kind === "running" &&
              current.startTime === identity.startTime && fresh !== null && fresh.equals(before)) return true;
        } catch { /* A failed observation withdraws authority; it proves no death. */ }
        failed = true; return false;
      },
      close(): void {
        if (closeFailure !== undefined) throw closeFailure;
        if (closed) return;
        closed = true;
        try { held.close(); } catch (error) { closeFailure = error; throw error; }
      },
    });
    if (!isParent) children.set(pin, Object.freeze(Array.from({ length: 8 }, (_, index) => before.readUInt32LE(index * 4))));
    return pin;
  } catch (error) {
    return withCleanup(() => null, () => watch?.close());
  }
}
