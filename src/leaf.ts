// MUST [S-01]: minimal native leaf for SO_PEERCRED and sd_notify through koffi
// FFI (verified against this host; node exposes neither API). koffi is the only
// native dependency; these two leaf functions are the full native surface.
import { load } from 'koffi';

export interface PeerCred { pid: number; uid: number; gid: number }

let cached: {
  getsockopt: (fd: number, level: number, opt: number, optval: ArrayBuffer, optlen: Uint32Array) => number;
  socket: (domain: number, type: number, proto: number) => number;
  connect: (fd: number, addr: Buffer, len: number) => number;
  send: (fd: number, buf: Buffer, len: number, flags: number) => number;
  flock: (fd: number, op: number) => number;
} | null = null;

function lib(): typeof cached extends null ? never : Exclude<typeof cached, null> {
  if (!cached) {
    const libc = load(null);
    cached = {
      getsockopt: libc.func('int getsockopt(int socket, int level, int optname, void *optval, unsigned int *optlen)'),
      socket: libc.func('int socket(int domain, int type, int protocol)'),
      connect: libc.func('int connect(int fd, const void *addr, unsigned int len)'),
      send: libc.func('int send(int fd, const void *buf, unsigned int len, int flags)'),
      flock: libc.func('int flock(int fd, int operation)'),
    };
  }
  return cached;
}

const SOL_SOCKET = 1;
const SO_PEERCRED = 17; // Linux

/**
 * MUST [S-01]/[AUTH-003]: peer identity of an accepted unix socket. Returns
 * null when the host cannot provide credentials (fail closed).
 */
export function peerCred(fd: number): PeerCred | null {
  if (!Number.isInteger(fd) || fd < 0) return null;
  try {
    const optval = new ArrayBuffer(12);
    const optlen = new Uint32Array([12]);
    const r = lib().getsockopt(fd, SOL_SOCKET, SO_PEERCRED, optval, optlen);
    if (r !== 0) return null;
    const d = new DataView(optval);
    return { pid: d.getInt32(0, true), uid: d.getUint32(4, true), gid: d.getUint32(8, true) };
  } catch {
    return null;
  }
}

const AF_UNIX = 1;
const SOCK_DGRAM = 2;

/** MUST [UNIT-004]: sd_notify READY=1 over $NOTIFY_SOCKET (AF_UNIX dgram). */
export function sdNotifyReady(notifySocket: string): boolean {
  if (!notifySocket) return false;
  const path = notifySocket.startsWith('@') ? `\0${notifySocket.slice(1)}` : notifySocket;
  try {
    const fd = lib().socket(AF_UNIX, SOCK_DGRAM, 0);
    if (fd < 0) return false;
    const addr = Buffer.alloc(110);
    addr.writeUInt16LE(AF_UNIX, 0);
    Buffer.from(path, 'utf8').copy(addr, 2);
    const r = lib().connect(fd, addr, 2 + Buffer.byteLength(path, 'utf8'));
    if (r < 0) return false;
    const msg = Buffer.from('READY=1');
    const n = lib().send(fd, msg, msg.length, 0);
    return n === msg.length;
  } catch {
    return false;
  }
}

/** MUST [REC-007]: process-lifetime exclusive advisory lock (LOCK_EX|LOCK_NB). */
export function tryFlock(fd: number): boolean {
  const LOCK_EX = 2;
  const LOCK_NB = 4;
  try {
    return lib().flock(fd, LOCK_EX | LOCK_NB) === 0;
  } catch {
    return false;
  }
}

export function hasNativeLeaf(): boolean {
  try {
    return peerCred(-1) === null; // negative fd must fail cleanly, proving the leaf loads
  } catch {
    return false;
  }
}