import { closeSync, constants, fstatSync, openSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { lockFileDescriptor } from "./linux.js";
import { StoreError } from "@oma/domain/errors";
import { withCleanup } from "./cleanup.js";

/** The exit status a process uses to say "the society already has an owner",
 * as distinct from "I failed to start". They are not interchangeable: the
 * first means another process holds the society and this one must not act as
 * if it owned it, the second says nothing about ownership at all. */
export const SOCIETY_OWNED_EXIT = 6;

/** Production acquires this token before configuration, SQLite or recovery.
 * Ownership is transferred, never duplicated, when constructing the Broker.
 */
export class ProcessLock {
  private closed = false;
  private constructor(private readonly fd: number, readonly path: string,
    private readonly dev: bigint, private readonly ino: bigint) {}
  static acquire(path: string): ProcessLock {
    const held = ProcessLock.tryAcquire(path);
    if (held === null) throw new StoreError("BROKER_UNAVAILABLE", "another broker holds the society lock");
    return held;
  }
  /** The lock, or null when -- and only when -- another process holds it.
   * Every other failure still throws: "someone else owns this" and "this could
   * not be locked at all" are different answers, and a caller that acts on
   * ownership must not read the second as the first. */
  static tryAcquire(path: string): ProcessLock | null {
    const target = resolve(path);
    const fd = openSync(target, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    // P0V-49: given back once, whichever way this ends.
    let held = true;
    try {
      const lock = lockFileDescriptor(fd);
      // Only contention means "another process owns this". A lock that could
      // not be evaluated -- EINTR, ENOLCK, a filesystem with no locking -- is
      // an environment failure, and reporting it as ownership makes the
      // product exit saying the society has another owner when it has none.
      if (lock.kind === "contended") { held = false; closeSync(fd); return null; }
      if (lock.kind === "failed")
        throw new StoreError("BROKER_UNAVAILABLE", `process lock could not be evaluated (errno ${lock.errno})`);
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n) throw new StoreError("BROKER_UNAVAILABLE", "process lock is not an exclusively named regular file");
      return new ProcessLock(fd, target, stat.dev, stat.ino);
    } catch (error) {
      return withCleanup(() => { throw error; }, () => { if (held) closeSync(fd); });
    }
  }
  /** The open descriptor the lock lives on.
   *
   * flock belongs to an open file description, not to a process and not to a
   * pathname, and a descriptor a child inherits refers to the same description
   * -- so the lock is released only when the last of those descriptors closes.
   * Handing this number to a child therefore makes the child's life part of
   * the lock's life, which is the only way a process that cannot run code at
   * its own death (SIGKILL, a power cut) can still keep a promise about what
   * must be dead before the lock passes on.
   */
  get descriptor(): number {
    if (this.closed) throw new StoreError("BROKER_UNAVAILABLE", "process lock is closed");
    return this.fd;
  }
  assertHeld(path: string): void {
    if (this.closed || resolve(path) !== this.path) throw new StoreError("BROKER_UNAVAILABLE", "process lock is closed or belongs to another society");
    const current = statSync(this.path, { bigint: true });
    const pinned = fstatSync(this.fd, { bigint: true });
    if (current.dev !== this.dev || current.ino !== this.ino || pinned.dev !== this.dev || pinned.ino !== this.ino)
      throw new StoreError("BROKER_UNAVAILABLE", "process lock pathname no longer identifies its pinned inode");
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; closeSync(this.fd);
  }
}
