// MUST [S-01]: minimal native leaf for SO_PEERCRED, sd_notify and the
// process-lifetime REC-007 advisory lock through koffi FFI.
import { closeSync, openSync } from "node:fs";
import { load } from "koffi";
import { endianness } from "node:os";

const NATIVE_LE = endianness() === "LE";

export interface PeerCred {
  pid: number;
  uid: number;
  gid: number;
}

let cached: {
  getsockopt: (
    fd: number,
    level: number,
    opt: number,
    optval: ArrayBuffer,
    optlen: Uint32Array,
  ) => number;
  socket: (domain: number, type: number, proto: number) => number;
  connect: (fd: number, addr: Buffer, len: number) => number;
  send: (fd: number, buf: Buffer, len: number, flags: number) => number;
  flock: (fd: number, op: number) => number;
  poll: (fds: ArrayBuffer, count: number, timeout: number) => number;
} | null = null;

function lib(): typeof cached extends null
  ? never
  : Exclude<typeof cached, null> {
  if (!cached) {
    const libc = load(null);
    cached = {
      getsockopt: libc.func(
        "int getsockopt(int socket, int level, int optname, void *optval, unsigned int *optlen)",
      ),
      socket: libc.func("int socket(int domain, int type, int protocol)"),
      connect: libc.func(
        "int connect(int fd, const void *addr, unsigned int len)",
      ),
      send: libc.func(
        "int send(int fd, const void *buf, unsigned int len, int flags)",
      ),
      flock: libc.func("int flock(int fd, int operation)"),
      poll: libc.func("int poll(void *fds, unsigned long nfds, int timeout)"),
    };
  }
  return cached;
}

const SOL_SOCKET = 1;
const SO_PEERCRED = 17; // Linux

/** MUST [S-01]/[AUTH-003]: peer identity of an accepted unix socket. */
export function peerCred(fd: number): PeerCred | null {
  if (!Number.isInteger(fd) || fd < 0) return null;
  try {
    const optval = new ArrayBuffer(12);
    const optlen = new Uint32Array([12]);
    const r = lib().getsockopt(fd, SOL_SOCKET, SO_PEERCRED, optval, optlen);
    if (r !== 0 || optlen[0] !== 12) return null;
    const d = new DataView(optval);
    return {
      pid: d.getInt32(0, NATIVE_LE),
      uid: d.getUint32(4, NATIVE_LE),
      gid: d.getUint32(8, NATIVE_LE),
    };
  } catch {
    return null;
  }
}

/** Linux SO_PEERPIDFD pins the original connector, not a recyclable PID. Caller owns the returned FD. */
export function peerPidFd(fd: number): number | null {
  if (!Number.isInteger(fd) || fd < 0) return null;
  try {
    const value = new ArrayBuffer(4);
    const size = new Uint32Array([4]);
    const result = lib().getsockopt(fd, SOL_SOCKET, 77 /* SO_PEERPIDFD */, value, size);
    if (result !== 0 || size[0] !== 4) return null;
    const pinned = new DataView(value).getInt32(0, NATIVE_LE);
    return pinned >= 0 ? pinned : null;
  } catch { return null; }
}

/** Only accepts an owned peerPidFd result; no blocking waits or /proc PID lookups. */
export function peerPidAlive(fd: number): boolean {
  if (!Number.isInteger(fd) || fd < 0) return false;
  try {
    const buffer = new ArrayBuffer(8); // struct pollfd: int fd, short events, short revents
    const pollfd = new DataView(buffer);
    pollfd.setInt32(0, fd, NATIVE_LE);
    pollfd.setInt16(4, 1 /* POLLIN */, NATIVE_LE);
    return lib().poll(buffer, 1, 0) === 0; // exited, invalid and unknown all fail closed
  } catch { return false; }
}

const AF_UNIX = 1;
const SOCK_DGRAM = 2;

/** MUST [UNIT-004]: sd_notify READY=1 over $NOTIFY_SOCKET (AF_UNIX dgram). */
export function sdNotifyReady(notifySocket: string): boolean {
  if (!notifySocket || notifySocket.includes("\0")) return false;
  const path = notifySocket.startsWith("@")
    ? `\0${notifySocket.slice(1)}`
    : notifySocket;
  if (Buffer.byteLength(path) > (notifySocket.startsWith("@") ? 108 : 107)) return false;
  let fd = -1;
  try {
    fd = lib().socket(AF_UNIX, SOCK_DGRAM | 0o2000000 /* SOCK_CLOEXEC */, 0);
    if (fd < 0) return false;
    const addr = Buffer.alloc(110);
    new DataView(addr.buffer, addr.byteOffset, addr.byteLength).setUint16(0, AF_UNIX, NATIVE_LE);
    Buffer.from(path, "utf8").copy(addr, 2);
    const r = lib().connect(fd, addr, 2 + Buffer.byteLength(path, "utf8"));
    if (r < 0) return false;
    const msg = Buffer.from("READY=1");
    const n = lib().send(fd, msg, msg.length, 0);
    return n === msg.length;
  } catch {
    return false;
  } finally {
    if (fd >= 0) closeSync(fd);
  }
}

/** The caller owns the locked descriptor. ProcessLock is the sole lifetime owner;
 * a second open, even in this process, must acquire its own nonblocking lock. */
export function tryFlock(fd: number): boolean {
  const LOCK_EX = 2; const LOCK_NB = 4;
  try { return lib().flock(fd, LOCK_EX | LOCK_NB) === 0; }
  catch { return false; }
}

export function hasNativeLeaf(): boolean {
  try {
    lib();
    return true;
  } catch {
    return false;
  }
}
