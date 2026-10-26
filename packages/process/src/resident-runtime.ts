/** Memory-only Resident coordination. Ledger facts and authorization remain
 * with their feature owners; this owner holds execution, hints and backoff. */
import type { ExecutionScopePin, ExecutionObservation } from "@oma/contracts/runtime";
import { StoreError } from "@oma/domain/errors";
import type { ExecutionTicket } from "./owned-execution.js";
import { ResidentSupervisor } from "./resident-supervisor.js";

export interface ResidentReferences { readonly profile: string; readonly modelProfile: string }
export interface ResidentRuntimePorts<Witness> {
  references(actor: string): ResidentReferences;
  incarnation(actor: string): number | null;
  begin(actor: string, references: ResidentReferences, authorize: () => void,
    prepared: (execution: string, witness: Witness) => void, signal: AbortSignal): Promise<ExecutionTicket<Witness>>;
  confirmDead(actor: string): boolean;
  revoke(actor: string): void;
  hint(): void;
  failure(error: unknown): void;
}
interface Resident<Witness> {
  wake: boolean;
  readonly starts: number[];
  failures: number;
  retryAt: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  starting: Promise<void> | null;
  stopping: Promise<void> | null;
  ticket: ExecutionTicket<Witness> | null;
  witness: Witness | null;
  observation: ExecutionObservation;
  uncertain: boolean;
}
const idle = (): ExecutionObservation => ({ activeState: "inactive", subState: "dead", result: "success",
  execMainStatus: 0, invocationId: "", scope: "" });

export class ResidentRuntime<Witness> {
  private readonly residents = new Map<string, Resident<Witness>>();
  private readonly supervisor: ResidentSupervisor<ExecutionObservation>;
  private closing: Promise<void> | null = null;
  constructor(private readonly ports: ResidentRuntimePorts<Witness>, private readonly now: () => number = () => performance.now()) {
    this.supervisor = new ResidentSupervisor({
      assertStartOwner: actor => { this.ports.references(actor); },
      observe: actor => this.observe(actor),
      repairStartFailure: actor => {
        const record = this.record(actor); record.starts.length = 0; record.failures = 0;
        this.cancelRetry(record); record.observation = { ...record.observation, result: "success" };
      },
      enableWake: actor => { this.record(actor).wake = true; },
      launch: (actor, authorize) => this.launch(actor, authorize),
      disableWake: actor => { const record = this.record(actor); record.wake = false; this.cancelRetry(record); },
      revoke: actor => this.ports.revoke(actor),
      terminate: actor => this.terminate(actor),
      verifyWakeDisabled: actor => { if (this.record(actor).wake) throw new Error("Resident wake remains enabled"); },
      confirmDead: (actor, incarnation) => this.confirmDead(actor, incarnation),
    });
  }
  /** Accepted references are checked against their owner. No installed unit,
   * reconstructed role default or caller-supplied invocation grants authority. */
  ensureResident(actor: string, profile: string, modelProfile: string): void {
    const accepted = this.ports.references(actor);
    if (!profile || !modelProfile || accepted.profile !== profile || accepted.modelProfile !== modelProfile)
      throw new StoreError("STORE_CORRUPT", "Resident references differ from its accepted specification");
    this.record(actor);
  }
  assertResidentNamesFree(actor: string): void {
    // Names are local actor slots. The ledger owns actor uniqueness; an
    // unresolved scope cannot be replaced by another owner of that slot.
    const record = this.residents.get(actor);
    if (record && (record.starting !== null || record.stopping !== null || record.uncertain || record.ticket !== null && record.ticket.population() !== "empty"))
      throw new StoreError("AGENT_CONFLICT", "Resident execution slot is still owned");
  }
  start(actor: string, explicitRepair: boolean, authorize: () => void = () => {}): Promise<void> {
    if (this.closing !== null) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "Resident owner is closing"));
    return this.supervisor.start(actor, explicitRepair, authorize);
  }
  /** Join hints, execution and diagnostic resources before ledger closure. */
  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closing = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([...this.residents.keys()].map(async actor => {
        const incarnation = this.ports.incarnation(actor);
        if (incarnation === null) throw new StoreError("RUN_TERMINATION_UNKNOWN", "Resident incarnation is unobserved during close");
        await this.stop(actor, incarnation);
      }));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Resident close remains unconfirmed");
    });
    return this.closing;
  }
  stop(actor: string, incarnation: number): Promise<ExecutionObservation> {
    const current = this.ports.incarnation(actor);
    if (current !== incarnation) {
      if (current !== null && incarnation < current && this.confirmDead(actor, incarnation)) return Promise.resolve(this.observe(actor));
      return Promise.reject(new StoreError("STALE_RUN", "a previous stop cannot terminate a later Resident incarnation"));
    }
    return this.supervisor.stop(actor, incarnation);
  }
  observe(actor: string): ExecutionObservation {
    const record = this.residents.get(actor);
    if (!record) return this.ports.confirmDead(actor) ? idle() : { ...idle(), activeState: "unknown", result: "unknown" };
    if (record.uncertain || record.ticket !== null && record.ticket.population() === "unknown")
      return { ...record.observation, activeState: "unknown", result: "unknown" };
    return { ...record.observation };
  }
  observeAsync(actor: string): Promise<ExecutionObservation> { return Promise.resolve(this.observe(actor)); }
  observeStatus(actors: readonly string[]): Promise<ReadonlyMap<string, ExecutionObservation | "no-unit">> {
    const result = new Map<string, ExecutionObservation | "no-unit">();
    for (const actor of actors) {
      const record = this.residents.get(actor);
      // A recovered empty slot proves absence of an execution, not exit 0.
      // Keep the internal idle observation for coordination, while the view
      // distinguishes it from an execution whose outcome was observed.
      const neverExecuted = !record || record.ticket === null && record.witness === null &&
        record.starting === null && record.stopping === null && !record.uncertain && record.observation.invocationId === "";
      result.set(actor, neverExecuted && this.ports.confirmDead(actor) ? "no-unit" : this.observe(actor));
    }
    return Promise.resolve(result);
  }
  confirmDead(actor: string, incarnation: number): boolean {
    const current = this.ports.incarnation(actor), record = this.residents.get(actor);
    return current !== null && Number.isSafeInteger(incarnation) && incarnation >= 0 && incarnation <= current &&
      !record?.uncertain && record?.starting == null && record?.stopping == null && this.ports.confirmDead(actor);
  }
  startLimitStatus(actor: string): string | null { return this.supervisor.startLimitStatus(actor); }
  restartDue(actor: string): boolean {
    const record = this.residents.get(actor);
    return record !== undefined && record.wake && record.retryAt !== null && this.now() >= record.retryAt &&
      !record.uncertain && record.starting === null && record.stopping === null && this.ports.confirmDead(actor);
  }
  witness(actor: string): Witness | null { return this.residents.get(actor)?.witness ?? null; }
  /** A borrowed observation capability. The execution owner retains its kernel
   * handles through actual death; closing this view never releases that owner. */
  pin(scope: string): ExecutionScopePin {
    const record = [...this.residents.values()].find(value => value.observation.scope === scope);
    if (!record?.ticket || record.uncertain) throw new StoreError("AUTH_FAILED", "execution scope is not owned");
    const ticket = record.ticket; let closed = false;
    return Object.freeze({ identity: ticket.witness,
      population: () => closed || record.uncertain ? "unknown" : ticket.population(),
      matches: (current: string) => !closed && !record.uncertain && current === scope && record.ticket === ticket,
      close: () => { closed = true; },
    });
  }
  private record(actor: string): Resident<Witness> {
    let record = this.residents.get(actor);
    if (!record) {
      record = { wake: false, starts: [], failures: 0, retryAt: null, timer: null, abort: null,
        starting: null, stopping: null, ticket: null, witness: null, observation: idle(), uncertain: false };
      this.residents.set(actor, record);
    }
    return record;
  }
  private cancelRetry(record: Resident<Witness>): void {
    if (record.timer !== null) clearTimeout(record.timer);
    record.timer = null; record.retryAt = null;
  }
  private launch(actor: string, authorize: () => void): Promise<void> {
    const record = this.record(actor);
    if (record.starting !== null) return record.starting;
    if (record.stopping !== null || record.uncertain) return Promise.reject(new StoreError("RUN_TERMINATION_UNKNOWN", "Resident is stopping or uncertain"));
    if (record.retryAt !== null && this.now() < record.retryAt)
      return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "Resident restart backoff has not elapsed"));
    if (record.ticket !== null && record.ticket.population() === "populated") { authorize(); return Promise.resolve(); }
    const references = this.ports.references(actor);
    if (!this.ports.confirmDead(actor)) return Promise.reject(new StoreError("RUN_TERMINATION_UNKNOWN", "previous Resident scope has not ended"));
    const now = this.now();
    while (record.starts.length && now - record.starts[0]! > 60_000) record.starts.shift();
    if (record.starts.length >= 5) {
      this.cancelRetry(record); record.observation = { ...record.observation, activeState: "failed", subState: "failed", result: "start-limit-hit" };
      return Promise.reject(new StoreError("START_LIMIT", `start limit reached for ${actor}`));
    }
    this.cancelRetry(record); record.starts.push(now);
    const abort = new AbortController(); record.abort = abort;
    record.observation = { ...record.observation, activeState: "activating", subState: "start", result: "success" };
    const task = this.ports.begin(actor, references, authorize, (execution, witness) => {
      record.witness = witness;
      record.observation = { ...record.observation, invocationId: execution.replaceAll("-", ""), scope: execution };
    }, abort.signal).then(ticket => {
      record.ticket = ticket;
      record.observation = { ...record.observation, activeState: "active", subState: "running" };
      void ticket.completion.then(result => {
        if (record.ticket !== ticket) return;
        const success = result.kind === "exited" && result.exitCode === 0;
        record.observation = { ...record.observation, activeState: success ? "inactive" : "failed", subState: success ? "dead" : "failed",
          result: success ? "success" : result.kind, execMainStatus: result.exitCode ?? -1 };
        if (success) { record.failures = 0; if (record.wake) this.ports.hint(); }
        else this.retry(record);
      }, error => {
        record.uncertain = true;
        record.observation = { ...record.observation, activeState: "unknown", subState: "unknown", result: "unknown", execMainStatus: -1 };
        this.cancelRetry(record); this.ports.failure(error);
      });
    }, error => {
      record.observation = { ...record.observation, activeState: this.ports.confirmDead(actor) ? "failed" : "unknown", result: "launch-failed", subState: "failed" };
      record.uncertain = !this.ports.confirmDead(actor);
      if (!record.uncertain) this.retry(record);
      throw error;
    }).finally(() => { if (record.starting === task) record.starting = null; });
    record.starting = task; return task;
  }
  private retry(record: Resident<Witness>): void {
    if (!record.wake || record.uncertain) return;
    // The former Resident contract: 3 s, four geometric steps to 12 s,
    // five starts in a 60 s memory-only window. A timer is only a hint.
    const delay = 3000 * 4 ** (Math.min(record.failures++, 4) / 4);
    record.retryAt = this.now() + delay;
    record.timer = setTimeout(() => { record.timer = null; if (record.wake) this.ports.hint(); }, delay);
  }
  private terminate(actor: string): Promise<void> {
    const record = this.record(actor);
    if (record.stopping !== null) return record.stopping;
    record.abort?.abort();
    const task = (async () => {
      if (record.starting !== null) try { await record.starting; } catch { /* actual scope proof below */ }
      if (record.ticket !== null) {
        await record.ticket.stop();
        // Includes diagnostic flush/FD closure. Its failure is recorded by the
        // completion observer; death is independently checked below.
        try { await record.ticket.completion; } catch { /* outcome remains unknown; resources settled */ }
      }
      if (!this.ports.confirmDead(actor)) throw new StoreError("RUN_TERMINATION_UNKNOWN", "Resident scope termination is not confirmed");
      record.uncertain = false;
      record.observation = { ...record.observation, activeState: "inactive", subState: "dead" };
    })().finally(() => { if (record.stopping === task) record.stopping = null; });
    record.stopping = task; return task;
  }
}
