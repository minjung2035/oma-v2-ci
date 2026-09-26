// MUST [UNIT-001..007]: fixed unit coordination; command outcomes are not physical proof.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, ResourceLimits, UnitObservation } from "../implementation/contracts.js";
import { StoreError, unobserved } from "./domain/errors.js";
import { canonicalResourceLimits } from "./domain/resources.js";
import { unitNameFor as unitName } from "./domain/derived.js";
import { replaceDerivedFile } from "./storage/durable-fs.js";
import { renderUnit, type RenderValues } from "./units/render.js";
import { executeUnitCommand, observeUnitCommand, type UnitCommandOutcome } from "./units/execute.js";
import { parseProperties, parseUnitObservation, parseCgroupPopulation, parseCgroupProcs } from "./units/observe.js";

export { unitName, renderUnit };
export type { RenderValues, UnitCommandOutcome };
export const UNIT_TPL_DIR = fileURLToPath(new URL("../../implementation/systemd", import.meta.url));
export const INSTALL_DIR = join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/tmp", ".config"), "systemd", "user");
/** The line of a unit that names what it was rendered for (P0V-26). */
function identityLine(unit: string): string | null {
  return unit.split("\n").find(line => line.startsWith("Description=")) ?? null;
}
export type IncarnationReader = (agent: Actor) => number | null;
/** Units per status `show`: about 60 ms each on systemd 257 (WP23.01). */
export const STATUS_CHUNK = 32;

/** The words of a rendered ExecStart as `systemctl show` reports them: the
 * renderer escapes every separator inside a value, so a space separates words;
 * the manager has undone C escapes and specifiers, while `$$` stays until the
 * command is executed (observed on systemd 257). */
export function renderedExecArgv(rendered: string): string[] | null {
  const line = /^ExecStart=(.*)$/m.exec(rendered)?.[1];
  if (line === undefined) return null;
  return line.split(" ").filter(word => word !== "").map(word =>
    word.replace(/\\x([0-9a-f]{2})|%%/g, (match, hex: string | undefined) =>
      hex !== undefined ? String.fromCharCode(parseInt(hex, 16)) : "%"));
}

/** DR13, P0-5: the one reading of a unit command that did not succeed. A
 * command that did not finish -- timed out, killed, never spawned -- has an
 * unknown outcome, DEADLINE_EXCEEDED, which a caller looks up again; it is not
 * a platform that cannot run the profile (UNSUPPORTED_PROFILE is for what is
 * known to be unsupported). A command that finished and failed says so. */
export function unitCommandError(outcome: UnitCommandOutcome, what: string): StoreError | null {
  switch (outcome.kind) {
    case "succeeded": return null;
    case "unknown": return new StoreError("DEADLINE_EXCEEDED", `systemctl ${what} did not finish; its outcome is unknown`);
    case "failed":
      return new StoreError(/start-limit/i.test(outcome.stdout + outcome.stderr) ? "START_LIMIT" : "INTERNAL_ERROR", `systemctl ${what} failed`);
  }
}

/** D03: every unit effect goes through the user manager this process can
 * reach. A broker whose environment reaches none (a runtime directory that is
 * not the manager's, no user bus) supports no Resident activation, and says so
 * before it opens its Store rather than failing mid-recovery. */
export function assertUserManagerReachable(): void {
  const outcome = executeUnitCommand("systemctl", ["--user", "show", "--property=Version", "--value"]);
  if (outcome.kind === "unknown") throw unitCommandError(outcome, "show")!;
  if (outcome.kind !== "succeeded" || outcome.stdout.trim() === "")
    throw new StoreError("UNSUPPORTED_PROFILE", "the systemd user manager is not reachable from this broker's environment");
}

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
  /** Read-only `show` off the event loop; the one asynchronous unit seam. */
  private commandAsync(argv: readonly string[]): Promise<UnitCommandOutcome> {
    return observeUnitCommand(["--user", ...argv]);
  }

  private run(argv: readonly string[]): string {
    const outcome = this.command(argv);
    const error = unitCommandError(outcome, argv[0] ?? "operation");
    if (error) throw error;
    return outcome.stdout.trim();
  }

  private install(name: string, templateName: string, overrides: Partial<RenderValues> = {}): void {
    const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, templateName), "utf8"), {
      ...this.values, ...overrides, agent: this.agentFrom(name),
    });
    const target = join(this.installDir, name);
    this.assertOwnUnit(name, identityLine(rendered));
    replaceDerivedFile(target, rendered, 0o600);
    const linked = this.command(["link", target]);
    if (linked.kind === "unknown") throw unitCommandError(linked, `link ${name}`)!;
    if (linked.kind === "failed" && !/already|exists/i.test(linked.stdout + linked.stderr))
      throw new StoreError("INTERNAL_ERROR", `systemctl link not confirmed for ${name}`);
    this.run(["daemon-reload"]);
    if (this.run(["show", name, "--property=LoadState", "--value"]) !== "loaded")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit did not load: ${name}`);
    const fragment = this.run(["show", name, "--property=FragmentPath", "--value"]);
    if (!fragment || realpathSync(fragment) !== realpathSync(target) || this.run(["show", name, "--property=DropInPaths", "--value"]) !== "")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit source differs from rendered contract: ${name}`);
    // D03/WP03.04: the argv the manager will execute is the rendered one. A
    // quoting or specifier the manager reads differently would hand a runner a
    // location the broker never resolved.
    const exec = renderedExecArgv(rendered);
    if (exec !== null) {
      const effective = /(?:^|\s)argv\[\]=(.*?) ; ignore_errors=/.exec(this.run(["show", name, "--property=ExecStart", "--value"]));
      if (effective?.[1] !== exec.join(" "))
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective ExecStart differs from its rendered argv`);
    }
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

  /** P0V-26, P0-1: a unit file under this name that was rendered for another
   * society, kind or agent is that other owner's installed fact, and it is
   * refused rather than replaced. UNIT-001 joins society and actor with "-",
   * and both may contain one, so one name can be two owners' ("oma-a-b-c" is
   * society a's Resident b-c and society a-b's Resident c). The rendered
   * Description names the owner -- kind, society and agent, which hold no
   * spaces -- and the same owner renders the same one again. */
  private assertOwnUnit(name: string, identity: string | null): void {
    const target = join(this.installDir, name);
    let existing: string;
    try { existing = readFileSync(target, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw unobserved(error, target) ?? error;
    }
    if (identityLine(existing) !== identity)
      throw new StoreError("AGENT_CONFLICT", `unit ${name} is installed for another society or agent; it is not replaced`);
  }

  /** Before a create is accepted: the unit names a Resident called `agent`
   * would take are not another owner's (P0V-26). */
  assertResidentNamesFree(agent: Actor): void {
    for (const [suffix, template] of [["service", "resident.service.in"], ["path", "resident.path.in"]] as const) {
      const line = identityLine(readFileSync(join(UNIT_TPL_DIR, template), "utf8"));
      this.assertOwnUnit(unitName(this.society, agent, suffix), line === null ? null : renderUnit(line, { ...this.values, agent }));
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
      resourcesHex: Buffer.from(canonicalResourceLimits(resources), "utf8").toString("hex"),
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
    // reset-failed changes one thing, a unit's failed state (a start limit
    // among it). A unit that is not failed has none to clear, and one systemd
    // has unloaded while inactive answers "not loaded": that is "nothing to
    // reset", not a failed repair (INV02). Found by the real-provider run: a
    // Resident started a while after it was created could never start.
    if (explicitRepair && before.activeState === "failed") this.run(["reset-failed", service]);
    this.run(["enable", "--now", join(this.installDir, path)]);
    this.verifyPath(agent, true);
    try { this.run(["start", service]); }
    catch (error) {
      // systemd 257 reports a start the limit refused as a failed control
      // process; the unit's own counters say what it was.
      if (this.startLimitStatus(agent) !== null) throw new StoreError("START_LIMIT", `start limit reached for ${agent}`);
      throw error;
    }
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
    const task = this.commandAsync(this.observationArgs(agent)).then(parseUnitObservation)
      .finally(() => { if (this.observationTask?.task === task) this.observationTask = null; });
    this.observationTask = { agent, task }; return task;
  }

  /** WP23/D04: display status of many units, one read-only `show` per chunk of
   * STATUS_CHUNK units, one chunk at a time. Each block is bound to its unit by
   * `Id`; a block that is missing, repeated or malformed leaves that agent
   * unknown. Never death proof or authority: an effect observes again. */
  async observeStatus(agents: readonly Actor[]): Promise<ReadonlyMap<Actor, UnitObservation | "no-unit">> {
    const observed = new Map<Actor, UnitObservation | "no-unit">();
    for (let from = 0; from < agents.length; from += STATUS_CHUNK) {
      const byUnit = new Map(agents.slice(from, from + STATUS_CHUNK).map(agent => [unitName(this.society, agent, "service"), agent] as const));
      const outcome = await this.commandAsync(["show", ...byUnit.keys(), "-p", "Id", "-p", "LoadState", ...this.observationArgs(agents[from]!).slice(2)]);
      const blocks = outcome.kind === "succeeded" ? outcome.stdout.split("\n\n") : [];
      const parsed = blocks.map(block => ({ block, agent: byUnit.get(parseProperties(block, ["Id"])?.get("Id") ?? "") }));
      const count = new Map<Actor, number>();
      for (const { agent } of parsed) if (agent !== undefined) count.set(agent, (count.get(agent) ?? 0) + 1);
      // A unit reported twice is reported by nothing that can be believed.
      for (const { block, agent } of parsed)
        // systemd answers for a unit it does not have with the values of one
        // that ran and exited cleanly; LoadState is what tells them apart.
        if (agent !== undefined && count.get(agent) === 1)
          observed.set(agent, parseProperties(block, ["LoadState"])?.get("LoadState") === "not-found"
            ? "no-unit" : parseUnitObservation({ ...outcome, stdout: block }));
    }
    return observed;
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

  /** WP25: whether systemd stopped starting this unit because of its start
   * limit. Older managers say so in Result; systemd 257 keeps the last
   * failure's Result ("exit-code") and only logs "Start request repeated too
   * quickly". A Resident unit restarts on every failure, so a failed unit
   * whose restart counter reached its burst is one the limit stopped. */
  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    if (obs.activeState !== "failed") return null;
    if (obs.result === "start-limit-hit") return "start_limit";
    const outcome = this.command(["show", unitName(this.society, agent, "service"), "-p", "NRestarts", "-p", "StartLimitBurst"]);
    if (outcome.kind !== "succeeded") return null;
    const fields = new Map(outcome.stdout.trim().split("\n").map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const));
    const restarts = Number(fields.get("NRestarts")); const burst = Number(fields.get("StartLimitBurst"));
    return Number.isSafeInteger(restarts) && Number.isSafeInteger(burst) && burst > 0 && restarts >= burst ? "start_limit" : null;
  }
}
