/** Physical mailbox capability. Mail owns the decisions made through it. */
import { closeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Actor, MessageId, MessagePlan } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { mailInboxArrivalPathAt, mailInboxPathAt, mailObjectPathAt } from "@oma/domain/paths";
import { closeEvery } from "@oma/native/files";
import { mkdirAt, renameAt, unlinkAt } from "@oma/native/posix-files";
import { openOwnedDirectory, openOwnedDirectoryPath } from "./directory.js";
import { ensureOwnedDurableDirectory, fsyncHeldDir } from "./durable-fs.js";
import type { ImmutableObservation } from "@oma/contracts/files";
import { observeImmutableEntry, publishImmutableEntry } from "./immutable-file.js";
import { appendMailArrival } from "./arrival-journal.js";

type MessageBytes = Pick<MessagePlan, "id" | "sha256" | "bytes">;
export class HeldMailInbox {
  private inbox: number | undefined;
  private fresh: number | undefined;
  private current: number | undefined;
  private readonly directoryPath: string;
  constructor(private readonly stateRoot: string, private readonly actor: Actor) {
    this.directoryPath = dirname(mailInboxArrivalPathAt(stateRoot, actor));
    ensureOwnedDurableDirectory(this.directoryPath, stateRoot, 0o755);
    try {
      this.inbox = openOwnedDirectoryPath(this.directoryPath);
      this.fresh = this.child("new");
      this.current = this.child("cur");
    } catch (error) {
      try { this.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "mailbox acquisition and cleanup failed"); }
      throw error;
    }
  }
  private child(name: "new" | "cur"): number {
    if (this.inbox === undefined) throw new StoreError("INTERNAL_ERROR", "mailbox has no held parent");
    try { mkdirAt(this.inbox, name, 0o755); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const directory = openOwnedDirectory(this.inbox, name);
    try { fsyncHeldDir(this.inbox, this.directoryPath); return directory; }
    catch (error) { try { closeSync(directory); } catch (cleanup) { throw new AggregateError([error, cleanup], "mailbox directory flush and cleanup failed"); } throw error; }
  }
  private directory(folder: "new" | "cur"): number {
    const descriptor = folder === "new" ? this.fresh : this.current;
    if (descriptor === undefined || this.inbox === undefined) throw new StoreError("INTERNAL_ERROR", "mailbox capability is closed");
    return descriptor;
  }
  private path(folder: "new" | "cur", id: MessageId): string { return mailInboxPathAt(this.stateRoot, this.actor, id, folder); }
  observeInboxMessage(folder: "new" | "cur", message: MessageBytes): ImmutableObservation {
    return observeImmutableEntry(this.directory(folder), basename(this.path(folder, message.id)), message.sha256, message.bytes);
  }
  publishInboxMessage(folder: "new" | "cur", message: MessageBytes): void {
    const path = this.path(folder, message.id);
    publishImmutableEntry(mailObjectPathAt(this.stateRoot, message.id), this.directory(folder), basename(path), path, message.sha256);
  }
  moveNewToCur(id: MessageId): void {
    renameAt(this.directory("new"), basename(this.path("new", id)), this.directory("cur"), basename(this.path("cur", id)));
  }
  removeNew(id: MessageId): void { unlinkAt(this.directory("new"), basename(this.path("new", id))); }
  flushNew(): void { fsyncHeldDir(this.directory("new"), join(this.directoryPath, "new")); }
  flushCur(): void { fsyncHeldDir(this.directory("cur"), join(this.directoryPath, "cur")); }
  appendMailArrival(id: MessageId): void {
    const directory = this.inbox;
    if (directory === undefined) throw new StoreError("INTERNAL_ERROR", "mailbox capability is closed");
    appendMailArrival(directory, this.directoryPath, id);
  }
  close(): void {
    const inbox = this.inbox, fresh = this.fresh, current = this.current;
    this.inbox = this.fresh = this.current = undefined;
    closeEvery(current, fresh, inbox);
  }
}
