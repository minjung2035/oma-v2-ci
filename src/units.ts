// MUST [UNIT-001..006]: fixed systemd user units rendered only from validated
// host values. Physical systemctl failures are never silently treated as success.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Actor, ResourceLimits, UnitObservation } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { unitNameFor as unitName } from "./domain/derived.js";
import { replaceDerivedFile } from "./storage/durable-fs.js";

export { unitName };

export const UNIT_TPL_DIR = fileURLToPath(
  new URL("../../implementation/systemd", import.meta.url),
);

export interface RenderValues {
  node: string;
  libdir: string;
  state: string;
  society: string;
  agent: string;
  profileHex?: string;
  memoryBytes?: number;
  tasks?: number;
  cpuQuotaPercent?: number;
}

export const INSTALL_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/tmp", ".config"),
  "systemd",
  "user",
);

const REFERENCE_RESOURCES = {
  memoryBytes: 3 * 1024 * 1024 * 1024,
  tasks: 128,
  cpuQuotaPercent: 200,
} as const;

/** MUST [UNIT-002/003]: one renderer owns every template substitution. */
export function renderUnit(template: string, v: RenderValues): string {
  for (const [key, value] of Object.entries(v)) {
    if (typeof value === "string" && /[\0\r\n]/.test(value))
      throw new StoreError("INVALID_REQUEST", `render value ${key} contains NUL/newline`);
  }
  const memoryBytes = v.memoryBytes ?? REFERENCE_RESOURCES.memoryBytes;
  const tasks = v.tasks ?? REFERENCE_RESOURCES.tasks;
  const cpuQuotaPercent = v.cpuQuotaPercent ?? REFERENCE_RESOURCES.cpuQuotaPercent;
  for (const [key, value] of Object.entries({ memoryBytes, tasks, cpuQuotaPercent })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new StoreError("UNSUPPORTED_PROFILE", `${key} is not an enforceable positive integer`);
  }
  const substitutions: Record<string, string | number> = {
    NODE: v.node, LIBDIR: v.libdir, STATE: v.state, SOCIETY: v.society, AGENT: v.agent,
    PROFILE_HEX: v.profileHex ?? Buffer.from("test", "utf8").toString("hex"),
    MEMORY_BYTES: memoryBytes, TASKS: tasks, CPU_QUOTA: cpuQuotaPercent,
  };
  return template.replace(/@([A-Z0-9_]+)@/g, (_placeholder, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(substitutions, key))
      throw new StoreError("UNSUPPORTED_PROFILE", "unit template has an unresolved placeholder");
    let value = String(substitutions[key]);
    if (key === "NODE" || key === "LIBDIR") value = value.replaceAll("$", () => "$$");
    return value.replace(/[%\\\t "']/g, (char) =>
      char === "%" ? "%%" : `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  });
}

export type IncarnationReader = (agent: Actor) => number | null;

export class UnitsModule {
  onRevokeRun: ((agent: Actor) => void) | undefined;
  private incarnationOf: IncarnationReader | null;

  constructor(
    private readonly society: string,
    private readonly values: RenderValues,
    private readonly installDir: string = INSTALL_DIR,
    private readonly profiles: Readonly<Record<string, ResourceLimits>> = {},
    incarnationOf: IncarnationReader | null = null,
  ) {
    this.incarnationOf = incarnationOf;
  }

  /** Bind the durable monotonic incarnation source used by death proof. */
  bindIncarnationReader(reader: IncarnationReader): void {
    this.incarnationOf = reader;
  }

  private run(argv: readonly string[], tolerateFailure = false): string {
    const r = spawnSync("systemctl", ["--user", ...argv], { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL" });
    const stdout = r.stdout?.trim() ?? "";
    const stderr = r.stderr?.trim() ?? "";
    if (r.error || r.status === null) {
      if (tolerateFailure) return "";
      throw new StoreError("UNSUPPORTED_PROFILE", `systemctl unavailable for ${argv[0] ?? "operation"}`);
    }
    if (r.status !== 0 && !tolerateFailure) {
      const detail = `${stdout}\n${stderr}`.trim();
      throw new StoreError(
        /start-limit/i.test(detail) ? "START_LIMIT" : "INTERNAL_ERROR",
        `systemctl ${argv.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      );
    }
    return r.status === 0 ? stdout : "";
  }

  private install(name: string, templateName: string, overrides: Partial<RenderValues> = {}): void {
    const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, templateName), "utf8"), {
      ...this.values,
      ...overrides,
      agent: this.agentFrom(name),
    });
    const target = join(this.installDir, name);
    // This is a rebuildable view, not immutable evidence. The owner checks
    // existing parent components before creating directories or replacing it.
    replaceDerivedFile(target, rendered, 0o600);
    const linked = spawnSync("systemctl", ["--user", "link", target], { encoding: "utf8" });
    const detail = `${linked.stdout ?? ""}\n${linked.stderr ?? ""}`;
    if (linked.error || linked.status === null || (linked.status !== 0 && !/already|exists/i.test(detail)))
      throw new StoreError("INTERNAL_ERROR", `systemctl link failed for ${name}: ${detail.trim()}`);
    this.run(["daemon-reload"]);
    if (this.run(["show", name, "--property=LoadState", "--value"]) !== "loaded")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit did not load: ${name}`);
    const fragment = this.run(["show", name, "--property=FragmentPath", "--value"]);
    if (!fragment || realpathSync(fragment) !== realpathSync(target) ||
      this.run(["show", name, "--property=DropInPaths", "--value"]) !== "")
      throw new StoreError("UNSUPPORTED_PROFILE", `unit source differs from rendered contract: ${name}`);
    for (const [property, expected] of [["MemoryMax", overrides.memoryBytes], ["TasksMax", overrides.tasks]] as const) {
      if (expected !== undefined && this.run(["show", name, `--property=${property}`, "--value"]) !== String(expected))
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective ${property} mismatch`);
    }
    if (overrides.cpuQuotaPercent !== undefined) {
      const cpu = this.run(["show", name, "--property=CPUQuotaPerSecUSec", "--value"]);
      const parsed = spawnSync("systemd-analyze", ["timespan", cpu], { encoding: "utf8", timeout: 30000 });
      const micros = /^\s*(?:μs|Microseconds):\s*(\d+)$/m.exec(parsed.stdout ?? "");
      if (parsed.status !== 0 || !micros || Number(micros[1]) !== overrides.cpuQuotaPercent * 10000)
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} effective CPU quota mismatch`);
    }
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path|timer)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor, profile?: string, frozen?: ResourceLimits): void {
    const configured = frozen ?? (profile ? this.profiles[profile] : undefined);
    if (profile && !configured)
      throw new StoreError("UNSUPPORTED_PROFILE", `unknown resident profile ${profile}`);
    if (!profile && Object.keys(this.profiles).length > 0)
      throw new StoreError("UNSUPPORTED_PROFILE", `resident profile missing for ${agent}`);
    const resources = configured ?? REFERENCE_RESOURCES;
    this.install(unitName(this.society, agent, "service"), "resident.service.in", {
      profileHex: Buffer.from(profile ?? "test", "utf8").toString("hex"),
      memoryBytes: resources.memoryBytes,
      tasks: resources.tasks,
      cpuQuotaPercent: resources.cpuQuotaPercent,
    });
    this.install(unitName(this.society, agent, "path"), "resident.path.in");
  }

  ensureBroker(): void {
    this.install(unitName(this.society, "broker", "service"), "broker.service.in");
  }

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
    const absent = !active && enabled === "" &&
      !this.run(["list-unit-files", "--no-legend", "--no-pager"]).split("\n")
        .some((line) => line.trim().split(/\s+/)[0] === path);
    if (state !== (active ? "active" : "inactive") || (!expected.includes(enabled) && !absent))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `activation state not confirmed for ${agent}: ${state}/${enabled}`);
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
    const exited = after.activeState === "inactive" && after.result === "success" && after.execMainStatus === 0 &&
      /^[0-9a-f]{32}$/.test(after.invocationId ?? "") && after.invocationId !== before.invocationId;
    if (!["active", "activating"].includes(after.activeState) && !exited)
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `service activation not observed for ${agent}`);
  }

  stop(agent: Actor, incarnation: number): UnitObservation {
    const service = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    let failure: unknown;
    const missing = (unit: string) => this.run(["show", unit, "--property=LoadState", "--value"], true) === "not-found";
    const pathMissing = missing(path);
    for (const action of [
      () => { if (!pathMissing) this.run(["stop", path]); },
      () => { if (!pathMissing) this.run(["disable", path]); },
      () => this.verifyPath(agent, false),
      () => this.onRevokeRun?.(agent),
      () => { if (!missing(service)) this.run(["stop", service]); },
    ]) {
      try { action(); } catch (error) { failure ??= error; }
    }
    const observed = this.observe(agent);
    if (failure) throw failure;
    if (!this.confirmDead(agent, incarnation))
      throw new StoreError("RUN_TERMINATION_UNKNOWN", `unit descendants not confirmed dead: ${agent}`);
    return observed;
  }

  unitCgroup(kind: "principal-relay" | "reconcile"): string {
    const out = this.run(
      ["show", unitName(this.society, kind, "service"), "-p", "ControlGroup"],
      true,
    );
    const line = out.split("\n").find((value) => value.startsWith("ControlGroup="));
    return line?.slice("ControlGroup=".length) ?? "";
  }

  observe(agent: Actor): UnitObservation {
    const out = this.run([
      "show",
      unitName(this.society, agent, "service"),
      "-p", "ActiveState",
      "-p", "SubState",
      "-p", "Result",
      "-p", "ExecMainStatus",
      "-p", "ControlGroup",
      "-p", "InvocationID",
    ], true);
    const kv = new Map(out.split("\n").map((line) => {
      const i = line.indexOf("=");
      return i < 0 ? [line, ""] as const : [line.slice(0, i), line.slice(i + 1)] as const;
    }));
    const rawStatus = kv.get("ExecMainStatus");
    return {
      activeState: kv.get("ActiveState") ?? "unknown",
      subState: kv.get("SubState") ?? "unknown",
      result: kv.get("Result") ?? "unknown",
      execMainStatus: rawStatus && /^\d+$/.test(rawStatus) && Number.isSafeInteger(Number(rawStatus)) ? Number(rawStatus) : -1,
      cgroup: kv.get("ControlGroup") ?? "",
      invocationId: kv.get("InvocationID") ?? "",
    };
  }

  cgroupProcs(agent: Actor): number[] {
    const cgroup = this.observe(agent).cgroup;
    if (!cgroup) return [];
    try {
      return readFileSync(join("/sys/fs/cgroup", cgroup, "cgroup.procs"), "utf8")
        .split("\n")
        .flatMap((line) => line && Number.isInteger(Number(line)) ? [Number(line)] : []);
    } catch {
      return [];
    }
  }

  confirmDead(agent: Actor, incarnation: number): boolean {
    if (!Number.isSafeInteger(incarnation) || incarnation < 0) return false;
    const current = this.incarnationOf?.(agent) ?? null;
    // The resident unit/cgroup is fixed per agent and every incarnation runs
    // beneath it. If that cgroup is empty now, every durable incarnation up to
    // the current monotonic value is dead. A future/unbound incarnation is never
    // inferred dead from today's observation.
    if (current === null || incarnation > current) return false;
    const obs = this.observe(agent);
    if (!["inactive", "dead", "failed"].includes(obs.activeState)) return false;
    if (!obs.cgroup) return true;
    try {
      return /^populated 0$/m.test(readFileSync(join("/sys/fs/cgroup", obs.cgroup, "cgroup.events"), "utf8"));
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }

  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    return obs.activeState === "failed" && obs.result === "start-limit-hit" ? "start_limit" : null;
  }
}
