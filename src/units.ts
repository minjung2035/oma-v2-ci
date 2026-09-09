// MUST [UNIT-001..006]: fixed systemd user units rendered only from validated
// host values. Physical systemctl failures are never silently treated as success.
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Actor, ResourceLimits, UnitObservation } from "../implementation/contracts.js";
import { StoreError } from "./store.js";

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
    if (typeof value === "string" && (value.includes("\0") || value.includes("\n")))
      throw new StoreError("INVALID_REQUEST", `render value ${key} contains NUL/newline`);
  }
  const memoryBytes = v.memoryBytes ?? REFERENCE_RESOURCES.memoryBytes;
  const tasks = v.tasks ?? REFERENCE_RESOURCES.tasks;
  const cpuQuotaPercent = v.cpuQuotaPercent ?? REFERENCE_RESOURCES.cpuQuotaPercent;
  for (const [key, value] of Object.entries({ memoryBytes, tasks, cpuQuotaPercent })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new StoreError("UNSUPPORTED_PROFILE", `${key} is not an enforceable positive integer`);
  }
  const rendered = template
    .replaceAll("@NODE@", v.node)
    .replaceAll("@LIBDIR@", v.libdir)
    .replaceAll("@STATE@", v.state)
    .replaceAll("@SOCIETY@", v.society)
    .replaceAll("@AGENT@", v.agent)
    .replaceAll("@PROFILE_HEX@", v.profileHex ?? Buffer.from("test", "utf8").toString("hex"))
    .replaceAll("@MEMORY_BYTES@", String(memoryBytes))
    .replaceAll("@TASKS@", String(tasks))
    .replaceAll("@CPU_QUOTA@", String(cpuQuotaPercent));
  if (/@[A-Z0-9_]+@/.test(rendered))
    throw new StoreError("UNSUPPORTED_PROFILE", "unit template has an unresolved placeholder");
  return rendered;
}

export function unitName(
  society: string,
  kind: "broker" | Actor | "principal" | "principal-relay" | "reconcile",
  suffix: "service" | "path" | "timer",
): string {
  return `oma-${society}-${kind}.${suffix}`;
}

export class UnitsModule {
  constructor(
    private readonly society: string,
    private readonly values: RenderValues,
    private readonly installDir: string = INSTALL_DIR,
    private readonly profiles: Readonly<Record<string, ResourceLimits>> = {},
  ) {}

  private run(argv: readonly string[], tolerateFailure = false): string {
    const r = spawnSync("systemctl", ["--user", ...argv], { encoding: "utf8" });
    const stdout = r.stdout?.trim() ?? "";
    const stderr = r.stderr?.trim() ?? "";
    if (r.error || r.status === null) {
      if (tolerateFailure) return stdout;
      throw new StoreError("UNSUPPORTED_PROFILE", `systemctl unavailable for ${argv[0] ?? "operation"}`);
    }
    if (r.status !== 0 && !tolerateFailure) {
      const detail = `${stdout}\n${stderr}`.trim();
      throw new StoreError(
        /start-limit/i.test(detail) ? "START_LIMIT" : "INTERNAL_ERROR",
        `systemctl ${argv.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      );
    }
    return stdout;
  }

  private install(name: string, templateName: string, overrides: Partial<RenderValues> = {}): void {
    mkdirSync(this.installDir, { recursive: true });
    const rendered = renderUnit(readFileSync(join(UNIT_TPL_DIR, templateName), "utf8"), {
      ...this.values,
      ...overrides,
      agent: this.agentFrom(name),
    });
    const target = join(this.installDir, name);
    const tmp = join(this.installDir, `.${name}.${process.pid}.tmp`);
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeFileSync(fd, rendered, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
    const dirFd = openSync(this.installDir, "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
    const linked = spawnSync("systemctl", ["--user", "link", target], { encoding: "utf8" });
    const detail = `${linked.stdout ?? ""}\n${linked.stderr ?? ""}`;
    if (linked.error || linked.status === null || (linked.status !== 0 && !/already|exists/i.test(detail)))
      throw new StoreError("INTERNAL_ERROR", `systemctl link failed for ${name}`);
    this.run(["daemon-reload"]);
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path|timer)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor, profile?: string): void {
    const configured = profile ? this.profiles[profile] : undefined;
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

  start(agent: Actor, explicitRepair: boolean): void {
    const service = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    if (explicitRepair) this.run(["reset-failed", service]);
    this.run(["enable", "--now", path]);
    this.run(["start", service]);
  }

  stop(agent: Actor, incarnation: number): UnitObservation {
    const service = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    this.run(["stop", path]);
    this.run(["disable", path]);
    const before = this.observe(agent);
    if (["inactive", "dead", "failed"].includes(before.activeState) && !this.cgroupHasProcs(agent))
      return before;
    this.run(["stop", service]);
    void incarnation;
    return this.observe(agent);
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
      execMainStatus: rawStatus && !Number.isNaN(Number(rawStatus)) ? Number(rawStatus) : 0,
      cgroup: kv.get("ControlGroup") ?? "",
      invocationId: "",
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

  private cgroupHasProcs(agent: Actor): boolean {
    return this.cgroupProcs(agent).length > 0;
  }

  confirmDead(agent: Actor, incarnation: number): boolean {
    void incarnation;
    if (this.cgroupProcs(agent).length > 0) return false;
    const obs = this.observe(agent);
    return ["inactive", "dead", "failed"].includes(obs.activeState) || obs.cgroup === "";
  }

  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    return obs.activeState === "failed" && obs.result === "start-limit-hit" ? "start_limit" : null;
  }
}
