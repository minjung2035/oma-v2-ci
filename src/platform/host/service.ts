/** `omahostd`'s parts put together (macos-platform §2.1): the VM's state
 * machine, the guest link, egress, the Host API, and the host record. The
 * entry adds only the Mac-specific pieces (the VM helper, the paths). */
import type { Server } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GuestLink, type HostIdentity } from "./guest-link.js";
import { VmLifecycle, type LifecycleOptions, type VmDriver } from "./lifecycle.js";
import { EgressHost, type EgressHostOptions } from "./egress.js";
import { startHostApi } from "./host-api.js";
import { readHostRecord, writeHostRecord, type HostRecord } from "./record.js";
import { MacGit, fileSink, getStream, putStream } from "./project.js";
import { sealedArchiveSink } from "./archive-crypto.js";
import { collectTemporaries } from "./files.js";
import { ProcessLock } from "../../runtime/process-lock.js";
import { StoreError } from "../../domain/errors.js";
import type { KeychainStore } from "./keychain.js";
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

/** The archive key: made once on this Mac and kept in the Keychain (§8.4). */
async function archiveKey(keychain: KeychainStore): Promise<Buffer> {
  const stored = await keychain.get("archive");
  if (stored !== undefined) return Buffer.from(stored, "base64");
  const made = randomBytes(32);
  await keychain.put("archive", made.toString("base64"));
  return made;
}

export class HostService {
  private constructor(readonly lifecycle: VmLifecycle, readonly egress: EgressHost, readonly link: GuestLink,
    private readonly api: Server, readonly token: string, private readonly stopRecorded: () => Promise<"stopped" | "forced">,
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
      // The product's default idleStreamSeconds: the host reads no society's configuration.
      limits: { concurrent: 4, timeoutMs: 30_000 }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 32,
    });
    lifecycle.onState(state => {
      if (state === "ready") {
        // MAC-303: a disk that answered a handshake has been made.
        record(current => current.provisioning === "done" ? current : { ...current, provisioning: "done" });
        void egress.fill();
      }
    });
    link.onReboot(() => { void egress.forgetBoot(); });
    options.power?.(event => { if (event === "wake") void lifecycle.woke().catch(() => undefined); });

    const stopRecorded = async (): Promise<"stopped" | "forced"> => {
      const result = await lifecycle.stop();
      if (result === "stopped") record(current => ({ ...current, lastStop: "clean" }));
      return result;
    };
    const git = new MacGit(options.git);
    const transfer = join(options.runDir, "transfer");
    mkdirSync(transfer, { recursive: true, mode: 0o700 });
    mkdirSync(options.archivesDir, { recursive: true, mode: 0o700 });
    // P0V-103, P0V-104: under the lock, what a dead service left is its own:
    // the temporaries of publications it did not finish, and the transfer
    // files of requests it did not finish (a same-key retry makes them again).
    collectTemporaries(options.archivesDir);
    collectTemporaries(dirname(options.recordPath));
    for (const name of readdirSync(transfer)) rmSync(join(transfer, name), { force: true, recursive: true });
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
        start: () => lifecycle.start(),
        stop: stopRecorded,
        society: () => link.json("society"),
        terminal: (society, takeover) => link.bytes("terminal", { society, ...(takeover ? { takeover: true as const } : {}) }),
        importProject: async (key, params) => {
          const file = join(transfer, `${createHash("sha256").update(key).digest("hex")}.import.bundle`);
          assertRoom(transfer, 0, floor);
          try {
            const bundled = await git.bundle(params.macRepo, params.branch, params.since, file);
            await putStream(await link.bytes("stream"), key, file, PLATFORM_FRAME_BYTES);
            const society = await link.json("society");
            try {
              return await society.request("project.import",
                { projectId: params.projectId, branch: params.branch, bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, key);
            } finally { society.close(); }
          } finally { rmSync(file, { force: true }); }
        },
        exportProject: async (key, params) => {
          const society = await link.json("society");
          let exported: Record<string, unknown>;
          try { exported = await society.request("project.export", { society: params.society, ...(params.since === null ? {} : { since: params.since }) }, key); }
          finally { society.close(); }
          const file = join(transfer, `${createHash("sha256").update(key).digest("hex")}.export.bundle`);
          try {
            await getStream(await link.bytes("stream"), key, declared => { assertRoom(transfer, declared.bytes, floor); return fileSink(file); },
              PLATFORM_FRAME_BYTES);
            return { ...exported, ...(await git.fetchExport(params.macRepo, file)), ref: "refs/remotes/oma/main" };
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
            const sealKey = await archiveKey(options.keychain);
            // MAC-621, P0V-104: sealed as it arrives -- the plain bytes are
            // never written -- into a temporary published whole.
            await getStream(await link.bytes("stream"), key, declared => {
              assertRoom(options.archivesDir, declared.bytes, floor);
              return sealedArchiveSink(options.archivesDir, name, sealKey);
            }, PLATFORM_FRAME_BYTES, "archive");
          }
          return { ...made, path: target };
        },
      },
    });
    return new HostService(lifecycle, egress, link, api, token, stopRecorded, lock);
  }

  /** MAC-320/321: the service is ending (logout, restart, update). */
  async shutdown(): Promise<"stopped" | "forced"> {
    await this.egress.stop();
    const result = await this.stopRecorded();
    await new Promise<void>(resolve => { this.api.close(() => resolve()); });
    this.lock.close();
    return result;
  }
}
