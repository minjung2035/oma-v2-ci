/** `omahostd`'s parts put together (macos-platform §2.1): the VM's state
 * machine, the guest link, egress, the Host API, and the host record. The
 * entry adds only the Mac-specific pieces (the VM helper, the paths). */
import type { Server } from "node:net";
import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { GuestLink, type HostIdentity } from "./guest-link.js";
import { VmLifecycle, type LifecycleOptions, type VmDriver } from "./lifecycle.js";
import { EgressHost, type EgressHostOptions } from "./egress.js";
import { startHostApi } from "./host-api.js";
import { readHostRecord, writeHostRecord, type HostRecord } from "./record.js";
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
  readonly timings?: Timings;
  /** §9.1: the Mac's sleep and wake, when the driver reports them. */
  readonly power?: (listener: (event: "sleep" | "wake") => void) => void;
}

export class HostService {
  private constructor(readonly lifecycle: VmLifecycle, readonly egress: EgressHost, readonly link: GuestLink,
    private readonly api: Server, readonly token: string, private readonly stopRecorded: () => Promise<"stopped" | "forced">) {}

  static async start(options: HostServiceOptions): Promise<HostService> {
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
      },
    });
    return new HostService(lifecycle, egress, link, api, token, stopRecorded);
  }

  /** MAC-320/321: the service is ending (logout, restart, update). */
  async shutdown(): Promise<"stopped" | "forced"> {
    await this.egress.stop();
    const result = await this.stopRecorded();
    await new Promise<void>(resolve => { this.api.close(() => resolve()); });
    return result;
  }
}
