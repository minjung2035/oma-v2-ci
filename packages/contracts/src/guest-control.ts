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

