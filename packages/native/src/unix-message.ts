/** Linux recvmsg/poll primitives. Framing, sender authorization, flow control
 * and connection lifetime belong to the common TypeScript stream owner. */
import { closeSync } from "node:fs";
import { address, errno, load, type KoffiFunc } from "koffi";
import { getSystemErrorName } from "node:util";
import { cleanupAll } from "./cleanup.js";
import { StoreError } from "@oma/domain/errors";
import type { PeerCred } from "./linux.js";

let receive: ((fd: number, message: Buffer, flags: number) => number) | undefined;
let option: ((fd: number, level: number, name: number, value: Buffer, length: number) => number) | undefined;
let poll: KoffiFunc<(fds: Buffer, count: number, timeout: number) => number> | undefined;
function linux(): void {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "credential-bearing Unix messages require the Linux 64-bit backend");
}
function failure(label: string): never {
  const code = getSystemErrorName(-errno()); throw Object.assign(new Error(`${label}: ${code}`), { code });
}
export function enableUnixCredentials(fd: number): void {
  linux(); option ??= load(null).func("int setsockopt(int fd, int level, int name, const void *value, unsigned int length)");
  const value = Buffer.alloc(4); value.writeInt32LE(1);
  if (option(fd, 1, 16 /* SO_PASSCRED */, value, 4) !== 0) failure("SO_PASSCRED");
}
export type UnixMessage = { readonly kind: "again" } | { readonly kind: "end" } | {
  readonly kind: "data"; readonly bytes: Buffer; readonly sender: PeerCred | null; readonly ancillary: boolean;
};
const observedSenders = new WeakSet<object>();
/** A claimed PID or a copied credential object is not a receive observation. */
export function isUnixMessageSender(value: unknown): value is PeerCred {
  return value !== null && typeof value === "object" && observedSenders.has(value);
}
export function receiveUnixMessage(fd: number): UnixMessage {
  linux(); receive ??= load(null).func("long recvmsg(int fd, void *message, int flags)");
  const bytes = Buffer.alloc(65536), control = Buffer.alloc(4096), vector = Buffer.alloc(16), message = Buffer.alloc(56);
  vector.writeBigUInt64LE(address(bytes), 0); vector.writeBigUInt64LE(BigInt(bytes.length), 8);
  message.writeBigUInt64LE(address(vector), 16); message.writeBigUInt64LE(1n, 24);
  message.writeBigUInt64LE(address(control), 32); message.writeBigUInt64LE(BigInt(control.length), 40);
  const count = receive(fd, message, 0x40 /* MSG_DONTWAIT */ | 0x40000000 /* MSG_CMSG_CLOEXEC */);
  if (count < 0) { if ([11, 4].includes(errno())) return { kind: "again" }; failure("recvmsg"); }
  const size = Number(message.readBigUInt64LE(40)), flags = message.readInt32LE(48);
  let sender: PeerCred | null = null, ancillary = false, malformed = size > control.length || (flags & (8 /* CTRUNC */ | 0x20 /* TRUNC */)) !== 0;
  const descriptors: number[] = [];
  for (let offset = 0; offset + 16 <= Math.min(size, control.length);) {
    const length = Number(control.readBigUInt64LE(offset)), level = control.readInt32LE(offset + 8), type = control.readInt32LE(offset + 12);
    if (!Number.isSafeInteger(length) || length < 16 || offset + length > size || offset + length > control.length) { malformed = true; break; }
    const data = control.subarray(offset + 16, offset + length);
    if (level === 1 && type === 2 /* SCM_CREDENTIALS */) {
      if (sender !== null || data.length !== 12) malformed = true;
      else sender = Object.freeze({ pid: data.readInt32LE(0), uid: data.readUInt32LE(4), gid: data.readUInt32LE(8) });
    } else {
      ancillary = true;
      if (level === 1 && (type === 1 /* SCM_RIGHTS */ || type === 4 /* SCM_PIDFD */)) {
        if (data.length % 4 !== 0) malformed = true;
        for (let at = 0; at + 4 <= data.length; at += 4) descriptors.push(data.readInt32LE(at));
      }
    }
    offset += Math.ceil(length / 8) * 8;
  }
  // The kernel closes rights it could not fit in a truncated control buffer.
  // Every delivered descriptor is returned even when another control fails.
  cleanupAll(descriptors.map(value => () => closeSync(value)));
  if (malformed) throw new Error("Unix ancillary observation is incomplete");
  if (count === 0) return { kind: "end" };
  if (count > bytes.length) throw new Error("Unix message exceeds receive storage");
  if (sender !== null) observedSenders.add(sender);
  return { kind: "data", bytes: bytes.subarray(0, count), sender, ancillary };
}
/** One asynchronous native wait can serve all observed connections. The
 * caller owns the snapshot and may never use it to read a recycled owner FD. */
export function pollUnixMessages(descriptors: readonly number[], timeoutMs: number): Promise<readonly number[]> {
  linux(); poll ??= load(null).func("int poll(void *fds, unsigned long count, int timeout)");
  const snapshot = Buffer.alloc(descriptors.length * 8);
  descriptors.forEach((fd, index) => { snapshot.writeInt32LE(fd, index * 8); snapshot.writeInt16LE(1 /* POLLIN */, index * 8 + 4); });
  return new Promise((resolve, reject) => poll!.async(snapshot, descriptors.length, timeoutMs, (error, result) => {
    // errno belongs to the worker thread; do not read the main thread's errno
    // and manufacture a retry/death interpretation for an unanswered poll.
    if (error || result < 0) { reject(error ?? new Error("credential stream poll was not observed")); return; }
    resolve(descriptors.map((_, index) => snapshot.readInt16LE(index * 8 + 6)));
  }));
}
