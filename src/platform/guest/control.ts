/** MAC-2xx §4.4: the guest's control channel -- the few things that need root.
 *
 * Every effect on the machine goes through `GuestSystem`, so what this module
 * decides (a freeze always ends, a clock step is reported, a power-off is
 * asked once) is tested without root and the real effects stay small.
 */
import { StoreError } from "../../domain/errors.js";
import type { FramedPeer } from "../rpc.js";
import { serveRequests } from "../rpc-server.js";

export interface HealthFacts {
  readonly uptimeMs: number;
  readonly load: readonly [number, number, number];
  readonly memory: { readonly totalBytes: number; readonly availableBytes: number };
  readonly disk: { readonly totalBytes: number; readonly freeBytes: number };
  readonly failedUnits: number | null;
}

/** The shortest receipt wait any society in this guest is configured with
 * (`limits.receiptWaitSeconds`): "none" when there is no society, "unknown"
 * when a configuration could not be read. */
export type ReceiptWaitFloor =
  | { readonly kind: "none" }
  | { readonly kind: "known"; readonly ms: number }
  | { readonly kind: "unknown" };

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
  receiptWaitFloor(): ReceiptWaitFloor;
}

/** The most a freeze may last when no society bounds it. */
export const FREEZE_LIMIT_MS = 10_000;
/** How much sooner than the shortest receipt wait a freeze must end: the
 * thaw itself and the first write after it take time too. */
export const FREEZE_MARGIN_MS = 500;

export class GuestControl {
  private frozen: { readonly at: number; readonly timer: { cancel(): void } } | null = null;
  private poweringOff = false;
  /** Why the last freeze ended, for health and tests. */
  lastThaw: "requested" | "deadline" | "released" | null = null;

  constructor(private readonly system: GuestSystem) {}

  get isFrozen(): boolean { return this.frozen !== null; }

  /** MAC-2xx §9.2: the host's wall clock, stepped to. The guest has no NTP. */
  setTime(wallMs: number): { steppedByMs: number } {
    if (!Number.isSafeInteger(wallMs) || wallMs <= 0) throw new StoreError("INVALID_REQUEST", "wallMs must be a positive integer");
    const before = this.system.wallClock();
    this.system.setWallClock(wallMs);
    return { steppedByMs: wallMs - before };
  }

  /** MAC-620: a freeze always ends, and it ends before any society's
   * receipt wait could expire behind it: writes block while it holds. The
   * deadline is the host's, shortened to the shortest receipt wait actually
   * configured here less a margin; the one used is answered. A configuration
   * that cannot be read leaves that bound unknown, and no freeze is taken on
   * an unknown bound (P0-5). The deadline is kept even if the host's
   * connection closes. */
  freeze(deadlineMs: number): { frozenAt: number; deadlineMs: number } {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new StoreError("INVALID_REQUEST", "deadlineMs must be a positive integer");
    if (this.frozen !== null) throw new StoreError("BATCH_CONFLICT", "the state filesystem is already frozen");
    if (this.poweringOff) throw new StoreError("BROKER_UNAVAILABLE", "the guest is powering off");
    const floor = this.system.receiptWaitFloor();
    if (floor.kind === "unknown")
      throw new StoreError("BROKER_UNAVAILABLE", "a society's receipt wait could not be read, so no freeze can be shown to end before it");
    const ceiling = Math.min(FREEZE_LIMIT_MS, floor.kind === "known" ? floor.ms - FREEZE_MARGIN_MS : FREEZE_LIMIT_MS);
    if (ceiling <= 0) throw new StoreError("INVALID_REQUEST", "a society's receipt wait is too short for any freeze");
    const effective = Math.min(deadlineMs, ceiling);
    this.system.freeze();
    const at = this.system.wallClock();
    // NB-24: the deadline is the freeze's backstop. A thaw that fails inside
    // it is retried at the same cadence -- a timer callback cannot report,
    // so it neither escapes nor leaves the freeze with nothing armed.
    const retry = (): void => {
      try { this.end("deadline"); }
      catch {
        const frozen = this.frozen;
        if (frozen === null) return;
        let again: { cancel(): void };
        try { again = this.system.schedule(effective, retry); }
        catch { return; }
        if (this.frozen === frozen) this.frozen = { at: frozen.at, timer: again };
        else again.cancel();
      }
    };
    const timer = this.system.schedule(effective, retry);
    this.frozen = { at, timer };
    return { frozenAt: at, deadlineMs: effective };
  }

  thaw(): { thawed: boolean } {
    const was = this.frozen !== null;
    this.end("requested");
    return { thawed: was };
  }

  /** P0V-82, MAC-620: this process is ending, and the deadline timer that
   * would have ended its freeze ends with it -- so the freeze ends now. An
   * exit cannot be told a thaw failed: the unit's post-stop --thaw is the
   * backstop for what this process leaves. */
  release(): void {
    try { this.end("released"); } catch { /* ending anyway */ }
  }

  private end(reason: "requested" | "deadline" | "released"): void {
    const frozen = this.frozen;
    if (frozen === null) return;
    // NB-24: the thaw is tried while the freeze is still on the record and
    // its deadline still armed. If it fails the filesystem stays frozen --
    // and is still reported frozen, retried, and backstopped -- never
    // mistaken for already thawed.
    this.system.thaw();
    this.frozen = null;
    frozen.timer.cancel();
    this.lastThaw = reason;
  }

  /** The host drains the societies first (MAC-320 step 2) and then asks for
   * this; a frozen filesystem is thawed before the power goes. A thaw or a
   * power-off that fails is not marked done -- the power stays on and a
   * retry does the work (a power-off asks an idempotent systemctl). */
  powerOff(): { accepted: boolean } {
    if (this.poweringOff) return { accepted: true };
    this.end("requested");
    this.system.powerOff();
    this.poweringOff = true;
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
