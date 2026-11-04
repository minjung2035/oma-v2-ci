/** Explicit host reboot recovery of unreadable/missing execution observations.
 * Preparation freezes the bytes and boot identity, then blocks every journal
 * opener/initializer. Only a different kernel boot can retire unknown scopes.
 * Accepted operations, identities, receipts and task state are never touched. */
import { closeSync, constants, fstatSync, fsyncSync, readSync, readFileSync, writeSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { openAt, unlinkAt } from "@oma/file-descriptors";
import { renameAt } from "@oma/native/posix-files";
import { chmodPinned, openRegularBeneath, pinBeneath, reopenPinned } from "@oma/native/files";
import { lockFileDescriptor } from "@oma/native/linux";
import { linuxBootId, linuxHostId } from "@oma/native/pid-namespace";
import { currentDarwinBootId, currentDarwinHostId } from "@oma/native/audit-session";
import { withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { decodeUtf8 } from "@oma/domain/utf8";
import { openOwnedDirectoryPath } from "./directory.js";
import { publishNoReplace, replaceDerivedEntry } from "./durable-fs.js";
import { EXECUTION_RECOVERY_FILE, executionJournalInitial } from "./execution-journal.js";

interface Digest { readonly sha256: string; readonly size: number }
/** v1 retains Linux host/boot meaning. v2 is Darwin gethostuuid/boot-session
 * evidence. Neither OS can consume the other format; no old bytes migrate. */
export interface ExecutionRecoveryTicket { readonly version: 1 | 2; readonly owner: string; readonly bootId: string; readonly hostId: string; readonly original: Digest | null }
const JOURNAL = "scopes.jsonl", BOOT = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === "ENOENT";
function corrupt(): never { throw new StoreError("STORE_CORRUPT", "execution recovery evidence is invalid or changed; retain the journal and its archive"); }
function kernelIdentity(): { readonly version: 1 | 2; readonly bootId: string; readonly hostId: string; readonly name: string } {
  if (process.platform === "linux") return { version: 1, bootId: linuxBootId(), hostId: linuxHostId(), name: "Linux" };
  if (process.platform === "darwin") return { version: 2, bootId: currentDarwinBootId(), hostId: currentDarwinHostId(), name: "Darwin" };
  throw new StoreError("UNSUPPORTED_PROFILE", "execution reboot recovery requires a supported host kernel");
}
function opened(parent: number, name: string, writable = false): number | null {
  let pin: number;
  try { pin = pinBeneath(parent, name); } catch (error) { if (missing(error)) return null; throw error; }
  let result: number | undefined;
  try {
    return withCleanup(() => {
      const stat = fstatSync(pin, { bigint: true }), uid = process.getuid?.();
      if (!stat.isFile() || stat.nlink !== 1n || uid === undefined || stat.uid !== BigInt(uid)) corrupt();
      if (writable) chmodPinned(pin, Number(stat.mode & 0o7777n) | 0o600);
      // Darwin's descriptor filesystem cannot upgrade an event-only pin to
      // writable I/O. Acquire the requested regular-file capability beneath
      // the held parent, then demand the pinned inode before reading/writing.
      result = process.platform === "darwin" ? openRegularBeneath(parent, name, { writable }) :
        reopenPinned(pin, (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NONBLOCK);
      const observed = fstatSync(result, { bigint: true });
      if (observed.dev !== stat.dev || observed.ino !== stat.ino || observed.nlink !== 1n || observed.uid !== stat.uid) corrupt();
      return result;
    }, () => closeSync(pin));
  } catch (error) { return withCleanup(() => { throw error; }, () => { if (result !== undefined) closeSync(result); }); }
}
function digest(fd: number, copy?: number): Digest {
  const before = fstatSync(fd), hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024);
  let size = 0;
  for (;;) {
    const count = readSync(fd, chunk, 0, chunk.length, size); if (count === 0) break;
    hash.update(chunk.subarray(0, count));
    if (copy !== undefined) for (let at = 0; at < count;) {
      const written = writeSync(copy, chunk, at, count - at);
      if (written <= 0) throw new StoreError("BROKER_UNAVAILABLE", "execution recovery copy made no progress");
      at += written;
    }
    size += count;
  }
  const after = fstatSync(fd);
  if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) corrupt();
  return { sha256: hash.digest("hex"), size };
}
function same(left: Digest | null, right: Digest | null): boolean { return left === null ? right === null : right !== null && left.sha256 === right.sha256 && left.size === right.size; }
function ticket(parent: number, owner: string, hostId: string, version: 1 | 2): ExecutionRecoveryTicket | null {
  const fd = opened(parent, EXECUTION_RECOVERY_FILE); if (fd === null) return null;
  return withCleanup(() => {
    if (fstatSync(fd).size > 4096) corrupt();
    const bytes = readFileSync(fd); if (bytes.length > 4096) corrupt();
    let raw: unknown; try { raw = JSON.parse(decodeUtf8(bytes)); } catch { return corrupt(); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return corrupt();
    // SAFETY: closed key sets, root binding, boot identity and the complete digest are checked before use.
    const value = raw as ExecutionRecoveryTicket;
    if (Object.keys(raw).sort().join() !== "bootId,hostId,original,owner,version" || value.version !== version || value.owner !== owner || value.hostId !== hostId || typeof value.bootId !== "string" || !BOOT.test(value.bootId)) corrupt();
    const old = value.original;
    if (old !== null && (!old || Object.keys(old).sort().join() !== "sha256,size" || typeof old.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(old.sha256) || !Number.isSafeInteger(old.size) || old.size < 0)) corrupt();
    return value;
  }, () => closeSync(fd));
}
function archiveName(old: Digest): string { return `scopes.before-recovery-${old.sha256}.jsonl`; }
function verifyArchive(parent: number, old: Digest): void {
  const fd = opened(parent, archiveName(old)); if (fd === null) corrupt();
  withCleanup(() => { if (!same(digest(fd), old)) corrupt(); fsyncSync(fd); }, () => closeSync(fd));
}
function archive(parent: number, fd: number, old: Digest): void {
  const name = archiveName(old), existing = opened(parent, name);
  if (existing !== null) {
    withCleanup(() => { if (!same(digest(existing), old)) corrupt(); fsyncSync(existing); fsyncSync(parent); }, () => closeSync(existing));
    return;
  }
  const temporary = `.execution-recovery-${randomUUID()}.tmp`;
  const copy = openAt(parent, temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  // Both host locks and the journal lock exclude another compatible publisher.
  // Rename keeps the published archive single-linked even if the process dies;
  // link+unlink would strand a second name and make every later adoption refuse.
  withCleanup(() => {
    if (!same(digest(fd, copy), old)) corrupt(); fsyncSync(copy);
    renameAt(parent, temporary, parent, name); fsyncSync(parent);
  }, () => {
    try { closeSync(copy); } finally {
      try { unlinkAt(parent, temporary); } catch (error) { if (!missing(error)) throw error; }
      fsyncSync(parent);
    }
  });
  verifyArchive(parent, old); fsyncSync(parent);
}
/** Caller holds BOTH the Society lease and broker lock. Missing journals are never created here. */
function owned<T>(stateRoot: string, use: (parent: number, journal: number | null, owner: string) => T): T {
  const owner = resolve(stateRoot), parent = openOwnedDirectoryPath(join(owner, "execution"));
  let journal: number | null = null;
  return withCleanup(() => {
    journal = opened(parent, JOURNAL, true);
    if (journal !== null) {
      const lock = lockFileDescriptor(journal);
      // Only contention proves another owner. A lock that could not be
      // evaluated (EINTR, ENOLCK, a filesystem with no locking) is an
      // environment failure: recovery still refuses -- fail-closed -- but
      // reporting it as a live owner would assert an owner that may not
      // exist, and the operator must be told which happened.
      if (lock.kind === "contended")
        throw new StoreError("BROKER_UNAVAILABLE", "execution journal has a live owner", { details: { reason: "busy" } });
      if (lock.kind === "failed")
        throw new StoreError("BROKER_UNAVAILABLE", `execution journal lock could not be evaluated (errno ${lock.errno})`);
    }
    return use(parent, journal, owner);
  }, () => { try { if (journal !== null) closeSync(journal); } finally { closeSync(parent); } });
}
export function prepareExecutionRecovery(stateRoot: string): ExecutionRecoveryTicket {
  const { bootId, hostId, version } = kernelIdentity();
  return owned(stateRoot, (parent, journal, owner) => {
    const original = journal === null ? null : digest(journal), existing = ticket(parent, owner, hostId, version);
    if (existing) { if (!same(original, existing.original)) corrupt(); if (original) verifyArchive(parent, original); return existing; }
    if (original) { archive(parent, journal!, original); fsyncSync(journal!); }
    const value: ExecutionRecoveryTicket = { version, owner, bootId, hostId, original };
    publishNoReplace(join(owner, "execution", EXECUTION_RECOVERY_FILE), JSON.stringify(value) + "\n", 0o600);
    const observed = ticket(parent, owner, hostId, version); if (!observed || observed.bootId !== bootId || !same(observed.original, original)) corrupt();
    fsyncSync(parent); return observed;
  });
}
export function applyExecutionRecovery(stateRoot: string): { readonly archive: string | null } {
  const { bootId, hostId, version, name } = kernelIdentity();
  return owned(stateRoot, (parent, journal, owner) => {
    const pending = ticket(parent, owner, hostId, version);
    if (!pending) throw new StoreError("INVALID_REQUEST", "prepare execution recovery before rebooting this host");
    if (pending.bootId === bootId) throw new StoreError("RUN_TERMINATION_UNKNOWN", `execution recovery requires a different ${name} kernel boot; no scope death is proved yet`);
    if (pending.original) verifyArchive(parent, pending.original);
    const current = journal === null ? null : digest(journal), initial = executionJournalInitial(owner);
    const reset = { sha256: createHash("sha256").update(initial).digest("hex"), size: Buffer.byteLength(initial) };
    // A crash after reset but before ticket removal resumes only that exact
    // initial frame. The ticket has prevented any new scope from starting.
    if (!same(current, pending.original) && !same(current, reset)) corrupt();
    replaceDerivedEntry(parent, JOURNAL, join(owner, "execution", JOURNAL), initial);
    unlinkAt(parent, EXECUTION_RECOVERY_FILE); fsyncSync(parent);
    return { archive: pending.original ? join(owner, "execution", archiveName(pending.original)) : null };
  });
}
