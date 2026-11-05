/** A directly inherited private socket's original parent. This is neither a
 * public socket authenticator nor per-message sender evidence. The spawning
 * owner must keep the parent's endpoint private and never forward it. */
import { load } from "koffi";
import { decodeDarwinAuditToken } from "./audit-token.js";
import { observeDarwinProcess } from "./process-observation.js";
import { watchDarwinProcess, type ProcessEventWatch } from "./process-event.js";
import { withCleanup } from "./cleanup.js";

export interface PrivateParentPin {
  readonly identity: { readonly pid: number; readonly startTime: string };
  alive(): boolean;
  close(): void;
}
let calls: {
  token(fd: number, level: number, option: number, bytes: Buffer, size: Uint32Array): number;
  ids(fd: number, uid: Buffer, gid: Buffer): number;
} | undefined;
export function pinDarwinPrivateParent(fd: number): PrivateParentPin | null {
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
    const system = calls, parent = process.ppid;
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
    if (observed.kind !== "running" || held.state() !== "live" || after === null || !after.equals(before) || process.ppid !== parent)
      return withCleanup(() => null, () => held.close());
    const identity = Object.freeze({ pid: parent, startTime: observed.startTime });
    let closed = false, failed = false, closeFailure: unknown;
    return Object.freeze({
      identity,
      alive(): boolean {
        if (closed || failed) return false;
        try {
          const current = observeDarwinProcess(parent), fresh = token();
          if (process.ppid === parent && held.state() === "live" && current.kind === "running" &&
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
  } catch (error) {
    return withCleanup(() => null, () => watch?.close());
  }
}
