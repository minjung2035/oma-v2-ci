/** Host process application coordinator: composes VM, project/session commands and cleanup.
 * VmLifecycle owns VM transitions; native drivers implement effects without product workflows. */
/** `omahostd`'s parts put together (macos-platform §2.1): the VM's state
 * machine, the guest link, egress, the Host API, and the host record. The
 * entry adds only the Mac-specific pieces (the VM helper, the paths). */
import type { Server, Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { chmodSync, readdirSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GuestLink, type HostIdentity } from "./guest-link.js";
import { VmLifecycle, type LifecycleOptions, type VmDriver } from "./lifecycle.js";
import { EgressHost, type EgressHostOptions } from "./egress.js";
import { startHostApi } from "./host-api.js";
import { readHostRecord, writeHostRecord, type HostRecord } from "./record.js";
import type { ProjectBookmarks } from "./bookmark.js";
import type { SnapshotStore } from "./snapshot.js";
import { SnapshotCoordinator } from "./snapshot-coordinator.js";
import { ProjectSyncCoordinator } from "./project-sync.js";
import { SessionGateway } from "./session-gateway.js";
import { HostTransfers } from "./transfers.js";
import { collectTemporaries, ensureHostOwnedDirectory, removeHostStaged } from "./files.js";
import { ProcessLock } from "../../runtime/process-lock.js";
import { withAsyncCleanup } from "../../process/cleanup.js";
import { ensureOwnedUserDirectory } from "../../runtime/user-files.js";
import { assertWriterWait, withProcessWriterLock } from "../../runtime/process-writer.js";
import { StoreError } from "../../domain/errors.js";
import type { KeychainStore } from "./keychain.js";
import { PLATFORM_FRAME_BYTES } from "../../protocol/host-guest.js";
import { makePublicDial } from "../../runtime/connect-proxy.js";

export type Timings = Pick<LifecycleOptions, "handshakeDeadlineMs" | "handshakeRetryMs" | "drainDeadlineMs" | "healthEveryMs" | "hungAfterMs" | "restarts">;
/** The spec's values: MAC-320 (60 s drain), MAC-330 (10 s / 30 s), MAC-331 (3 in 10 min). */
export const DEFAULT_TIMINGS: Timings = Object.freeze({
  handshakeDeadlineMs: 60_000, handshakeRetryMs: 250, drainDeadlineMs: 60_000, healthEveryMs: 10_000, hungAfterMs: 30_000,
  restarts: { max: 3, windowMs: 10 * 60_000, backoffMs: 1000 },
});

export interface HostServiceOptions {
  /** The run directory: the Host API socket and its token live here. */
  readonly runDir: string;
  readonly recordPath: string;
  readonly driver: VmDriver;
  readonly identity: HostIdentity;
  /** The verified image's schema, committed with readiness and image identity. */
  readonly stateSchemaWritten?: number;
  readonly resolve: EgressHostOptions["resolve"];
  readonly uid: number;
  /** §6: the git the app ships, for the Human's repositories (MAC-404). */
  readonly git: string;
  /** §8.4: where archives are kept, and the Keychain that holds their key. */
  readonly archivesDir: string;
  readonly keychain: KeychainStore;
  readonly timings?: Timings;
  /** §9.1: the Mac's sleep and wake, when the driver reports them. */
  readonly power?: (listener: (event: "sleep" | "wake") => void) => void;
  /** MAC-660: the state disk, whose size sets the free space the Mac keeps. */
  readonly statePath?: string;
  /** MAC-660's floor, when it is not the spec's max(5 GiB, 10% of the state
   * disk): the free space below which new transfers are refused. */
  readonly storageFloorBytes?: number;
  /** DR25: the package store `oma pi` installs into on the Mac. */
  readonly packagesDir?: string;
  /** §8.4: where the state disk's snapshots are kept -- the update's own and
   * the ones the Human asks for. Needs `statePath`; without it there is no
   * disk to snapshot and no store is opened. */
  readonly snapshotsDir?: string;
  /** The clone itself, when it is not APFS's (snapshot.ts's default). */
  readonly snapshotClone?: SnapshotStore["clone"];
  readonly bookmarks?: ProjectBookmarks;
}

const GIB = 1024 ** 3;
/** MAC-660: what the Mac keeps free -- max(5 GiB, 10% of the state disk). */
function storageFloor(options: HostServiceOptions): number {
  if (options.storageFloorBytes !== undefined) return options.storageFloorBytes;
  const disk = options.statePath === undefined ? 0 : statSync(options.statePath).blocks * 512;
  return Math.max(5 * GIB, Math.ceil(disk / 10));
}
/** MAC-660: `incoming` more bytes in `dir` must leave the floor free. */
function assertRoom(dir: string, incoming: number, floor: number): void {
  const disk = statfsSync(dir);
  if (disk.bavail * disk.bsize - incoming < floor)
    throw new StoreError("STORAGE_FULL", "the Mac does not have room for this; free some space and try again");
}

/** The cross-process writer-lock wait is bounded like every other wait this
 * service makes: a live holder that never releases must surface an honest
 * unavailable, never spin forever. */
export const ARCHIVE_KEY_LOCK_WAIT_MS = 30_000;

/** The archive key: made once on this Mac and kept in the Keychain (§8.4).
 * Its creation is the serialized create-if-absent the credentials use
 * (AV-22): one OS writer across this and other processes, then a reread
 * under it -- so two callers can never write two keys, the loser's archives
 * opening with nothing (P0-2/4). The lock wait itself is bounded
 * (ARCHIVE_KEY_LOCK_WAIT_MS): contention past the deadline is
 * BROKER_UNAVAILABLE, not a hang. */
export async function archiveKey(keychain: KeychainStore, lockPath: string,
    waitMs = ARCHIVE_KEY_LOCK_WAIT_MS): Promise<Buffer> {
  assertWriterWait(waitMs);
  const stored = await keychain.get("archive");
  if (stored !== undefined) return Buffer.from(stored, "base64");
  // P0-8: the archive key lock lives in oma's own run directory; its leaf
  // is repaired rather than trusted as-is.
  ensureOwnedUserDirectory(dirname(lockPath), dirname(lockPath));
  return withProcessWriterLock(lockPath, async held => {
    const fenced = (writer: KeychainStore): Promise<Buffer> => (async () => {
      // Read once more under the lock: a winner may already have written.
      const current = await writer.get("archive");
      if (current !== undefined) return Buffer.from(current, "base64");
      const made = randomBytes(32);
      held.assertHeld(lockPath);
      await writer.put("archive", made.toString("base64"));
      return made;
    })();
    return await (keychain.withWriter === undefined ? fenced(keychain) : keychain.withWriter(held.descriptor, fenced));
  }, { waitMs, busyMessage: "another process still holds the archive key lock" });
}

export class HostService {
  private ending: Promise<"stopped" | "forced"> | null = null;
  private constructor(readonly lifecycle: VmLifecycle, readonly egress: EgressHost, readonly link: GuestLink,
    private readonly api: Server, readonly token: string, private readonly stopRecorded: () => Promise<"stopped" | "forced">,
    private readonly apiConnections: Set<Socket>,
    private readonly lock: ProcessLock) {}

  static async start(options: HostServiceOptions): Promise<HostService> {
    // P0V-105 (F-09): one host service per support directory. Two would boot
    // two VMs on one state disk and take each other's sockets and record.
    const lock = ProcessLock.tryAcquire(join(options.runDir, "omahostd.lock"));
    if (lock === null) throw new StoreError("BROKER_UNAVAILABLE", "another OMA host service is running");
    try { return await HostService.startHeld(options, lock); }
    catch (error) { lock.close(); throw error; }
  }

  private static async startHeld(options: HostServiceOptions, lock: ProcessLock): Promise<HostService> {
    const record = (update: (current: HostRecord) => HostRecord): void => {
      lock.assertHeld(join(options.runDir, "omahostd.lock"));
      const current = readHostRecord(options.recordPath);
      if (current === null) throw new StoreError("STORE_CORRUPT", "the host record is missing");
      writeHostRecord(options.recordPath, update(current));
    };
    const link = new GuestLink(options.driver, options.identity,
      { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 10_000, requestTimeoutMs: 60_000 });
    const lifecycle = new VmLifecycle({
      driver: options.driver, link, now: () => performance.now(), wallClock: () => Date.now(),
      after: (ms, run) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; },
      ...(options.timings ?? DEFAULT_TIMINGS),
      record: event => { record(current => ({ ...current, lastStop: event })); },
      ready: () => { record(current => ({ ...current, provisioning: "done",
        image: { current: options.identity.expectImage,
          previous: current.image.current === options.identity.expectImage ? current.image.previous : current.image.current },
        ...(options.stateSchemaWritten === undefined ? {} : {
          highestSchemaWritten: Math.max(current.highestSchemaWritten ?? 0, options.stateSchemaWritten) }) })); },
    });
    const egress = new EgressHost({
      open: signal => link.bytes("egress", {}, signal), resolve: options.resolve,
      // v1 guests supplied no model budget. v2 carries it per run, not as a
      // host-wide RPC timeout. The compatibility value is the old model default.
      limits: { concurrent: 4, timeoutMs: 600_000 }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 32,
      // DR37: host-owned unrestricted network policy. Legacy guest role/allow
      // metadata is not authority. Run/boot ownership still gates every tunnel.
      dial: makePublicDial(),
      // A connect decision lands in the host's journal -- the stderr of the
      // service process -- once per tunnel the guest asks for.
      audit: entry => { console.error(`egress ${entry.actor} role=${entry.role} CONNECT ${entry.target} ${entry.decision} ${entry.reason}`); },
    });
    lifecycle.onState(state => {
      if (state === "ready") {
        egress.resume();
        void egress.fill().catch(error => { try { console.error("egress pool fill failed", error); } catch { /* best-effort observation */ } });
      } else { void egress.pause().catch(() => undefined); }
    });
    link.onReboot(() => { void egress.forgetBoot().catch(() => undefined); });
    // §9.1: a wake the guest's clock could not be stepped for is reported by
    // the lifecycle itself (NB-26), never swallowed here.
    options.power?.(event => { if (event === "wake") void lifecycle.woke().catch(() => undefined); });

    const transfer = join(options.runDir, "transfer");
    // P0-8/DR32: the transfer, archives and snapshots directories are oma's
    // own; a damaged leaf is repaired rather than trusted as-is.
    ensureHostOwnedDirectory(transfer, dirname(transfer));
    ensureHostOwnedDirectory(options.archivesDir, dirname(options.archivesDir));
    // P0V-103, P0V-104: under the lock, what a dead service left is its own:
    // the temporaries of publications it did not finish, and the transfer
    // files of requests it did not finish (a same-key retry makes them again).
    collectTemporaries(options.archivesDir);
    collectTemporaries(dirname(options.recordPath));
    for (const name of readdirSync(transfer)) removeHostStaged(join(transfer, name));
    const floor = storageFloor(options);
    const room = (dir: string, incoming: number): void => assertRoom(dir, incoming, floor);
    const snapshots = new SnapshotCoordinator({ lifecycle, link, recordPath: options.recordPath,
      imageVersion: options.identity.expectImage,
      ...(options.statePath === undefined ? {} : { statePath: options.statePath }),
      ...(options.snapshotsDir === undefined ? {} : { dir: options.snapshotsDir }),
      ...(options.snapshotClone === undefined ? {} : { clone: options.snapshotClone }) });
    const projects = new ProjectSyncCoordinator({ link, git: options.git, recordPath: options.recordPath, record,
      transfer, room, ...(options.bookmarks === undefined ? {} : { bookmarks: options.bookmarks }) });
    const sessions = new SessionGateway(link, lifecycle, projects, () => snapshots.start());
    const transfers = new HostTransfers({ link, transfer, room, archivesDir: options.archivesDir,
      ...(options.packagesDir === undefined ? {} : { packagesDir: options.packagesDir }),
      archiveKey: () => archiveKey(options.keychain, join(options.runDir, "archive-key.lock")) });
    const token = randomBytes(32).toString("hex");
    const tokenPath = join(options.runDir, "token");
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    const api = await startHostApi({
      socketPath: join(options.runDir, "hostapi.sock"), token, uid: options.uid,
      frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 10_000, requestTimeoutMs: 120_000,
      backend: {
        state: () => lifecycle.state,
        start: () => snapshots.start(),
        stop: () => snapshots.stop(),
        society: () => link.json("society"),
        terminal: (society, takeover) => link.bytes("terminal", { society, ...(takeover ? { takeover: true as const } : {}) }),
        bindProject: params => projects.bindProject(params),
        projectExtensions: projectId => sessions.projectExtensions(projectId),
        sessions: (method, params) => sessions.sessions(method, params),
        importProject: (key, params) => projects.importProject(key, params),
        syncPackages: (key, params) => transfers.syncPackages(key, params),
        exportProject: (key, params) => projects.exportProject(key, params),
        archive: (key, society) => transfers.archive(key, society),
        snapshot: params => snapshots.snapshot(params),
      },
    });
    const apiConnections = new Set<Socket>();
    api.on("connection", socket => {
      apiConnections.add(socket);
      socket.once("close", () => apiConnections.delete(socket));
    });
    return new HostService(lifecycle, egress, link, api, token, () => snapshots.shutdown(), apiConnections, lock);
  }

  /** MAC-320/321: the service is ending (logout, restart, update). */
  shutdown(): Promise<"stopped" | "forced"> {
    if (this.ending !== null) return this.ending;
    this.ending = withAsyncCleanup(async () => {
      // Closing admission is synchronous; cleanup failure never skips VM stop.
      const stopping = this.stopRecorded();
      const results = await Promise.allSettled([stopping, Promise.resolve().then(() => this.egress.stop())]);
      const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Host shutdown failed");
      const result = results[0]!;
      if (result.status !== "fulfilled") throw new Error("VM stop result is unavailable");
      return result.value;
    }, async () => {
      // A UI connection held open must not hold the end open (NB-29).
      await withAsyncCleanup(async () => {
        for (const socket of this.apiConnections) socket.destroy();
        await new Promise<void>((resolve, reject) => { this.api.close(error => error ? reject(error) : resolve()); });
      }, () => this.lock.close());
    });
    return this.ending;
  }
}
