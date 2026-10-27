import { ResidentSupervisor } from "@oma/process/resident-supervisor";
import { withCleanup } from "@oma/native/cleanup";
// MUST [UNIT-001..007]: fixed unit coordination; command outcomes are not physical proof.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Actor, UnitObservation } from "@oma/contracts";
import { StoreError, unobserved } from "@oma/domain/errors";
import { encodedResidentToolSurface } from "@oma/domain/tool-surface";
import { unitNameFor as unitName } from "@oma/domain/derived";
import { ensureDurableDirectory, publishNoReplace, replaceDerivedFile } from "@oma/storage/durable-fs";
import { renderUnit, type RenderValues } from "./units/render.js";
import { executeUnitCommand, observeUnitCommand, type UnitCommandOutcome } from "./units/execute.js";
import { parseProperties, parseUnitObservation, parseCgroupProcs, unknownObservation } from "./units/observe.js";
import { parseCgroupPopulation } from "@oma/domain/cgroup-population";

export { unitName, renderUnit };
export type { RenderValues, UnitCommandOutcome };
export const UNIT_TPL_DIR = fileURLToPath(new URL("./systemd", import.meta.url));
/** Where the user manager takes its units from: XDG_CONFIG_HOME, else HOME's
 * .config -- resolved where it is asked for, since a constructor may run in
 * an environment that is not the module loader's. Neither set means this
 * process has no config root, and a shared /tmp guessed for one is said out
 * loud, not used. */
export function unitsInstallDir(env: NodeJS.ProcessEnv = process.env): string {
  const config = env.XDG_CONFIG_HOME;
  if (config !== undefined && config.length > 0) return join(config, "systemd", "user");
  const home = env.HOME;
  if (home === undefined || home.length === 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "neither XDG_CONFIG_HOME nor HOME is set; the user unit directory cannot be resolved");
  return join(home, ".config", "systemd", "user");
}
/** The line of a unit that names the society, the kind and the agent it was
 * rendered for (P0V-26), and the one that names the state tree (P0V-59). */
const DESCRIPTION = "Description=";
const OWNER = "X-OMA-Owner=";
function lineOf(unit: string, key: string): string | null {
  return unit.split("\n").find(line => line.startsWith(key)) ?? null;
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

/** R6-20: the one reading of `systemctl show --property=ExecStart --value`,
 * whose format is the manager's (`{ path=... ; argv[]=<words> ; ignore_errors=... }`,
 * observed on systemd 257): the words the manager will execute, or null when
 * the answer is not in that form -- which the caller refuses. */
export function effectiveExecArgv(show: string): string | null {
  return /(?:^|\s)argv\[\]=(.*?) ; ignore_errors=/.exec(show)?.[1] ?? null;
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
      return new StoreError("INTERNAL_ERROR", `systemctl ${what} failed`);
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
  private readonly supervisor: ResidentSupervisor<UnitObservation>;
  private observationTask: { readonly agent: Actor; readonly task: Promise<UnitObservation> } | null = null;
  constructor(
    private readonly society: string,
    private readonly values: RenderValues,
    private readonly installDir: string = unitsInstallDir(),
    incarnationOf: IncarnationReader | null = null,
  ) {
    this.incarnationOf = incarnationOf;
    this.supervisor = new ResidentSupervisor({
      assertStartOwner: agent => {
        if (this.residentForeign(agent))
          throw new StoreError("AGENT_CONFLICT", `the execution names of ${agent} belong to another owner`);
      },
      observe: agent => this.observe(agent),
      repairStartFailure: agent => { this.run(["reset-failed", unitName(this.society, agent, "service")]); },
      enableWake: agent => {
        this.run(["enable", "--now", join(this.installDir, unitName(this.society, agent, "path"))]);
        this.verifyPath(agent, true);
      },
      launch: agent => { this.run(["start", unitName(this.society, agent, "service")]); },
      disableWake: agent => withCleanup(
        () => this.stopOwnedUnit(agent, "path", "stop"),
        () => this.stopOwnedUnit(agent, "path", "disable")),
      revoke: agent => this.onRevokeRun?.(agent),
      terminate: agent => this.stopOwnedUnit(agent, "service", "stop"),
      verifyWakeDisabled: agent => { if (!this.residentForeign(agent)) this.verifyPath(agent, false); },
      confirmDead: (agent, incarnation) => this.confirmDead(agent, incarnation),
    });
  }

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

  private prepareUnit(name: string, templateName: string, overrides: Partial<RenderValues> = {}) {
    const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, templateName), "utf8"), {
      ...this.values, ...overrides, agent: this.agentFrom(name),
    });
    const target = join(this.installDir, name);
    // P0V-98: the first unit a user installs makes the unit directory, and
    // makes it durable, as replacing a unit always did; the no-replace claim
    // below publishes into a directory that exists.
    ensureDurableDirectory(this.installDir, 0o755);
    // P0V-59, P0-1: a free name is claimed in one step -- the whole file is
    // linked in only if no file has the name -- so two owners cannot both see
    // it free and both write it, and a crash leaves no partial unit to be
    // taken for another owner's. A name already held is replaced only by its owner.
    if (publishNoReplace(target, rendered, 0o600) === "existing") {
      this.assertOwnUnit(name, rendered);
      replaceDerivedFile(target, rendered, 0o600);
    }
    return { name, target, rendered };
  }

  private install(prepared: readonly ReturnType<UnitsModule["prepareUnit"]>[]): void {
    // Link the complete pair, reload once, then observe every effective unit.
    // File publication and ownership checks remain per unit.
    const linked = this.command(["link", ...prepared.map(unit => unit.target)]);
    if (linked.kind === "unknown") throw unitCommandError(linked, "link units")!;
    if (linked.kind === "failed" && !/already|exists/i.test(linked.stdout + linked.stderr))
      throw new StoreError("INTERNAL_ERROR", "systemctl link not confirmed for units");
    this.run(["daemon-reload"]);
    for (const unit of prepared) this.verifyInstalled(unit);
  }

  private verifyInstalled({ name, target, rendered }: ReturnType<UnitsModule["prepareUnit"]>): void {
    const exec = renderedExecArgv(rendered);
    const required = ["LoadState", "FragmentPath", "DropInPaths",
      ...(exec === null ? [] : ["ExecStart"])];
    const observed = parseProperties(this.run(["show", name, ...required.map(property => `--property=${property}`)]), required);
    if (observed === null) throw new StoreError("UNSUPPORTED_PROFILE", `effective unit properties are incomplete: ${name}`);
    if (observed.get("LoadState") !== "loaded")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit did not load: ${name}`);
    const fragment = observed.get("FragmentPath");
    if (!fragment || realpathSync(fragment) !== realpathSync(target) || observed.get("DropInPaths") !== "")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit source differs from rendered contract: ${name}`);
    // D03/WP03.04: the argv the manager will execute is the rendered one. A
    // quoting or specifier the manager reads differently would hand a runner a
    // location the broker never resolved.
    if (exec !== null) {
      const effective = effectiveExecArgv(observed.get("ExecStart")!);
      if (effective !== exec.join(" "))
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective ExecStart differs from its rendered argv`);
    }
  }

  /** P0V-26, P0-1: a unit file under this name that was rendered for another
   * owner is that owner's installed fact, and it is refused rather than
   * replaced. UNIT-001 joins society and actor with "-", and both may contain
   * one, so one name can be two owners' ("oma-a-b-c" is society a's Resident
   * b-c and society a-b's Resident c). P0V-59: and a society is its state tree,
   * not its name -- two trees may each hold a society called "demo" (REC-007).
   * The rendered Description names kind, society and agent, the owner line the
   * state tree, and the same owner renders the same two again. */
  private assertOwnUnit(name: string, expected: string): void {
    const owner = this.ownerOf(name, expected);
    if (owner === "other")
      throw new StoreError("AGENT_CONFLICT", `unit ${name} is installed for another society or agent; it is not replaced`);
    if (owner === "unknown")
      throw new StoreError("AGENT_CONFLICT", `unit ${name} names no owner, so whose it is cannot be told; it is not replaced (remove it to let this society install its own)`);
  }
  /** Whether the unit file under `name` is not provably this owner's; false when there is none. */
  private foreign(name: string, expected: string): boolean {
    return this.ownerOf(name, expected) !== "same";
  }
  /** Whose the unit file under `name` is: this owner's ("same", also when
   * there is none), another's, or -- a unit that names no owner at all --
   * nobody can tell. */
  private ownerOf(name: string, expected: string): "same" | "other" | "unknown" {
    let existing: string;
    try { existing = readFileSync(join(this.installDir, name), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "same";
      throw unobserved(error, join(this.installDir, name)) ?? error;
    }
    return this.sameOwner(existing, expected);
  }
  private sameOwner(existing: string, expected: string): "same" | "other" | "unknown" {
    if (lineOf(existing, DESCRIPTION) !== lineOf(expected, DESCRIPTION)) return "other";
    const owner = lineOf(existing, OWNER);
    // P0V-95 (R6-20): a unit that names no owner is not known to be this
    // owner's by its Description -- two trees' societies share names -- so it
    // is nobody's to replace (P0-5). v0.1.0 owes no compatibility with unit
    // files written before the owner line existed.
    if (owner === null) return "unknown";
    return owner === lineOf(expected, OWNER) ? "same" : "other";
  }
  /** The identity lines a unit of `template` renders for `agent`. */
  private identity(template: string, agent: string): string {
    const lines = readFileSync(join(UNIT_TPL_DIR, template), "utf8").split("\n")
      .filter(line => line.startsWith(DESCRIPTION) || line.startsWith(OWNER));
    return renderUnit(lines.join("\n"), { ...this.values, agent });
  }
  /** P0V-59, P0-1: whether a Resident's unit names are held by another owner.
   * No effect of this society is applied to it. Its current owner says nothing
   * about the death of a process this society previously started (P0-5). */
  private residentForeign(agent: Actor): boolean {
    return this.foreign(unitName(this.society, agent, "service"), this.identity("resident.service.in", agent)) ||
      this.foreign(unitName(this.society, agent, "path"), this.identity("resident.path.in", agent));
  }

  /** Before a create is accepted: the unit names a Resident called `agent`
   * would take are not another owner's (P0V-26). */
  assertResidentNamesFree(agent: Actor): void {
    for (const [suffix, template] of [["service", "resident.service.in"], ["path", "resident.path.in"]] as const)
      this.assertOwnUnit(unitName(this.society, agent, suffix), this.identity(template, agent));
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor, profile: string, modelProfile: string): void {
    if (!profile || !modelProfile)
      throw new StoreError("UNSUPPORTED_PROFILE", `resident profile missing or unsupported for ${agent}`);
    const service = this.prepareUnit(unitName(this.society, agent, "service"), "resident.service.in", {
      profileHex: Buffer.from(profile, "utf8").toString("hex"),
      modelProfileHex: Buffer.from(modelProfile, "utf8").toString("hex"),
      // D23/TSP-005: the deployment's encoded surface plan rides the unit's
      // environment as hex beside the accepted profile and model reference. It is produced
      // here -- one canonical plan for every Resident of the deployment --
      // never authored configuration, never a caller's choice.
      toolSurfaceHex: Buffer.from(encodedResidentToolSurface(), "utf8").toString("hex"),
    });
    this.install([service, this.prepareUnit(unitName(this.society, agent, "path"), "resident.path.in")]);
  }
  ensurePrincipal(): void {
    this.install([this.prepareUnit(unitName(this.society, "principal", "path"), "principal.path.in"),
      this.prepareUnit(unitName(this.society, "principal-relay", "service"), "principal-relay.service.in")]);
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

  start(agent: Actor, explicitRepair: boolean): void { this.supervisor.start(agent, explicitRepair); }
  stop(agent: Actor, incarnation: number): UnitObservation { return this.supervisor.stop(agent, incarnation); }

  /** Linux command adapter only. Foreign names receive no effect and a missing
   * unit is merely absent from the manager, never descendant-death evidence. */
  private stopOwnedUnit(agent: Actor, suffix: "path" | "service", action: "stop" | "disable"): void {
    if (this.residentForeign(agent)) return;
    const unit = unitName(this.society, agent, suffix);
    const observed = this.command(["show", unit, "--property=LoadState", "--value"]);
    if (observed.kind === "succeeded" && observed.stdout.trim() === "not-found") return;
    this.run([action, unit]);
  }

  unitCgroup(kind: "principal-relay"): string {
    // P0V-59: another society's host unit of this name authenticates nothing here.
    if (this.foreign(unitName(this.society, kind, "service"), this.identity(`${kind}.service.in`, kind))) return "";
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
    if (this.residentForeign(agent)) return unknownObservation();
    return parseUnitObservation(this.command(this.observationArgs(agent)));
  }
  /** Recovery diagnostics only. Never use this stale-able result as death proof.
   * One outstanding observation; no array of queued show commands is retained.
   */
  observeAsync(agent: Actor): Promise<UnitObservation> {
    if (this.observationTask) return this.observationTask.agent === agent ? this.observationTask.task :
      Promise.reject(new StoreError("BROKER_UNAVAILABLE", "unit observation is busy"));
    if (this.residentForeign(agent)) return Promise.resolve(unknownObservation());
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
    // P0V-59: a name another owner holds is no unit of this society's.
    const own: Actor[] = [];
    for (const agent of agents) {
      if (this.residentForeign(agent)) observed.set(agent, "no-unit"); else own.push(agent);
    }
    agents = own;
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

  /** UNIT-006/P0-5: only a current explicit result establishes a start limit.
   * NRestarts is cumulative, not the count in StartLimitIntervalSec. Managers
   * that retain exit-code leave the cause unconfirmed; null is not absence. */
  startLimitStatus(agent: Actor): string | null { return this.supervisor.startLimitStatus(agent); }
}
