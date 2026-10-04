/** `omahostd`'s parts put together (macos-platform §2.1): the VM's state
 * machine, the guest link, egress, the Host API, and the host record. The
 * entry adds only the Mac-specific pieces (the VM helper, the paths). */
import type { Server, Socket } from "node:net";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { GuestLink, type HostIdentity } from "./guest-link.js";
import { VmLifecycle, type LifecycleOptions, type VmDriver } from "./lifecycle.js";
import { EgressHost, type EgressHostOptions } from "./egress.js";
import { startHostApi } from "./host-api.js";
import { readHostRecord, writeHostRecord, type HostRecord, type ProjectRecord } from "./record.js";
import type { ProjectBookmarks } from "./bookmark.js";
import { MacGit, fileSink, getStream, putStream, sha256File } from "./project.js";
import { writePackageArchive } from "../package-archive.js";
import { sealedArchiveSink } from "./archive-crypto.js";
import { openSnapshotStore, pruneSnapshots, snapshotRunning, snapshotStopped, type SnapshotStore } from "./snapshot.js";
import { collectTemporaries } from "./files.js";
import { ProcessLock } from "../../runtime/process-lock.js";
import { withAsyncCleanup } from "../../process/cleanup.js";
import { ensureUserDirectory } from "../../runtime/user-files.js";
import { setTimeout as pause } from "node:timers/promises";
import { StoreError } from "../../domain/errors.js";
import type { KeychainStore } from "./keychain.js";
import { serialized } from "./keychain.js";
import { PLATFORM_FRAME_BYTES } from "../../protocol/host-guest.js";

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
/** §8.4/MAC-661: how many of the newest snapshots a prune keeps. */
const SNAPSHOTS_KEPT = 3;
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
 * (AV-22): one in-process writer, then the cross-process lock, then a reread
 * under it -- so two callers can never write two keys, the loser's archives
 * opening with nothing (P0-2/4). The lock wait itself is bounded
 * (ARCHIVE_KEY_LOCK_WAIT_MS): contention past the deadline is
 * BROKER_UNAVAILABLE, not a hang. */
export async function archiveKey(keychain: KeychainStore, lockPath: string,
    waitMs = ARCHIVE_KEY_LOCK_WAIT_MS): Promise<Buffer> {
  // A wait that is not a finite positive number cannot bound the loop below:
  // NaN or an infinity makes `now >= now + waitMs` never true and the
  // deadline meant to bound this wait becomes the unbounded spin it replaced.
  // Invalid arguments are refused before the first try.
  if (!Number.isFinite(waitMs) || waitMs <= 0)
    throw new StoreError("INVALID_REQUEST", "the archive key lock wait must be a positive finite number of milliseconds");
  const acquire = (): ProcessLock | null => {
    try { return ProcessLock.tryAcquire(lockPath); }
    catch (error) {
      // The wait exists for transient contention: out of descriptors or of
      // lock slots is "try later", like a held lock, never a raw errno.
      if (["EMFILE", "ENFILE", "EAGAIN"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw new StoreError("BROKER_UNAVAILABLE",
          `the archive key lock could not be acquired (${(error as NodeJS.ErrnoException).code}); try again`);
      throw error;
    }
  };
  const stored = await keychain.get("archive");
  if (stored !== undefined) return Buffer.from(stored, "base64");
  return serialized(lockPath, async () => {
    const again = await keychain.get("archive");
    if (again !== undefined) return Buffer.from(again, "base64");
    ensureUserDirectory(dirname(lockPath));
    const deadline = performance.now() + waitMs;
    let lock: ProcessLock | null;
    while ((lock = acquire()) === null) {
      if (performance.now() >= deadline)
        throw new StoreError("BROKER_UNAVAILABLE", "another process still holds the archive key lock");
      await pause(25);
    }
    const held = lock;
    return withAsyncCleanup(async () => {
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
    }, () => held.close());
  });
}

export class HostService {
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
      if (current !== null) writeHostRecord(options.recordPath, update(current));
    };
    const link = new GuestLink(options.driver, options.identity,
      { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 10_000, requestTimeoutMs: 60_000 });
    const lifecycle = new VmLifecycle({
      driver: options.driver, link, now: () => performance.now(), wallClock: () => Date.now(),
      after: (ms, run) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; },
      ...(options.timings ?? DEFAULT_TIMINGS),
      record: event => { record(current => ({ ...current, lastStop: event })); },
    });
    const egress = new EgressHost({
      open: () => link.bytes("egress"), resolve: options.resolve,
      // v1 guests supplied no model budget. v2 carries it per run, not as a
      // host-wide RPC timeout. The compatibility value is the old model default.
      limits: { concurrent: 4, timeoutMs: 600_000 }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 32,
    });
    lifecycle.onState(state => {
      if (state === "ready") {
        // MAC-303: a disk that answered a handshake has been made.
        record(current => current.provisioning === "done" ? current : { ...current, provisioning: "done" });
        void egress.fill();
      }
    });
    link.onReboot(() => { void egress.forgetBoot().catch(() => undefined); });
    // §9.1: a wake the guest's clock could not be stepped for is reported by
    // the lifecycle itself (NB-26), never swallowed here.
    options.power?.(event => { if (event === "wake") void lifecycle.woke().catch(() => undefined); });

    const stopRecorded = (): Promise<"stopped" | "forced"> => lifecycle.stop();
    const git = new MacGit(options.git);
    const projects = (): readonly ProjectRecord[] => {
      const current = readHostRecord(options.recordPath);
      if (current === null) throw new StoreError("STORE_CORRUPT", "The app's project record is missing");
      return current.projects;
    };
    const bookmarks = (): ProjectBookmarks => {
      if (options.bookmarks === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Project bookmarks are unavailable");
      return options.bookmarks;
    };
    const projectRepo = async (project: ProjectRecord, requested?: string): Promise<string> => {
      const repo = realpathSync(await bookmarks().resolve(project.bookmark));
      if (requested !== undefined && realpathSync(requested) !== repo)
        throw new StoreError("INVALID_REQUEST", "The project folder does not match its saved bookmark; bind its new location first");
      await git.verifyIdentity(repo, project);
      return repo;
    };
    const transfer = join(options.runDir, "transfer");
    mkdirSync(transfer, { recursive: true, mode: 0o700 });
    mkdirSync(options.archivesDir, { recursive: true, mode: 0o700 });
    // P0V-103, P0V-104: under the lock, what a dead service left is its own:
    // the temporaries of publications it did not finish, and the transfer
    // files of requests it did not finish (a same-key retry makes them again).
    collectTemporaries(options.archivesDir);
    collectTemporaries(dirname(options.recordPath));
    for (const name of readdirSync(transfer)) rmSync(join(transfer, name), { force: true, recursive: true });
    // §8.4: the snapshot store, when this OMA keeps one -- the update's own
    // snapshots and the ones the Human asks for. A dead service's unfinished
    // clone is a temporary its start removes (P0V-103, F-08).
    let snapshots: SnapshotStore | null = null;
    if (options.snapshotsDir !== undefined && options.statePath !== undefined) {
      mkdirSync(options.snapshotsDir, { recursive: true, mode: 0o700 });
      openSnapshotStore(options.snapshotsDir);
      snapshots = { dir: options.snapshotsDir, statePath: options.statePath,
        ...(options.snapshotClone === undefined ? {} : { clone: options.snapshotClone }) };
    }
    // A backup's own condition -- the disk had no room for the clone, a copy
    // whose consistency is not proven -- is the honest unavailable, not an
    // internal error (MAC-622, P0-5).
    const backup = async <T>(make: () => Promise<T>): Promise<T> => {
      try { return await make(); }
      catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError("BROKER_UNAVAILABLE",
          `the backup could not be made: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    /** §8.4, MAC-661: space before count -- the newest SNAPSHOTS_KEPT stay,
     * plus the running image's own pre-update snapshot, whose protection is
     * never lifted while this image runs (the spec's three-boots-or-seven-days
     * window is its minimum, not its bound). An older update's snapshot
     * decays by age like any other. */
    const updateProtection = (): ReadonlySet<string> => {
      if (snapshots === null) return new Set();
      const marker = `-update-${options.identity.expectImage}.img`;
      return new Set(readdirSync(snapshots.dir).filter(name => name.endsWith(marker)));
    };
    const prune = (): void => { if (snapshots !== null) pruneSnapshots(snapshots.dir, SNAPSHOTS_KEPT, updateProtection()); };
    // §8.4: the update's own snapshot -- the state disk as the image that
    // last booted left it -- is kept before this image's first boot can write
    // it. The record names what last booted, `expectImage` what is about to:
    // equal, or no image ever booted, is no update. The marker name means the
    // snapshot was already made -- re-making it now would preserve a disk
    // this image may already have touched. A snapshot that cannot be made
    // refuses the boot: the update does not run its rollback point down.
    let updateBackup: Promise<void> | null = null;
    const updateSnapshot = (): Promise<void> => {
      if (snapshots === null || lifecycle.state !== "stopped") return Promise.resolve();
      const current = readHostRecord(options.recordPath);
      if (current === null || current.image.current === null || current.image.current === options.identity.expectImage)
        return Promise.resolve();
      if (readdirSync(snapshots.dir).some(name => name.endsWith(`-update-${options.identity.expectImage}.img`)))
        return Promise.resolve();
      updateBackup ??= backup(() => snapshotStopped(snapshots, `update-${options.identity.expectImage}`))
        .then(() => { prune(); }).finally(() => { updateBackup = null; });
      return updateBackup;
    };
    const floor = storageFloor(options);
    const token = randomBytes(32).toString("hex");
    const tokenPath = join(options.runDir, "token");
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
    const api = await startHostApi({
      socketPath: join(options.runDir, "hostapi.sock"), token, uid: options.uid,
      frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 10_000, requestTimeoutMs: 120_000,
      backend: {
        state: () => lifecycle.state,
        start: async () => { await updateSnapshot(); await lifecycle.start(); },
        stop: stopRecorded,
        society: () => link.json("society"),
        terminal: (society, takeover) => link.bytes("terminal", { society, ...(takeover ? { takeover: true as const } : {}) }),
        bindProject: async params => {
          const repo = realpathSync(params.macRepo);
          const identity = await git.identity(repo);
          const bookmark = await bookmarks().create(repo);
          if (realpathSync(await bookmarks().resolve(bookmark)) !== repo)
            throw new StoreError("BROKER_UNAVAILABLE", "The project bookmark does not identify the selected folder");
          // The existing writer re-reads after the asynchronous inspection.
          // Repeating a bind for this Society keeps its original project ID.
          let selected: ProjectRecord | undefined;
          record(current => {
            const prior = current.projects.find(p => p.society === params.society);
            if (prior !== undefined && (prior.objectFormat !== identity.objectFormat ||
                !identity.rootCommits.some(root => prior.rootCommits.includes(root))))
              throw new StoreError("INVALID_REQUEST", "This Society is bound to another repository");
            selected = prior === undefined ? { ...identity, projectId: randomUUID(), society: params.society,
              displayName: basename(repo).slice(0, 200), bookmark } : { ...prior, bookmark };
            return { ...current, projects: [...current.projects.filter(p => p.society !== params.society), selected] };
          });
          if (selected === undefined) throw new StoreError("STORE_CORRUPT", "The app's project record is missing");
          return { projectId: selected.projectId, displayName: selected.displayName, society: selected.society };
        },
        projectExtensions: async projectId => {
          const project = projects().find(p => p.projectId === projectId);
          if (project === undefined) throw new StoreError("INVALID_REQUEST", "The project is not bound on this Mac");
          if (lifecycle.state !== "ready") throw new StoreError("BROKER_UNAVAILABLE", "Project settings require an already running engine");
          const peer = await link.json("society");
          try { return await peer.request("project.extensions", { projectId }); }
          finally { peer.close(); }
        },
        sessions: async (method, params) => {
          const project = projects().find(p => p.projectId === params.projectId);
          if (project === undefined || params.society !== undefined && params.society !== project.society)
            throw new StoreError("INVALID_REQUEST", "That history is not bound to a project on this Mac");
          // A resume may be the first interaction after an update: the boot
          // must take the same pre-update snapshot `start` takes, or the
          // rollback point is gone before this image writes the disk.
          if (method === "session.resume") { await updateSnapshot(); await lifecycle.start(); }
          else if (lifecycle.state !== "ready") throw new StoreError("BROKER_UNAVAILABLE", "Guest histories require an already running engine");
          await projectRepo(project);
          const peer = await link.json("society");
          try { return await peer.request(method, { ...params, society: project.society }); }
          finally { peer.close(); }
        },
        importProject: async (key, params) => {
          const project = projects().find(p => p.projectId === params.projectId);
          if (project === undefined) throw new StoreError("INVALID_REQUEST", "Bind the project on this Mac before importing it");
          const repo = await projectRepo(project, params.macRepo);
          const file = join(transfer, `${createHash("sha256").update(key).digest("hex")}.import.bundle`);
          assertRoom(transfer, 0, floor);
          try {
            const bundled = await git.bundle(repo, params.branch, params.since, file);
            await putStream(await link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
            const society = await link.json("society");
            try {
              const result = await society.request("project.import",
                { projectId: params.projectId, branch: params.branch, bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, key);
              if (typeof result.head !== "string" || !new RegExp(`^[0-9a-f]{${project.objectFormat === "sha256" ? 64 : 40}}$`).test(result.head))
                throw new StoreError("BROKER_UNAVAILABLE", "The import result could not be observed");
              const head = result.head;
              record(current => ({ ...current, projects: current.projects.map(p => p.projectId === project.projectId
                ? { ...p, lastImport: { head, at: Date.now() } } : p) }));
              return result;
            } finally { society.close(); }
          } finally { rmSync(file, { force: true }); }
        },
        syncPackages: async (key, params) => {
          if (options.packagesDir === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "this OMA keeps no packages");
          const file = join(transfer, `${createHash("sha256").update(key).digest("hex")}.packages`);
          assertRoom(transfer, 0, floor);
          try {
            // The whole store, as it is now: what `oma pi` installed and the list it keeps.
            rmSync(file, { force: true });
            await writePackageArchive(options.packagesDir, file);
            const declared = { bytes: statSync(file).size, sha256: await sha256File(file) };
            await putStream(await link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
            const society = await link.json("society");
            try {
              return await society.request("packages.replace",
                { archive: declared, ...(params.activate === undefined ? {} : { activate: params.activate }), ...(params.projectId === null ? {} : { projectId: params.projectId }) }, key);
            } finally { society.close(); }
          } finally { rmSync(file, { force: true }); }
        },
        exportProject: async (key, params) => {
          const project = projects().find(p => p.society === params.society);
          if (project === undefined) throw new StoreError("INVALID_REQUEST", "The Society is not bound to a project on this Mac");
          const repo = await projectRepo(project, params.macRepo);
          const society = await link.json("society");
          let exported: Record<string, unknown>;
          try { exported = await society.request("project.export", { society: params.society, ...(params.since === null ? {} : { since: params.since }) }, key); }
          finally { society.close(); }
          const file = join(transfer, `${createHash("sha256").update(key).digest("hex")}.export.bundle`);
          try {
            await getStream(await link.bytes("stream"), key, declared => { assertRoom(transfer, declared.bytes, floor); return fileSink(file); },
              PLATFORM_FRAME_BYTES);
            // Recheck immediately before writing the Human's repository.
            await git.verifyIdentity(repo, project);
            const fetched = await git.fetchExport(repo, file);
            // NB-22: nothing malformed reaches the durable record -- a head
            // that is not this repository's object id is not a head.
            const oid = new RegExp(`^[0-9a-f]{${project.objectFormat === "sha256" ? 64 : 40}}$`);
            if (typeof fetched.head !== "string" || !oid.test(fetched.head))
              throw new StoreError("BROKER_UNAVAILABLE", "The export result could not be observed");
            record(current => ({ ...current, projects: current.projects.map(p => p.projectId === project.projectId
              ? { ...p, lastExport: { head: fetched.head, at: Date.now() } } : p) }));
            return { ...exported, ...fetched, ref: "refs/remotes/oma/main" };
          } finally { rmSync(file, { force: true }); }
        },
        archive: async (key, society) => {
          const peer = await link.json("society");
          let made: Record<string, unknown>;
          try { made = await peer.request("archive.create", { society }, key); } finally { peer.close(); }
          const name = `${society}-${createHash("sha256").update(key).digest("hex").slice(0, 16)}.omaarchive`;
          const target = join(options.archivesDir, name);
          // P0V-103: a name in the archives directory is a finished
          // publication (files.ts); an interrupted one is only a temporary.
          if (!existsSync(target)) {
            const sealKey = await archiveKey(options.keychain, join(options.runDir, "archive-key.lock"));
            // MAC-621, P0V-104: sealed as it arrives -- the plain bytes are
            // never written -- into a temporary published whole.
            await getStream(await link.bytes("stream"), key, declared => {
              assertRoom(options.archivesDir, declared.bytes, floor);
              return sealedArchiveSink(options.archivesDir, name, sealKey);
            }, PLATFORM_FRAME_BYTES, "archive");
          }
          return { ...made, path: target };
        },
        snapshot: async ({ id }) => {
          if (snapshots === null) throw new StoreError("UNSUPPORTED_PROFILE", "this OMA keeps no snapshots");
          // The update- marker namespace is the service's own (host-api.ts
          // refuses it at the wire; the same reservation holds for any other
          // caller that reaches this backend).
          const named = id ?? "manual";
          if (named.startsWith("update-"))
            throw new StoreError("INVALID_REQUEST", "snapshot ids beginning update- are reserved for the service's own pre-update snapshots");
          // REC-005: only a quiescent point -- a stopped engine's disk as it
          // is, or a running one's with every society stopped and the file
          // system frozen for the clone. An engine between the two is not a
          // point a backup can be made at.
          const state = lifecycle.state;
          if (state !== "stopped" && state !== "ready")
            throw new StoreError("BROKER_UNAVAILABLE", "the engine is not at a point a backup can be made");
          const made = state === "stopped"
            ? { path: await backup(() => snapshotStopped(snapshots, named)), stopped: [] as string[] }
            : await backup(() => snapshotRunning(snapshots, link, named));
          prune();
          return { path: made.path, stopped: made.stopped };
        },
      },
    });
    const apiConnections = new Set<Socket>();
    api.on("connection", socket => {
      apiConnections.add(socket);
      socket.once("close", () => apiConnections.delete(socket));
    });
    return new HostService(lifecycle, egress, link, api, token, stopRecorded, apiConnections, lock);
  }

  /** MAC-320/321: the service is ending (logout, restart, update). */
  async shutdown(): Promise<"stopped" | "forced"> {
    await this.egress.stop();
    const result = await this.stopRecorded();
    // A UI connection held open must not hold the end open (NB-29).
    for (const socket of this.apiConnections) socket.destroy();
    await new Promise<void>(resolve => { this.api.close(() => resolve()); });
    this.lock.close();
    return result;
  }
}
