import { closeSync, constants, fstatSync, openSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tryFlock } from "../leaf.js";
import { StoreError } from "../domain/errors.js";

/** Production acquires this token before configuration, SQLite or recovery.
 * Ownership is transferred, never duplicated, when constructing the Broker.
 */
export class ProcessLock {
  private closed = false;
  private constructor(private readonly fd: number, readonly path: string,
    private readonly dev: bigint, private readonly ino: bigint) {}
  static acquire(path: string): ProcessLock {
    const target = resolve(path);
    const fd = openSync(target, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try {
      if (!tryFlock(fd)) throw new StoreError("BROKER_UNAVAILABLE", "another broker holds the society lock");
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n) throw new StoreError("BROKER_UNAVAILABLE", "process lock is not an exclusively named regular file");
      return new ProcessLock(fd, target, stat.dev, stat.ino);
    } catch (error) { closeSync(fd); throw error; }
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
