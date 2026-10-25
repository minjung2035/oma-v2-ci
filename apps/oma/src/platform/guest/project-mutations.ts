import { StoreError } from "@oma/domain/errors";

/** One mirror writer/startup at a time. Queued work counts as owned work;
 * maintenance admission is synchronous and never races an await. */
export class ProjectMutations {
  private readonly queued = new Map<string, Promise<unknown>>();
  private maintained = false;
  private global = false;
  get active(): boolean { return this.queued.size > 0 || this.global; }
  setMaintenance(active: boolean): void { this.maintained = active; }

  /** Package publication updates every project's roles, so it conflicts
   * with all mirror/start/archive scopes, including an unbound archive. */
  async runGlobal<T>(run: () => Promise<T>): Promise<T> {
    if (this.maintained || this.active) throw new StoreError("BROKER_UNAVAILABLE", "a project operation or maintenance is active; retry shortly");
    this.global = true;
    try { return await run(); }
    finally { this.global = false; }
  }

  async run<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    if (this.maintained) throw new StoreError("BROKER_UNAVAILABLE", "the engine is being maintained; retry shortly");
    if (this.global) throw new StoreError("BROKER_UNAVAILABLE", "packages are being changed; retry shortly");
    const before = this.queued.get(projectId) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(run);
    this.queued.set(projectId, next);
    try { return await next; }
    finally { if (this.queued.get(projectId) === next) this.queued.delete(projectId); }
  }
}
