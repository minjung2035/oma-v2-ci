import type { Actor, Json } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";

export type CallPhase = "waiting" | "reserved" | "provider-contact-started" | "settled" | "unknown";
export class InferenceCall {
  readonly controller = new AbortController();
  private current: CallPhase = "waiting";
  constructor(readonly request: string, readonly actor: Actor, readonly incarnation: number) {}
  get phase(): CallPhase { return this.current; }
  get ownsReservation(): boolean { return this.current !== "waiting"; }
  reserve(): void {
    if (this.current !== "waiting") throw new StoreError("INTERNAL_ERROR", "inference reservation already owned");
    this.current = "reserved";
  }
  beginContact(): void {
    if (this.current !== "reserved") throw new StoreError("INTERNAL_ERROR", "provider contact requires an owned reservation");
    this.current = "provider-contact-started";
  }
  settle(outcome: "completed" | "cancelled" | "unknown"): void {
    if (this.current !== "reserved" && this.current !== "provider-contact-started")
      throw new StoreError("INTERNAL_ERROR", "inference call cannot settle twice");
    this.current = outcome === "unknown" ? "unknown" : "settled";
  }
}

export function reportedUnits(data: unknown): number | null {
  if (typeof data === "number" && Number.isSafeInteger(data) && data >= 0) return data;
  if (typeof data === "object" && data !== null && "reportedUnits" in data) {
    const value = data.reportedUnits;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}
/** No payload, token stream or unpinned provider fields enter the usage ledger. */
export function accountingDetails(data: unknown): Json | null {
  return data !== null && typeof data === "object" && !Array.isArray(data) ? {} : null;
}
