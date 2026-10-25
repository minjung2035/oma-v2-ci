// MUST [S-01]: minimal native leaf for SO_PEERCRED and the
// REC-007 society lease through koffi FFI.
import { closeSync, openSync, readlinkSync } from "node:fs";
import { errno, load } from "koffi";
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
  flock: (fd: number, op: number) => number;
  poll: (fds: ArrayBuffer, count: number, timeout: number) => number;
  bind: (fd: number, addr: Buffer, len: number) => number;
  listen: (fd: number, backlog: number) => number;
  getsockname: (fd: number, addr: ArrayBuffer, len: Uint32Array) => number;
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
      flock: libc.func("int flock(int fd, int operation)"),
      poll: libc.func("int poll(void *fds, unsigned long nfds, int timeout)"),
      bind: libc.func("int bind(int fd, const void *addr, unsigned int len)"),
      listen: libc.func("int listen(int fd, int backlog)"),
      getsockname: libc.func("int getsockname(int fd, void *addr, unsigned int *len)"),
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

/** Whether the process a pidfd pins is running has three answers, not two
 * (INV02): running, exited, or not answered. `poll` with a zero timeout never
 * waits, but it does not answer when a signal is pending -- EINTR -- and the
 * broker, which starts and reaps children all the time, often has one. Read
 * as "exited", that took a live actor's authority away for an instant: its
 * request was refused as CAPABILITY_DENIED, never to be retried. An
 * interrupted poll is asked again, a bounded number of times (INV10); an
 * invalid descriptor (POLLNVAL) or any other failure is "failed", which no
 * caller reads as the process having exited. The same vocabulary as
 * `lockFileDescriptor` and `holdAbstractName`: the missing answer is kept. */
export type PidLiveness =
  | { readonly kind: "running" }
  | { readonly kind: "exited" }
  | { readonly kind: "failed"; readonly errno: number };

/** One `poll` of one descriptor: its return value, errno when it failed, and
 * the returned events when it answered. */
export interface PollAnswer { readonly result: number; readonly errno: number; readonly revents: number }

const EINTR = 4;
const EBADF = 9;
const POLLIN = 0x1;
const POLLHUP = 0x10;
const POLLNVAL = 0x20;
/** Interrupted polls asked again before the answer is "failed". */
export const PIDFD_POLL_ATTEMPTS = 8;

/** The classification of `poll`'s answers for a pidfd, apart from the call so
 * that each answer the kernel can give is exercised by its regression. */
export function livenessFromPoll(ask: () => PollAnswer): PidLiveness {
  for (let attempt = 0; attempt < PIDFD_POLL_ATTEMPTS; attempt++) {
    const answer = ask();
    if (answer.result === 0) return { kind: "running" };
    if (answer.result > 0) {
      if ((answer.revents & POLLNVAL) !== 0) return { kind: "failed", errno: EBADF };
      return (answer.revents & (POLLIN | POLLHUP)) !== 0 ? { kind: "exited" } : { kind: "failed", errno: 0 };
    }
    if (answer.errno !== EINTR) return { kind: "failed", errno: answer.errno };
  }
  return { kind: "failed", errno: EINTR };
}

/** Only accepts an owned peerPidFd result; no blocking waits or /proc PID lookups.
 *
 * P0V-117 (G07-01), P0-5: that is checked, each time, not assumed. A
 * descriptor that is not a pidfd -- a number passed by mistake, or reused
 * after the pidfd was closed -- polls readable at end of file exactly as an
 * exited process does; asked here, it is no answer (`failed`), never
 * `exited`. The descriptor's own link names what it is. */
export function pidfdLiveness(fd: number): PidLiveness {
  if (!Number.isInteger(fd) || fd < 0) return { kind: "failed", errno: EBADF };
  let target: string;
  try { target = readlinkSync(`/proc/self/fd/${fd}`); }
  catch (error) { return { kind: "failed", errno: (error as NodeJS.ErrnoException).code === "ENOENT" ? EBADF : 0 }; }
  if (target !== "anon_inode:[pidfd]") return { kind: "failed", errno: EBADF };
  try {
    const native = lib();
    return livenessFromPoll(() => {
      const buffer = new ArrayBuffer(8); // struct pollfd: int fd, short events, short revents
      const pollfd = new DataView(buffer);
      pollfd.setInt32(0, fd, NATIVE_LE);
      pollfd.setInt16(4, POLLIN, NATIVE_LE);
      const result = native.poll(buffer, 1, 0);
      return { result, errno: result < 0 ? errno() : 0, revents: result > 0 ? pollfd.getUint16(6, NATIVE_LE) : 0 };
    });
  } catch { return { kind: "failed", errno: 0 }; }
}

const AF_UNIX = 1;

/** Taking a lock has three answers, not two, and the missing one is the
 * dangerous one: this process has it, another process has it, or this process
 * could not find out. `flock` says "another process has it" with EWOULDBLOCK
 * and nothing else; EINTR, ENOLCK and a filesystem that cannot lock at all are
 * failures of the attempt. A caller that reads them as ownership refuses to
 * start, and says the society is owned, for a reason that has nothing to do
 * with who owns the society.
 *
 * This is the same vocabulary `holdAbstractName` answers in, deliberately:
 * both are "take the society's singleton", and a product with two vocabularies
 * for one question ends up with the weaker one at the call site that matters.
 *
 * The caller owns the locked descriptor. ProcessLock is the sole lifetime
 * owner; a second open, even in this process, must acquire its own lock. */
export type FileLock =
  | { readonly kind: "held" }
  | { readonly kind: "contended" }
  | { readonly kind: "failed"; readonly errno: number };

/** EAGAIN and EWOULDBLOCK are one value on each platform the product locks
 * on: 11 on Linux, 35 on macOS (the host service's lock, P0V-105). */
const EWOULDBLOCK = process.platform === "darwin" ? 35 : 11;

export function lockFileDescriptor(fd: number, shared = false): FileLock {
  const LOCK_SH = 1; const LOCK_EX = 2; const LOCK_NB = 4;
  try {
    if (lib().flock(fd, (shared ? LOCK_SH : LOCK_EX) | LOCK_NB) === 0) return { kind: "held" };
    const code = errno();
    return code === EWOULDBLOCK ? { kind: "contended" } : { kind: "failed", errno: code };
  } catch { return { kind: "failed", errno: 0 }; }
}

const SOCK_STREAM = 1;
const SOCK_CLOEXEC = 0o2000000;
const SOCK_NONBLOCK = 0o4000;
const EADDRINUSE = 98;
const ECONNREFUSED = 111;
const ENOENT = 2;

/** An attempt to take a name in the abstract AF_UNIX namespace. "Taken" and
 * "failed" are different answers and must not be collapsed: the first says
 * another process holds the name, the second says this process could not find
 * out anything at all. */
export type AbstractHold =
  | { readonly kind: "held"; readonly fd: number }
  | { readonly kind: "taken" }
  | { readonly kind: "failed"; readonly errno: number };

/** Who holds an abstract name, as far as this process can tell. */
export type AbstractHolder =
  | { readonly kind: "none" }
  | { readonly kind: "peer"; readonly cred: PeerCred }
  | { readonly kind: "unknown" };

/** A `struct sockaddr_un` for a name in the abstract namespace: a leading NUL
 * and then the name, with the length passed exactly, since trailing NULs in
 * `sun_path` would otherwise become part of the name. */
function abstractAddress(name: string): { addr: Buffer; length: number } | null {
  if (!name.startsWith("\0") || name.length < 2) return null;
  const bytes = Buffer.byteLength(name, "utf8");
  if (bytes > 108) return null;
  const addr = Buffer.alloc(110);
  new DataView(addr.buffer, addr.byteOffset, addr.byteLength).setUint16(0, AF_UNIX, NATIVE_LE);
  Buffer.from(name, "utf8").copy(addr, 2);
  return { addr, length: 2 + bytes };
}

function drop(fd: number): void {
  try { closeSync(fd); } catch { /* the descriptor is going away either way */ }
}

/** MUST [REC-007]: takes a name in the abstract AF_UNIX namespace, held for
 * exactly as long as an open file description on the returned descriptor
 * exists -- this process's, and every descriptor a child inherited from it.
 *
 * Why the society's own lock is named here and not by a pathname: a lock named
 * by a pathname is only as exclusive as that pathname, and a process of the
 * same user can unlink or rename it and create a new file in its place. The
 * old holders keep the old inode's lock and a newcomer takes the new inode's,
 * so one society has two owners and neither can tell. An abstract name has no
 * directory entry, so there is nothing to unlink, rename, or point elsewhere
 * with a symlink; the kernel refuses a second bind with EADDRINUSE while the
 * socket lives, and frees the name when its last descriptor closes -- whether
 * the holder released it, crashed, or was killed outright. File modes could
 * never have carried this: FS-005 says a boundary cannot be claimed from a
 * mode at the same UID. */
export function holdAbstractName(name: string): AbstractHold {
  const address = abstractAddress(name);
  if (address === null) return { kind: "failed", errno: 0 };
  let fd = -1;
  try {
    const native = lib();
    fd = native.socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return { kind: "failed", errno: errno() };
    if (native.bind(fd, address.addr, address.length) !== 0) {
      const code = errno();
      drop(fd); fd = -1;
      return code === EADDRINUSE ? { kind: "taken" } : { kind: "failed", errno: code };
    }
    // Listening is not about accepting connections; nothing is ever accepted
    // here. It is what lets the next process ask who holds the name instead of
    // guessing from a refusal.
    if (native.listen(fd, 64) !== 0) {
      const code = errno();
      drop(fd); fd = -1;
      return { kind: "failed", errno: code };
    }
    const held = fd;
    fd = -1;
    return { kind: "held", fd: held };
  } catch {
    if (fd >= 0) drop(fd);
    return { kind: "failed", errno: 0 };
  }
}

/** Asks who holds an abstract name by connecting to it and reading the
 * listener's credentials. The probe socket is non-blocking, so a holder whose
 * backlog is full answers "somebody, cannot say who" rather than blocking this
 * process; only a refusal or a missing name is read as nobody. */
export function abstractNameHolder(name: string): AbstractHolder {
  const address = abstractAddress(name);
  if (address === null) return { kind: "unknown" };
  let fd = -1;
  try {
    const native = lib();
    fd = native.socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
    if (fd < 0) return { kind: "unknown" };
    if (native.connect(fd, address.addr, address.length) !== 0) {
      const code = errno();
      return code === ECONNREFUSED || code === ENOENT ? { kind: "none" } : { kind: "unknown" };
    }
    const cred = peerCred(fd);
    return cred === null ? { kind: "unknown" } : { kind: "peer", cred };
  } catch {
    return { kind: "unknown" };
  } finally {
    if (fd >= 0) drop(fd);
  }
}

/** Which abstract name a descriptor holds, asked of the kernel rather than
 * inferred from the descriptor's shape.
 *
 * `holdAbstractName` produces exactly one shape: a socket bound to an abstract
 * name and listening on it. "Is it a socket" is therefore not a weaker version
 * of this question, it is a different question with a different answer -- any
 * socketpair passes it -- and the difference is the whole of the evidence. The
 * kernel refuses a second bind to a live name, so a descriptor that answers
 * with a name IS the holder of that name; nothing else about the process that
 * presents it has to be trusted.
 */
export type AbstractBinding =
  | { readonly kind: "holding"; readonly name: string }
  | { readonly kind: "other"; readonly why: string }
  | { readonly kind: "unreadable"; readonly errno: number };

const SO_ACCEPTCONN = 30; // Linux
const ENOTSOCK = 88; // Linux

export function abstractNameHeld(fd: number): AbstractBinding {
  if (!Number.isInteger(fd) || fd < 0) return { kind: "unreadable", errno: 0 };
  try {
    const native = lib();
    const addr = new ArrayBuffer(110);
    const length = new Uint32Array([110]);
    if (native.getsockname(fd, addr, length) !== 0) {
      const code = errno();
      // ENOTSOCK is an answer, not a failure to obtain one: this descriptor is
      // definitely not a lease. Reporting it as "could not be established"
      // would put a regular file in the same class as a descriptor the kernel
      // could not be asked about, and a caller that must distinguish "not the
      // lease" from "unknown" would be told the wrong one of the two.
      return code === ENOTSOCK
        ? { kind: "other", why: "descriptor is not a socket" }
        : { kind: "unreadable", errno: code };
    }
    const size = length[0] ?? 0;
    if (size < 2 || size > 110) return { kind: "unreadable", errno: 0 };
    if (new DataView(addr).getUint16(0, NATIVE_LE) !== AF_UNIX)
      return { kind: "other", why: "descriptor is not a unix socket" };
    // A socketpair, and any socket that only ever connected, is bound to no
    // name: the kernel answers with the family and nothing after it.
    if (size <= 2) return { kind: "other", why: "socket holds no name" };
    const bytes = new Uint8Array(addr);
    if (bytes[2] !== 0)
      return { kind: "other", why: "socket is bound to a pathname, which any process of this user can replace" };
    const accepting = new ArrayBuffer(4);
    const acceptingLength = new Uint32Array([4]);
    if (native.getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, accepting, acceptingLength) !== 0)
      return { kind: "unreadable", errno: errno() };
    if (new DataView(accepting).getInt32(0, NATIVE_LE) !== 1)
      return { kind: "other", why: "socket is bound but not listening, so nothing can ask who holds it" };
    return { kind: "holding", name: Buffer.from(bytes.subarray(2, size)).toString("utf8") };
  } catch { return { kind: "unreadable", errno: 0 }; }
}

/** Node publishes no accessor for an accepted socket's file descriptor, and
 * SO_PEERCRED needs one. That dependency on a runtime internal is named here,
 * beside the other primitives this process cannot get from public API, so a
 * Node release that removes `_handle` fails in one place with one message
 * instead of surfacing as an authentication failure somewhere else. */
export function socketDescriptor(socket: unknown): number | null {
  if (socket === null || typeof socket !== "object") return null;
  const handle = (socket as { _handle?: { fd?: unknown } })._handle;
  if (handle === null || typeof handle !== "object") return null;
  const fd = (handle as { fd?: unknown }).fd;
  return typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : null;
}

export function hasNativeLeaf(): boolean {
  try {
    lib();
    return true;
  } catch {
    return false;
  }
}
