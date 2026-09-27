/** MAC-2xx §4.4: the guest's control channel -- the few things that need root.
 *
 * Every effect on the machine goes through `GuestSystem`, so what this module
 * decides (a freeze always ends, a clock step is reported, a power-off is
 * asked once) is tested without root and the real effects stay small.
 */
import { StoreError } from "../../domain/errors.js";
import type { FramedPeer } from "../rpc.js";
import { serveRequests } from "./server.js";

export interface HealthFacts {
  readonly uptimeMs: number;
  readonly load: readonly [number, number, number];
  readonly memory: { readonly totalBytes: number; readonly availableBytes: number };
  readonly disk: { readonly totalBytes: number; readonly freeBytes: number };
  readonly failedUnits: number | null;
}

export interface GuestSystem {
  /** CLOCK_REALTIME, milliseconds. */
  wallClock(): number;
  setWallClock(ms: number): void;
  health(): HealthFacts;
  /** FIFREEZE / FITHAW on the state filesystem. A thaw of a filesystem that
   * is not frozen is not an error. */
  freeze(): void;
  thaw(): void;
  /** Grows the state filesystem to its device; answers the new size. */
  grow(): Promise<number>;
  powerOff(): void;
  /** A timer this module can cancel; injected so tests control time. */
  schedule(ms: number, run: () => void): { cancel(): void };
}

/** The most a freeze may last, whatever the host asks: broker writes stop
 * while it holds (MAC-620). */
export const FREEZE_LIMIT_MS = 30_000;

export class GuestControl {
  private frozen: { readonly at: number; readonly timer: { cancel(): void } } | null = null;
  private poweringOff = false;
  /** Why the last freeze ended, for health and tests. */
  lastThaw: "requested" | "deadline" | null = null;

  constructor(private readonly system: GuestSystem) {}

  get isFrozen(): boolean { return this.frozen !== null; }

  /** MAC-2xx §9.2: the host's wall clock, stepped to. The guest has no NTP. */
  setTime(wallMs: number): { steppedByMs: number } {
    if (!Number.isSafeInteger(wallMs) || wallMs <= 0) throw new StoreError("INVALID_REQUEST", "wallMs must be a positive integer");
    const before = this.system.wallClock();
    this.system.setWallClock(wallMs);
    return { steppedByMs: wallMs - before };
  }

  /** MAC-620: a freeze always ends. The deadline is the host's, capped, and
   * it is kept even if the host's connection closes. */
  freeze(deadlineMs: number): { frozenAt: number } {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new StoreError("INVALID_REQUEST", "deadlineMs must be a positive integer");
    if (this.frozen !== null) throw new StoreError("BATCH_CONFLICT", "the state filesystem is already frozen");
    if (this.poweringOff) throw new StoreError("BROKER_UNAVAILABLE", "the guest is powering off");
    this.system.freeze();
    const at = this.system.wallClock();
    const timer = this.system.schedule(Math.min(deadlineMs, FREEZE_LIMIT_MS), () => { this.end("deadline"); });
    this.frozen = { at, timer };
    return { frozenAt: at };
  }

  thaw(): { thawed: boolean } {
    const was = this.frozen !== null;
    this.end("requested");
    return { thawed: was };
  }

  private end(reason: "requested" | "deadline"): void {
    const frozen = this.frozen;
    if (frozen === null) return;
    this.frozen = null;
    frozen.timer.cancel();
    this.system.thaw();
    this.lastThaw = reason;
  }

  /** The host drains the societies first (MAC-320 step 2) and then asks for
   * this; a frozen filesystem is thawed before the power goes. */
  powerOff(): { accepted: boolean } {
    if (this.poweringOff) return { accepted: true };
    this.poweringOff = true;
    this.end("requested");
    this.system.powerOff();
    return { accepted: true };
  }

  serve(peer: FramedPeer): void {
    serveRequests(peer, async (method, params) => {
      switch (method) {
        case "time.set": return this.setTime(params.wallMs as number);
        case "health.get": {
          const facts = this.system.health();
          return { ...facts, frozen: this.frozen !== null };
        }
        case "fs.freeze": return this.freeze(params.deadlineMs as number);
        case "fs.thaw": return this.thaw();
        case "disk.grow": return { filesystemBytes: await this.system.grow() };
        case "power.off": return this.powerOff();
        default: throw new StoreError("UNKNOWN_METHOD", `the control channel has no ${method}`);
      }
    });
  }
}
