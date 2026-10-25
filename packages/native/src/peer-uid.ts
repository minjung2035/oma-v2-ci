/** MAC-021: which user a Host API connection came from, asked of the kernel
 * -- getpeereid(3) on macOS, SO_PEERCRED on Linux (where the host side is
 * also run in tests). Unknown is null, never a guess. */
import type { Socket } from "node:net";
import { load } from "koffi";
import { peerCred, socketDescriptor } from "./linux.js";

type GetPeerEid = (fd: number, uid: Buffer, gid: Buffer) => number;
let getpeereid: GetPeerEid | null = null;

export function peerUid(socket: Socket): number | null {
  const fd = socketDescriptor(socket);
  if (fd === null) return null;
  if (process.platform === "linux") return peerCred(fd)?.uid ?? null;
  if (process.platform !== "darwin") return null;
  try {
    getpeereid ??= load(null).func("int getpeereid(int s, void *euid, void *egid)") as unknown as GetPeerEid;
    const uid = Buffer.alloc(4); const gid = Buffer.alloc(4);
    return getpeereid(fd, uid, gid) === 0 ? uid.readUInt32LE(0) : null;
  } catch { return null; }
}
