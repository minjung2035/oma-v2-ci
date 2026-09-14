import { StoreError } from "./errors.js";

/** A process-local acceptance fence. Read diagnostics and already-accepted
 * settlement are separate from permission to create another durable intent.
 */
export class AdmissionGate {
  private corrupt = false;
  private draining = false;
  observe(error: unknown): void {
    if (error instanceof StoreError && error.code === "STORE_CORRUPT") this.corrupt = true;
  }
  close(): void { this.draining = true; }
  assertAdmission(): void {
    if (this.corrupt) throw new StoreError("STORE_CORRUPT", "new acceptance is fenced after durable corruption");
    if (this.draining) throw new StoreError("BROKER_UNAVAILABLE", "broker admission is draining");
  }
  get state(): "healthy" | "corrupt" | "draining" { return this.corrupt ? "corrupt" : this.draining ? "draining" : "healthy"; }
}
const owners = new WeakMap<object, AdmissionGate>();
export function bindAdmissionGate(owner: object, gate: AdmissionGate): void {
  const previous = owners.get(owner);
  if (previous && previous !== gate) throw new StoreError("BROKER_UNAVAILABLE", "another broker already owns this store in this process");
  owners.set(owner, gate);
}
export function assertNewAcceptance(owner: object): void { owners.get(owner)?.assertAdmission(); }
export function observeStoreFailure(owner: object, error: unknown): void { owners.get(owner)?.observe(error); }
