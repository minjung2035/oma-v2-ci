// AUTH-003/RUN-001: a pathname or dead connector is not proof that a run is dead.
import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Actor, RunLease } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { parseCgroupPopulation } from "../units/observe.js";
import type { SettlementQuiescence } from "../mail/batches.js";

export interface CgroupIdentity { readonly dev: bigint; readonly ino: bigint }
export type Population = "empty" | "populated" | "removed" | "unknown";
export interface CgroupPin {
  readonly fd: number;
  readonly identity: CgroupIdentity;
  population(): Population;
  matches(path: string): boolean;
  close(): void;
}
export interface RunIdentity {
  readonly actor: Actor;
  readonly incarnation: number;
  readonly invocationId: string;
  readonly cgroupIdentity: CgroupIdentity;
}
export interface RunEndpoint { readonly socketHostPath: string; done(): void }
export type RunPhase = "opening" | "live" | "revoked-awaiting-death" | "closed";
type RunState =
  | { readonly phase: "opening" }
  | { readonly phase: "live"; readonly lease: RunLease; readonly endpoint: RunEndpoint }
  | { readonly phase: "revoked-awaiting-death" }
  | { readonly phase: "closed" };

/** Native owner. ENOENT alone is not evidence: the pinned directory must be removed. */
export function pinCgroup(path: string): CgroupPin {
  if (!path.startsWith("/") || path === "/" || path.includes("\0") || path.split("/").some(part => part === "." || part === ".."))
    throw new StoreError("AUTH_FAILED", "invalid observed cgroup path");
  const fd = openSync(join("/sys/fs/cgroup", path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let closed = false;
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isDirectory()) throw new StoreError("AUTH_FAILED", "cgroup pin is not a directory");
    const identity = Object.freeze({ dev: st.dev, ino: st.ino });
    return {
      fd, identity,
      population() {
        if (closed) return "unknown";
        try { return parseCgroupPopulation(readFileSync(`/proc/self/fd/${fd}/cgroup.events`, "utf8")); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
          try { return fstatSync(fd, { bigint: true }).nlink === 0n ? "removed" : "unknown"; }
          catch { return "unknown"; }
        }
      },
      matches(currentPath) {
        if (closed) return false;
        try {
          const current = statSync(join("/sys/fs/cgroup", currentPath), { bigint: true });
          const pinned = fstatSync(fd, { bigint: true });
          return current.isDirectory() && pinned.isDirectory() && pinned.nlink > 0n &&
            current.dev === identity.dev && current.ino === identity.ino &&
            pinned.dev === identity.dev && pinned.ino === identity.ino;
        } catch { return false; }
      },
      close() { if (!closed) { closed = true; closeSync(fd); } },
    };
  } catch (error) { closeSync(fd); throw error; }
}

/** Owns the cgroup FD from opening through revoked-awaiting-death. */
export class OwnedRun {
  private state: RunState = { phase: "opening" };
  readonly identity: RunIdentity;
  constructor(actor: Actor, incarnation: number, invocationId: string, private readonly pin: CgroupPin) {
    this.identity = Object.freeze({ actor, incarnation, invocationId, cgroupIdentity: pin.identity });
  }
  get phase(): RunPhase { return this.state.phase; }
  get invocationId(): string { return this.identity.invocationId; }
  get cgroupFd(): number { return this.pin.fd; }
  get lease(): RunLease | null { return this.state.phase === "live" ? this.state.lease : null; }
  population(): Population { return this.state.phase === "closed" ? "unknown" : this.pin.population(); }
  matches(path: string): boolean { return this.state.phase === "live" && this.pin.matches(path); }
  publish(endpoint: RunEndpoint): RunLease {
    if (this.state.phase !== "opening") {
      endpoint.done();
      throw new StoreError("STALE_RUN", "run endpoint cannot be published twice");
    }
    const lease = Object.freeze({ actor: this.identity.actor, incarnation: this.identity.incarnation, socketHostPath: endpoint.socketHostPath });
    this.state = { phase: "live", lease, endpoint };
    return lease;
  }
  revoke(): void {
    if (this.state.phase === "closed" || this.state.phase === "revoked-awaiting-death") return;
    const previous = this.state;
    this.state = { phase: "revoked-awaiting-death" };
    if (previous.phase === "live") previous.endpoint.done();
  }
  done(): void {
    if (this.state.phase === "closed") return;
    const previous = this.state;
    this.state = { phase: "closed" };
    try { if (previous.phase === "live") previous.endpoint.done(); }
    finally { this.pin.close(); }
  }
}

/** One registry owns each run pin; connection pidfds remain with SharedPeerPin. */
export class RunRegistry {
  private readonly records = new Map<Actor, OwnedRun>();
  constructor(private readonly acquire: (path: string) => CgroupPin = pinCgroup) {}
  get(actor: Actor): OwnedRun | undefined { return this.records.get(actor); }
  values(): IterableIterator<OwnedRun> { return this.records.values(); }
  begin(actor: Actor, incarnation: number, invocationId: string, cgroup: string): OwnedRun {
    const previous = this.records.get(actor);
    if (previous?.invocationId === invocationId)
      throw new StoreError("STALE_RUN", "an invocation cannot acquire a second run identity");
    if (!Number.isSafeInteger(incarnation) || incarnation < 1)
      throw new StoreError("STORE_CORRUPT", "invalid next incarnation");
    if (previous && !["empty", "removed"].includes(previous.population()))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous invocation cgroup is not proven empty");
    const pin = this.acquire(cgroup);
    if (pin.population() !== "populated" || !pin.matches(cgroup)) {
      pin.close();
      throw new StoreError("AUTH_FAILED", "current runner cgroup is not proven populated");
    }
    const record = new OwnedRun(actor, incarnation, invocationId, pin);
    // Publish the fence before any endpoint/transaction callback can fail.
    this.records.set(actor, record);
    try { previous?.done(); }
    catch (error) { record.revoke(); throw error; }
    return record;
  }
  /** D01/BATCH-004: while `actor`'s next run is opening, `begin` has proven its
   * previous invocation's cgroup empty or removed (or this broker has run none
   * since its startup quiesced every unit), and the next run has no endpoint.
   * That is the only authority to settle the previous incarnation's receipts,
   * and it ends when the run is published, revoked or replaced. */
  settlementQuiescence(actor: Actor): SettlementQuiescence {
    const record = this.records.get(actor);
    if (!record || record.phase !== "opening")
      throw new StoreError("STALE_RUN", "no opening run holds receipt settlement authority");
    const confirm = (): void => {
      if (this.records.get(actor) !== record || record.phase !== "opening")
        throw new StoreError("STALE_RUN", "receipt settlement authority ended with its opening run");
    };
    return Object.freeze({ actor, incarnation: record.identity.incarnation - 1, confirm });
  }
  close(): void {
    let failed: unknown;
    for (const record of this.records.values()) {
      try { record.done(); } catch (error) { failed ??= error; }
    }
    if (failed !== undefined) throw failed;
  }
}
