// MUST [UNIT-001..006]: systemd user unit render/install/lifecycle against the
// operationally running `systemctl --user`. Units are rendered from the
// normative templates; names and ExecStart args come from validated host
// values only (no caller strings).
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
import type {
  Actor,
  ResourceLimits,
  UnitObservation,
} from "../implementation/contracts.js";
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

/** MUST [UNIT-002]: placeholder substitution; NUL/newline rejected. */
export function renderUnit(template: string, v: RenderValues): string {
  for (const [k, val] of Object.entries(v)) {
    if (val.includes("\0") || val.includes("\n")) {
      throw new StoreError(
        "INVALID_REQUEST",
        `render value ${k} contains NUL/newline`,
      );
    }
  }
  return template
    .replaceAll("@NODE@", v.node)
    .replaceAll("@LIBDIR@", v.libdir)
    .replaceAll("@STATE@", v.state)
    .replaceAll("@SOCIETY@", v.society)
    .replaceAll("@AGENT@", v.agent);
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
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        `systemctl unavailable for ${argv[0] ?? "operation"}`,
      );
    }
    if (r.status !== 0 && !tolerateFailure) {
      const detail = `${stdout}\n${stderr}`.trim();
      const code = /start-limit/i.test(detail) ? "START_LIMIT" : "INTERNAL_ERROR";
      throw new StoreError(
        code,
        `systemctl ${argv.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      );
    }
    return stdout;
  }

  /** MUST [UNIT-TPL-002]: atomic install + daemon-reload. */
  private install(
    name: string,
    templateName: string,
    replacements: Readonly<Record<string, string>> = {},
  ): void {
    mkdirSync(this.installDir, { recursive: true });
    const template = readFileSync(join(UNIT_TPL_DIR, templateName), "utf8");
    let rendered = renderUnit(template, {
      ...this.values,
      agent: this.agentFrom(name),
    });
    for (const [token, value] of Object.entries(replacements)) {
      if (!/^@[A-Z0-9_]+@$/.test(token) || value.includes("\0") || value.includes("\n")) {
        throw new StoreError("INVALID_REQUEST", `invalid unit replacement ${token}`);
      }
      rendered = rendered.replaceAll(token, value);
    }
    if (/@[A-Z0-9_]+@/.test(rendered)) {
      throw new StoreError("UNSUPPORTED_PROFILE", `unresolved unit placeholder in ${name}`);
    }
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
    const linked = spawnSync("systemctl", ["--user", "link", target], {
      encoding: "utf8",
    });
    if (
      linked.error ||
      linked.status === null ||
      (linked.status !== 0 && !/already|exists/i.test(`${linked.stdout ?? ""}\n${linked.stderr ?? ""}`))
    ) {
      throw new StoreError("INTERNAL_ERROR", `systemctl link failed for ${name}`);
    }
    this.run(["daemon-reload"]);
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path|timer)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor, profile?: string): void {
    const configured = profile ? this.profiles[profile] : undefined;
    if (profile && !configured) {
      throw new StoreError("UNSUPPORTED_PROFILE", `unknown resident profile ${profile}`);
    }
    if (!profile && Object.keys(this.profiles).length > 0) {
      throw new StoreError("UNSUPPORTED_PROFILE", `resident profile missing for ${agent}`);
    }
    const resources = configured ?? REFERENCE_RESOURCES;
    for (const [name, value] of Object.entries({
      memoryBytes: resources.memoryBytes,
      tasks: resources.tasks,
      cpuQuotaPercent: resources.cpuQuotaPercent,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new StoreError("UNSUPPORTED_PROFILE", `${name} is not enforceable for ${agent}`);
      }
    }
    const profileHex = Buffer.from(profile ?? "test", "utf8").toString("hex");
    this.install(
      unitName(this.society, agent, "service"),
      "resident.service.in",
      {
        "@PROFILE_HEX@": profileHex,
        "@MEMORY_BYTES@": String(resources.memoryBytes),
        "@TASKS@": String(resources.tasks),
        "@CPU_QUOTA@": String(resources.cpuQuotaPercent),
      },
    );
    this.install(unitName(this.society, agent, "path"), "resident.path.in");
  }

  ensureBroker(): void {
    this.install(
      unitName(this.society, "broker", "service"),
      "broker.service.in",
    );
  }

  ensurePrincipal(): void {
    this.install(
      unitName(this.society, "principal", "path"),
      "principal.path.in",
    );
    this.install(
      unitName(this.society, "principal-relay", "service"),
      "principal-relay.service.in",
    );
  }

  ensureReconcile(): void {
    this.install(
      unitName(this.society, "reconcile", "service"),
      "reconcile.service.in",
    );
    this.install(
      unitName(this.society, "reconcile", "timer"),
      "reconcile.timer.in",
    );
  }

  /** MUST [UNIT-005]: enable/start only under host conditions; explicit start resets failure state (UNIT-006). */
  start(agent: Actor, explicitRepair: boolean): void {
    const svc = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    if (explicitRepair) this.run(["reset-failed", svc]);
    this.run(["enable", "--now", path]);
    this.run(["start", svc]);
  }

  /** MUST [LIFE-003]: stop path first so mail no longer wakes, then the service. */
  stop(agent: Actor, incarnation: number): UnitObservation {
    const svc = unitName(this.society, agent, "service");
    const path = unitName(this.society, agent, "path");
    this.run(["stop", path]);
    this.run(["disable", path]);
    const obs = this.observe(agent);
    if (
      obs.activeState === "inactive" ||
      obs.activeState === "dead" ||
      obs.activeState === "failed"
    ) {
      if (!this.cgroupHasProcs(agent)) return obs;
    }
    this.run(["stop", svc]);
    const after = this.observe(agent);
    void incarnation;
    return after;
  }

  observe(agent: Actor): UnitObservation {
    const svc = unitName(this.society, agent, "service");
    const out = this.run(
      [
        "show",
        svc,
        "-p",
        "ActiveState",
        "-p",
        "SubState",
        "-p",
        "Result",
        "-p",
        "ExecMainStatus",
        "-p",
        "ControlGroup",
      ],
      true,
    );
    const kv = new Map(
      out.split("\n").map((l) => {
        const i = l.indexOf("=");
        return i < 0
          ? ([l, ""] as const)
          : ([l.slice(0, i), l.slice(i + 1)] as const);
      }),
    );
    const rawStatus = kv.get("ExecMainStatus");
    const execMainStatus =
      rawStatus === undefined ||
      rawStatus === "" ||
      Number.isNaN(Number(rawStatus))
        ? 0
        : Number(rawStatus);
    return {
      activeState: kv.get("ActiveState") ?? "unknown",
      subState: kv.get("SubState") ?? "unknown",
      result: kv.get("Result") ?? "unknown",
      execMainStatus,
      cgroup: kv.get("ControlGroup") ?? "",
      invocationId: "",
    };
  }

  /** Actual cgroup descendants of a unit (S-01: cgroup is the identity source). */
  cgroupProcs(agent: Actor): number[] {
    const obs = this.observe(agent);
    const cg = obs.cgroup;
    if (!cg) return [];
    try {
      const text = readFileSync(
        join("/sys/fs/cgroup", cg, "cgroup.procs"),
        "utf8",
      );
      return text
        .split("\n")
        .flatMap((l) => (l && Number.isInteger(Number(l)) ? [Number(l)] : []));
    } catch {
      return [];
    }
  }

  private cgroupHasProcs(agent: Actor): boolean {
    return this.cgroupProcs(agent).length > 0;
  }

  /** MUST [AUTH-003]/[RUN-001]: death confirmed only via an empty cgroup, never by PID polling. */
  confirmDead(agent: Actor, incarnation: number): boolean {
    void incarnation;
    const procs = this.cgroupProcs(agent);
    if (procs.length > 0) return false;
    const obs = this.observe(agent);
    return (
      obs.activeState === "inactive" ||
      obs.activeState === "dead" ||
      obs.activeState === "failed" ||
      obs.cgroup === ""
    );
  }

  /** start-limit surface (UNIT-006): show, never auto reset. */
  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    return obs.activeState === "failed" && obs.result === "start-limit-hit"
      ? "start_limit"
      : null;
  }
}
