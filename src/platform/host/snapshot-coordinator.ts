import type { SnapshotResult } from "../../protocol/host-api.js";
/** One state-disk owner for snapshots and engine start/stop. A clone's
 * quiescent interval cannot overlap another clone or a new engine boot. */
import { dirname } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { ensureHostOwnedDirectory, listHostStaged } from "./files.js";
import type { GuestLink } from "./guest-link.js";
import type { VmLifecycle } from "./lifecycle.js";
import { readHostRecord } from "./record.js";
import { openSnapshotStore, pruneSnapshots, snapshotIdOf, snapshotRunning, snapshotStopped, type SnapshotStore } from "./snapshot.js";

export interface SnapshotCoordinatorOptions {
  readonly lifecycle: VmLifecycle;
  readonly link: GuestLink;
  readonly recordPath: string;
  readonly imageVersion: string;
  readonly dir?: string;
  readonly statePath?: string;
  readonly clone?: SnapshotStore["clone"];
}

export class SnapshotCoordinator {
  private readonly store: SnapshotStore | null;
  private tail: Promise<unknown> = Promise.resolve();
  private ending = false;
  constructor(private readonly options: SnapshotCoordinatorOptions) {
    if (options.dir === undefined || options.statePath === undefined) { this.store = null; return; }
    ensureHostOwnedDirectory(options.dir, dirname(options.dir));
    openSnapshotStore(options.dir);
    this.store = { dir: options.dir, statePath: options.statePath,
      ...(options.clone === undefined ? {} : { clone: options.clone }) };
  }

  private operation<T>(work: () => Promise<T>, shutdown = false): Promise<T> {
    const next = this.tail.catch(() => undefined).then(() => {
      if (this.ending && !shutdown) throw new StoreError("BROKER_UNAVAILABLE", "the host service is ending");
      return work();
    });
    this.tail = next;
    return next;
  }

  start(): Promise<void> {
    return this.operation(async () => { await this.updateSnapshot(); await this.options.lifecycle.start(); });
  }
  stop(): Promise<"stopped" | "forced"> { return this.operation(() => this.options.lifecycle.stop()); }
  shutdown(): Promise<"stopped" | "forced"> {
    this.ending = true;
    return this.operation(() => this.options.lifecycle.stop(), true);
  }

  snapshot({ id }: { id?: string }): Promise<SnapshotResult> {
    return this.operation(async () => {
      const store = this.store;
      if (store === null) throw new StoreError("UNSUPPORTED_PROFILE", "this OMA keeps no snapshots");
      const named = id ?? "manual";
      if (named.startsWith("update-"))
        throw new StoreError("INVALID_REQUEST", "snapshot ids beginning update- are reserved for the service's own pre-update snapshots");
      const state = this.options.lifecycle.state;
      if (state !== "stopped" && state !== "ready")
        throw new StoreError("BROKER_UNAVAILABLE", "the engine is not at a point a backup can be made");
      const made = state === "stopped"
        ? { path: await this.backup(() => snapshotStopped(store, named)), stopped: [] as string[] }
        : await this.backup(() => snapshotRunning(store, this.options.link, named));
      this.prune();
      return { path: made.path, stopped: made.stopped };
    });
  }

  private async updateSnapshot(): Promise<void> {
    const store = this.store;
    if (store === null || this.options.lifecycle.state !== "stopped") return;
    const current = readHostRecord(this.options.recordPath);
    if (current === null) throw new StoreError("STORE_CORRUPT", "the host record is missing");
    if (current.image.current === null || current.image.current === this.options.imageVersion) return;
    const id = `update-${this.options.imageVersion}`;
    if (this.names().some(name => snapshotIdOf(name) === id)) return;
    await this.backup(() => snapshotStopped(store, id));
    this.prune();
  }

  private prune(): void {
    if (this.store === null) return;
    const id = `update-${this.options.imageVersion}`;
    const protectedNames = new Set(this.names().filter(name => snapshotIdOf(name) === id));
    pruneSnapshots(this.store.dir, 3, protectedNames);
  }

  private names(): string[] {
    if (this.store === null) return [];
    const entries = listHostStaged(this.store.dir);
    if (entries === null) throw new StoreError("BROKER_UNAVAILABLE", "the snapshot store could not be observed");
    return entries.map(entry => entry.name);
  }

  private async backup<T>(make: () => Promise<T>): Promise<T> {
    try { return await make(); }
    catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError("BROKER_UNAVAILABLE",
        `the backup could not be made: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
