// MUST [S-01]: minimal native leaf for SO_PEERCRED, sd_notify and the
// process-lifetime REC-007 advisory lock through koffi FFI.
import { closeSync, fstatSync, openSync } from "node:fs";
import { load } from "koffi";

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
    if (r !== 0) return null;
    const d = new DataView(optval);
    return {
      pid: d.getInt32(0, true),
      uid: d.getUint32(4, true),
      gid: d.getUint32(8, true),
    };
  } catch {
    return null;
  }
}

const AF_UNIX = 1;
const SOCK_DGRAM = 2;

/** MUST [UNIT-004]: sd_notify READY=1 over $NOTIFY_SOCKET (AF_UNIX dgram). */
export function sdNotifyReady(notifySocket: string): boolean {
  if (!notifySocket) return false;
  const path = notifySocket.startsWith("@")
    ? `\0${notifySocket.slice(1)}`
    : notifySocket;
  try {
    const fd = lib().socket(AF_UNIX, SOCK_DGRAM, 0);
    if (fd < 0) return false;
    const addr = Buffer.alloc(110);
    addr.writeUInt16LE(AF_UNIX, 0);
    Buffer.from(path, "utf8").copy(addr, 2);
    const r = lib().connect(fd, addr, 2 + Buffer.byteLength(path, "utf8"));
    if (r < 0) return false;
    const msg = Buffer.from("READY=1");
    const n = lib().send(fd, msg, msg.length, 0);
    return n === msg.length;
  } catch {
    return false;
  }
}

const heldLocks = new Map<string, number>();

function lockKey(fd: number): string | null {
  try {
    const st = fstatSync(fd, { bigint: true });
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
}

function flockExclusive(fd: number): boolean {
  const LOCK_EX = 2;
  const LOCK_NB = 4;
  try {
    return lib().flock(fd, LOCK_EX | LOCK_NB) === 0;
  } catch {
    return false;
  }
}

/**
 * MUST [REC-007]: acquire the society lock before runtime.sqlite is opened.
 * The owning fd is retained by this module until explicit shutdown/process exit.
 */
export function acquireProcessLock(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, "w", 0o600);
  } catch {
    return false;
  }
  if (!flockExclusive(fd)) {
    closeSync(fd);
    return false;
  }
  const key = lockKey(fd);
  if (!key) {
    closeSync(fd);
    return false;
  }
  const previous = heldLocks.get(key);
  if (previous !== undefined) {
    closeSync(fd);
    return true;
  }
  heldLocks.set(key, fd);
  return true;
}

/**
 * MUST [REC-007]: Broker.start may open the same inode after the entrypoint has
 * already acquired it. Treat that as the same process-lifetime lock; unrelated
 * inodes/processes still go through the real non-blocking flock syscall.
 */
export function tryFlock(fd: number): boolean {
  const key = lockKey(fd);
  if (key && heldLocks.has(key)) return true;
  return flockExclusive(fd);
}

export function releaseProcessLocks(): void {
  for (const fd of heldLocks.values()) {
    try {
      closeSync(fd);
    } catch {
      /* process shutdown */
    }
  }
  heldLocks.clear();
}

export function hasNativeLeaf(): boolean {
  try {
    return peerCred(-1) === null;
  } catch {
    return false;
  }
}
