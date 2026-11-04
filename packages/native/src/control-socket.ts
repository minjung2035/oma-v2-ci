/** POSIX descriptor mechanics only. The spawning owner, never SO_PEERCRED
 * on a socketpair, decides which directly launched child owns its other end. */
import { closeSync } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { cleanupAll, withCleanup } from "./cleanup.js";
import { StoreError } from "@oma/domain/errors";

let pair: ((domain: number, type: number, protocol: number, fds: Buffer) => number) | undefined;
let control: ((fd: number, command: number, ...args: unknown[]) => number) | undefined;
let pipe: ((fds: Buffer, flags?: number) => number) | undefined;
function posix(): void {
  if (!["linux", "darwin"].includes(process.platform))
    throw new StoreError("UNSUPPORTED_PROFILE", "inherited control sockets require a POSIX backend");
}
function failed(): never {
  const code = getSystemErrorName(-errno());
  throw Object.assign(new Error(`control socket operation failed: ${code}`), { code });
}
function setCloseOnExec(fd: number, enabled: boolean): void {
  posix();
  if (!Number.isSafeInteger(fd) || fd < 0 || fd > 0x7fffffff) throw new TypeError("invalid control descriptor");
  control ??= load(null).func("int fcntl(int fd, int command, ...)");
  const flags = control(fd, 1 /* F_GETFD */);
  if (flags < 0 || control(fd, 2 /* F_SETFD */, "int", enabled ? flags | 1 : flags & ~1 /* FD_CLOEXEC */) < 0) failed();
}
export function closeOnExec(fd: number): void { setCloseOnExec(fd, true); }
/** Only an explicitly transferred cooperation descriptor may cross the next
 * exec. Other private channels retain their own close-on-exec flags. */
export function inheritOnExec(fd: number): void { setCloseOnExec(fd, false); }
export function controlSocketPair(): { readonly parent: number; readonly child: number } {
  posix(); pair ??= load(null).func("int socketpair(int domain, int type, int protocol, void *fds)");
  const descriptors = Buffer.alloc(8);
  if (pair(1 /* AF_UNIX */, process.platform === "linux" ? 0x80001 /* SOCK_STREAM|SOCK_CLOEXEC */ : 1, 0, descriptors) !== 0) failed();
  const parent = descriptors.readInt32LE(0), child = descriptors.readInt32LE(4);
  try { closeOnExec(parent); closeOnExec(child); return Object.freeze({ parent, child }); }
  catch (error) { return withCleanup(() => { throw error; }, () => cleanupAll([() => closeSync(parent), () => closeSync(child)])); }
}
export function controlPipe(): { readonly read: number; readonly write: number } {
  posix();
  pipe ??= process.platform === "linux" ? load(null).func("int pipe2(void *fds, int flags)") : load(null).func("int pipe(void *fds)");
  const descriptors = Buffer.alloc(8);
  if ((process.platform === "linux" ? pipe(descriptors, 0o2000000) : pipe(descriptors)) !== 0) failed();
  const read = descriptors.readInt32LE(0), write = descriptors.readInt32LE(4);
  try { closeOnExec(read); closeOnExec(write); return Object.freeze({ read, write }); }
  catch (error) { return withCleanup(() => { throw error; }, () => cleanupAll([() => closeSync(read), () => closeSync(write)])); }
}

/** A trusted pipeline supervisor retains a private status descriptor while
 * children run. Same-uid descendants must not open its /proc FDs or memory. */
export function protectPipelineSupervisor(): void {
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "pipeline supervisor protection requires Linux");
  const prctl = load(null).func("int prctl(int option, unsigned long a2, unsigned long a3, unsigned long a4, unsigned long a5)");
  if (prctl(4 /* PR_SET_DUMPABLE */, 0, 0, 0, 0) !== 0 || prctl(3 /* PR_GET_DUMPABLE */, 0, 0, 0, 0) !== 0) failed();
}
