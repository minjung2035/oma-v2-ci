/** A "VM" for the host's tests: the real guest services -- guestctl's
 * control, guesthost's society channel and egress pool -- run on this machine,
 * and `connect(port)` reaches them as vsock would. Power-off stops "the VM"
 * unless the guest is told to ignore it; `hung` makes every new connection
 * one that is accepted and never answered. */
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FramedPeer } from "#oma-test/app/platform/rpc";
import { StoreError } from "@oma/domain/errors";
import { startGuestServer, type GuestIdentity } from "#oma-test/app/platform/guest/server";
import { GuestControl } from "#oma-test/app/platform/guest/control";
import { type GuestSystem } from "@oma/contracts/guest-control";
import { GuestHost, type SessionLauncher } from "#oma-test/app/platform/guest/host";
import { EgressPool } from "#oma-test/app/platform/guest/egress";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { GuestProjects } from "#oma-test/app/platform/guest/project";
import { serveStream } from "#oma-test/app/platform/guest/stream";
import { GuestArchives } from "#oma-test/app/platform/guest/archive";
import { GuestPackages } from "#oma-test/app/platform/guest/packages";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { fileURLToPath } from "node:url";
import { listening } from "#oma-test/app/platform/guest/host";
import type { VmDriver, VmStopCause } from "@oma/contracts/platform-lifecycle";
import { GUEST_PORTS, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";

const self = { uid: process.getuid!(), gid: process.getgid!() };

export interface Guest { readonly control: string; readonly society: string; readonly calls: string[]; close(): Promise<void>; silence(): void }

/** Runs guestctl and guesthost here; `power.off` stops "the VM" unless the
 * guest is told to ignore it. */
export class LocalDriver implements VmDriver<Socket> {
  pool = new EgressPool();
  running: Guest | null = null;
  starts = 0;
  forced = 0;
  image = "2026.09.1";
  ignorePowerOff = false;
  hung = false;
  readonly calls: string[] = [];
  /** The next this many clock steps are refused -- for the wake path's tests;
   * a boot's own clock step after a restart is counted the same way. */
  failTimeSets = 0;
  private readonly stopListeners: ((cause: VmStopCause) => void)[] = [];
  private silent: Server | null = null;
  constructor(private readonly dir: string,
    private readonly societies: { dir: string; launcher: SessionLauncher; mutate?: (peer: FramedPeer) => void },
    private readonly instanceId: string) {}

  onStopped(listener: (cause: VmStopCause) => void): void { this.stopListeners.push(listener); }
  private stopped(cause: VmStopCause): void { for (const listener of this.stopListeners) listener(cause); }

  private disposed = false;
  async start(): Promise<void> {
    if (this.disposed) throw new Error("this test's VM is gone");
    this.starts += 1;
    this.hung = false;
    this.running = await this.boot();
  }
  async forceStop(): Promise<void> {
    this.forced += 1;
    await this.halt();
  }
  /** The guest crashes on its own. */
  async crash(): Promise<void> { await this.halt(); }
  private async halt(cause: VmStopCause = "error"): Promise<void> {
    const guest = this.running;
    this.running = null;
    if (guest === null) return;
    this.pool.close();
    this.pool = new EgressPool();
    await guest.close();
    this.stopped(cause);
  }
  async connect(port: number): Promise<Socket> {
    if (this.hung) {
      this.silent ??= await listenSilently(join(this.dir, "silent.sock"));
      return open(join(this.dir, "silent.sock"));
    }
    if (this.running === null) throw new Error("no VM");
    return open(port === GUEST_PORTS.control ? this.running.control : this.running.society);
  }

  private async boot(): Promise<Guest> {
    const bootId = randomUUID();
    const identity = (): GuestIdentity => ({ instanceId: this.instanceId, guestImage: this.image, bootId,
      stateSchema: { written: 1, readable: [1] }, capabilities: [] });
    const system: GuestSystem = {
      wallClock: () => 0, setWallClock: ms => { this.calls.push(`time.set:${ms > 0}`);
        if (this.failTimeSets > 0) { this.failTimeSets -= 1; throw new StoreError("INTERNAL_ERROR", "the guest's clock would not step"); } },
      health: () => ({ uptimeMs: 1, load: [0, 0, 0], memory: { totalBytes: 1, availableBytes: 1 }, disk: { totalBytes: 1, freeBytes: 1 }, failedUnits: 0 }),
      freeze: () => {}, thaw: () => {}, grow: async () => 0,
      powerOff: () => { this.calls.push("power.off"); if (!this.ignorePowerOff) setTimeout(() => { void this.halt("guest"); }, 10); },
      schedule: (ms, run) => { const timer = setTimeout(run, ms); return { cancel: () => clearTimeout(timer) }; },
      receiptWaitFloor: () => ({ kind: "none" }),
    };
    const control = new GuestControl(system);
    const ledger = new RequestLedger(join(this.dir, "requests"));
    const projects = new GuestProjects(join(this.dir, "projects"), this.societies.dir, ledger);
    const archives = new GuestArchives(this.societies.dir, ledger, async society => await listening(this.societies.launcher.socketPath(society)) ? "running" : this.societies.launcher.stop(society, 2000));
    // DR25: the engine's `oma pi` code, this checkout's, over the guest's data.
    const libdir = fileURLToPath(new URL("../../../", import.meta.url));
    const packages = new GuestPackages({ ledger, projects, dataDir: this.societies.dir, libdir, node: process.execPath,
      entry: join(libdir, DEPLOYMENT_LAYOUT.entries.guestPackages), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: this.dir, LANG: "C.UTF-8" },
      timeoutMs: 60_000 });
    const host = new GuestHost({ societiesDir: this.societies.dir, projectsDir: join(this.dir, "projects"), launcher: this.societies.launcher, stopDeadlineMs: 2000,
      projects, ledger, archives, packages });
    const suffix = randomUUID().slice(0, 8);
    const servers = [
      await startGuestServer({ socketPath: join(this.dir, `c-${suffix}.sock`), identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
        helloDeadlineMs: 1000, requestTimeoutMs: 2000, channels: { control: { kind: "json", serve: ({ peer }) => control.serve(peer) } } }),
      await startGuestServer({ socketPath: join(this.dir, `s-${suffix}.sock`), identity, bridge: self, frameBytes: PLATFORM_FRAME_BYTES,
        helloDeadlineMs: 1000, requestTimeoutMs: 2000, channels: { society: { kind: "json", serve: ({ peer }) => {
          peer.onFrame(frame => { if (typeof frame.method === "string") this.calls.push(frame.method); });
          this.societies.mutate?.(peer);
          host.serve(peer);
        } }, egress: { kind: "bytes", serve: socket => { this.pool.park(socket); } },
        stream: { kind: "bytes", serve: socket => { void serveStream(socket, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, reserveBytes: 0, dataDir: this.dir }); } } } }),
    ];
    const sockets = new Set<Socket>();
    for (const server of servers) server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    return {
      control: join(this.dir, `c-${suffix}.sock`), society: join(this.dir, `s-${suffix}.sock`), calls: this.calls,
      close: async () => { for (const socket of sockets) socket.destroy(); await Promise.all(servers.map(server => new Promise(r => server.close(r)))); },
      silence: () => { for (const socket of sockets) socket.destroy(); },
    };
  }
  async dispose(): Promise<void> { this.disposed = true; await this.halt(); await new Promise(r => this.silent === null ? r(null) : this.silent.close(r)); }
}
export async function open(path: string): Promise<Socket> {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  return socket;
}
/** A guest that accepts and never answers: a hung VM. */
export async function listenSilently(path: string): Promise<Server> {
  const server = createServer(socket => { socket.on("data", () => {}); });
  await new Promise<void>(resolve => server.listen(path, resolve));
  return server;
}

