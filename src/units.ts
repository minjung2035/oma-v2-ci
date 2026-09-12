// MUST [UNIT-001..007]: fixed unit coordination; command outcomes are not physical proof.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, ResourceLimits, UnitObservation } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { unitNameFor as unitName } from "./domain/derived.js";
import { replaceDerivedFile } from "./storage/durable-fs.js";
import { renderUnit, type RenderValues } from "./units/render.js";
import { executeUnitCommand, observeUnitCommand, type UnitCommandOutcome } from "./units/execute.js";
import { parseUnitObservation, parseCgroupPopulation, parseCgroupProcs } from "./units/observe.js";

export { unitName, renderUnit };
export type { RenderValues, UnitCommandOutcome };
export const UNIT_TPL_DIR = fileURLToPath(new URL("../../implementation/systemd", import.meta.url));
export const INSTALL_DIR = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/tmp", ".config"), "systemd", "user");
export type IncarnationReader = (agent: Actor) => number | null;

export class UnitsModule {
  onRevokeRun: ((agent: Actor) => void) | undefined;
  private incarnationOf: IncarnationReader | null;
  private observationTask: { readonly agent: Actor; readonly task: Promise<UnitObservation> } | null = null;
  constructor(
    private readonly society: string,
    private readonly values: RenderValues,
    private readonly installDir: string = INSTALL_DIR,
    private readonly profiles: Readonly<Record<string, ResourceLimits>> = {},
    incarnationOf: IncarnationReader | null = null,
  ) { this.incarnationOf = incarnationOf; }

  /** The lifecycle's durable Store reader deliberately replaces any constructor reader. */
  bindIncarnationReader(reader: IncarnationReader): void { this.incarnationOf = reader; }

  private command(argv: readonly string[]): UnitCommandOutcome {
    return executeUnitCommand("systemctl", ["--user", ...argv]);
  }

  private run(argv: readonly string[]): string {
    const outcome = this.command(argv);
    if (outcome.kind === "unknown")
      throw new StoreError("UNSUPPORTED_PROFILE", `systemctl outcome unknown for ${argv[0] ?? "operation"}`);
    if (outcome.kind === "failed")
      throw new StoreError(/start-limit/i.test(outcome.stdout + outcome.stderr) ? "START_LIMIT" : "INTERNAL_ERROR", `systemctl ${argv[0] ?? "operation"} failed`);
    return outcome.stdout.trim();
  }

  private install(name: string, templateName: string, overrides: Partial<RenderValues> = {}): void {
    const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, templateName), "utf8"), {
      ...this.values, ...overrides, agent: this.agentFrom(name),
    });
    const target = join(this.installDir, name);
    replaceDerivedFile(target, rendered, 0o600);
    const linked = this.command(["link", target]);
    if (linked.kind === "unknown" || (linked.kind === "failed" && !/already|exists/i.test(linked.stdout + linked.stderr)))
      throw new StoreError("INTERNAL_ERROR", `systemctl link not confirmed for ${name}`);
    this.run(["daemon-reload"]);
    if (this.run(["show", name, "--property=LoadState", "--value"]) !== "loaded")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit did not load: ${name}`);
    const fragment = this.run(["show", name, "--property=FragmentPath", "--value"]);
    if (!fragment || realpathSync(fragment) !== realpathSync(target) || this.run(["show", name, "--property=DropInPaths", "--value"]) !== "")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit source differs from rendered contract: ${name}`);
    for (const [property, expected] of [["MemoryMax", overrides.memoryBytes], ["TasksMax", overrides.tasks]] as const) {
      if (expected !== undefined && this.run(["show", name, `--property=${property}`, "--value"]) !== String(expected))
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective ${property} mismatch`);
    }
    if (overrides.cpuQuotaPercent !== undefined) {
      const cpu = this.run(["show", name, "--property=CPUQuotaPerSecUSec", "--value"]);
      const parsed = executeUnitCommand("systemd-analyze", ["timespan", cpu]);
      const micros = /^\s*(?:μs|Microseconds):\s*(\d+)$/m.exec(parsed.stdout);
      if (parsed.kind !== "succeeded" || !micros || Number(micros[1]) !== overrides.cpuQuotaPercent * 10000)
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective CPU quota mismatch`);
    }
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path|timer)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor, profile?: string, frozen?: ResourceLimits): void {
    const resources = frozen ?? (profile ? this.profiles[profile] : undefined);
    if (!profile || !resources)
      throw new StoreError("UNSUPPORTED_PROFILE", `resident profile missing or unsupported for ${agent}`);
    this.install(unitName(this.society, agent, "service"), "resident.service.in", {
      profileHex: Buffer.from(profile, "utf8").toString("hex"),
      memoryBytes: resources.memoryBytes, tasks: resources.tasks, cpuQuotaPercent: resources.cpuQuotaPercent,
    });
    this.install(unitName(this.society, agent, "path"), "resident.path.in");
  }
  ensureBroker(): void { this.install(unitName(this.society, "broker", "service"), "broker.service.in"); }
  ensurePrincipal(): void {
    this.install(unitName(this.society, "principal", "path"), "principal.path.in");
    this.install(unitName(this.society, "principal-relay", "service"), "principal-relay.service.in");
  }
  ensureReconcile(): void {
    this.install(unitName(this.society, "reconcile", "service"), "reconcile.service.in");
    this.install(unitName(this.society, "reconcile", "timer"), "reconcile.timer.in");
  }

  private verifyPath(agent: Actor, active: boolean): void {
    const path = unitName(this.society, agent, "path");
    const state = this.run(["show", path, "--property=ActiveState", "--value"]);
    const enabled = this.run(["show", path, "--property=UnitFileState", "--value"]);
    const expected = active ? ["enabled", "enabled-runtime"] : ["disabled", "linked", "linked-runtime", "static"];
    const absent = !active && enabled === "" && !this.run(["list-unit-files", "--no-legend", "--no-pager"]).split("\n")
      .some((line) => line.trim().split(/\s+/)[0] === path);
    if (state !== (active ? "active" : "inactive") || (!expected.includes(enabled) && !absent))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `activation state not confirmed for ${agent}`);
  }

  start(agent: Actor, explicitRepair: boolean): void {
    const before = this.observe(agent);
    const service = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    if (explicitRepair) this.run(["reset-failed", service]);
    this.run(["enable", "--now", join(this.installDir, path)]);
    this.verifyPath(agent, true);
    this.run(["start", service]);
    const after = this.observe(agent);
    const exited = before.activeState !== "unknown" && after.activeState === "inactive" && after.result === "success" && after.execMainStatus === 0 &&
      /^[0-9a-f]{32}$/.test(after.invocationId ?? "") && after.invocationId !== before.invocationId;
    if (!["active", "activating"].includes(after.activeState) && !exited)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `service activation not observed for ${agent}`);
  }

  stop(agent: Actor, incarnation: number): UnitObservation {
    const service = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    const failures: unknown[] = [];
    const missing = (unit: string): boolean => {
      const outcome = this.command(["show", unit, "--property=LoadState", "--value"]);
      return outcome.kind === "succeeded" && outcome.stdout.trim() === "not-found";
    };
    for (const action of [
      () => { if (!missing(path)) this.run(["stop", path]); },
      () => { if (!missing(path)) this.run(["disable", path]); },
      () => this.onRevokeRun?.(agent),
      () => { if (!missing(service)) this.run(["stop", service]); },
      () => this.verifyPath(agent, false),
    ]) {
      try { action(); } catch (error) { failures.push(error); }
    }
    const observed = this.observe(agent);
    const dead = this.confirmDead(agent, incarnation);
    if (failures.length > 0 || !dead)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `unit stop or descendant death not confirmed for ${agent}`);
    return observed;
  }

  unitCgroup(kind: "principal-relay" | "reconcile"): string {
    const outcome = this.command(["show", unitName(this.society, kind, "service"), "-p", "ControlGroup"]);
    if (outcome.kind !== "succeeded") return "";
    const lines = outcome.stdout.trim().split("\n");
    return lines.length === 1 && lines[0]!.startsWith("ControlGroup=/") ? lines[0]!.slice("ControlGroup=".length) : "";
  }

  private observationArgs(agent: Actor): readonly string[] {
    return ["show", unitName(this.society, agent, "service"),
      "-p", "ActiveState", "-p", "SubState", "-p", "Result", "-p", "ExecMainStatus", "-p", "ControlGroup", "-p", "InvocationID"];
  }
  observe(agent: Actor): UnitObservation {
    return parseUnitObservation(this.command(this.observationArgs(agent)));
  }
  /** Recovery diagnostics only. Never use this stale-able result as death proof.
   * One outstanding observation; no array of queued show commands is retained.
   */
  observeAsync(agent: Actor): Promise<UnitObservation> {
    if (this.observationTask) return this.observationTask.agent === agent ? this.observationTask.task :
      Promise.reject(new StoreError("BROKER_UNAVAILABLE", "unit observation is busy"));
    const task = observeUnitCommand(["--user", ...this.observationArgs(agent)]).then(parseUnitObservation)
      .finally(() => { if (this.observationTask?.task === task) this.observationTask = null; });
    this.observationTask = { agent, task }; return task;
  }

  /** Diagnostic API. Read failure throws rather than pretending the cgroup is empty. */
  cgroupProcs(agent: Actor): number[] {
    const observation = this.observe(agent);
    if (observation.activeState === "unknown")
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "cgroup observation unavailable");
    if (!observation.cgroup) {
      if (["inactive", "failed"].includes(observation.activeState)) return [];
      throw new StoreError("RUN_TERMINATION_UNKNOWN", "active unit has no observed cgroup");
    }
    try {
      const pids = parseCgroupProcs(readFileSync(join("/sys/fs/cgroup", observation.cgroup, "cgroup.procs"), "utf8"));
      if (pids !== null) return pids;
    } catch { /* Unknown is distinct from a successfully read empty file. */ }
    throw new StoreError("RUN_TERMINATION_UNKNOWN", "cgroup process list unavailable or malformed");
  }

  confirmDead(agent: Actor, incarnation: number): boolean {
    if (!Number.isSafeInteger(incarnation) || incarnation < 0) return false;
    try {
      const current = this.incarnationOf?.(agent) ?? null;
      if (current === null || !Number.isSafeInteger(current) || current < 0 || incarnation > current) return false;
      const before = this.observe(agent);
      if (!["inactive", "failed"].includes(before.activeState)) return false;
      if (before.cgroup) {
        try {
          if (parseCgroupPopulation(readFileSync(join("/sys/fs/cgroup", before.cgroup, "cgroup.events"), "utf8")) !== "empty") return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
        }
      }
      const after = this.observe(agent);
      return this.incarnationOf?.(agent) === current && before.activeState === after.activeState &&
        before.cgroup === after.cgroup && before.invocationId === after.invocationId &&
        before.execMainStatus === after.execMainStatus && before.result === after.result;
    } catch { return false; }
  }

  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    return obs.activeState === "failed" && obs.result === "start-limit-hit" ? "start_limit" : null;
  }
}
