/** Optional cgroup v2 enforcement. The broker remains outside its owned
 * workload tree; descendants inherit placement before the first workload exec. */
import { accessSync, closeSync, constants, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmdirSync, statfsSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { WorkloadResourceProfile } from "@oma/contracts/host";
import type { CommandSpec, WorkloadMetrics } from "@oma/process/command";
import { runProcessSync } from "@oma/process/run";
import { StoreError } from "@oma/domain/errors";
import { parseBubblewrapArguments } from "./bubblewrap-arguments.js";
const CGROUP = "/sys/fs/cgroup";
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8").trim();
const fields = (text: string): Record<string, number> => Object.fromEntries(text.split("\n").filter(Boolean).map(row => { const [key, value] = row.split(/\s+/); return [key!, Number(value)]; }));
export interface ResourceObservation { requested: WorkloadResourceProfile; effective: Record<string, string | number>; supported: boolean; reason: string | null; scope: string | null; included: readonly string[]; excluded: readonly string[] }
export interface WorkloadLease { placementFd: number; path: string; events(): { oomKills: number; taskLimitHits: number; metrics: WorkloadMetrics }; close(): void }
function controllers(profile: WorkloadResourceProfile): string[] {
  return [...(profile.cpuCores === undefined ? [] : ["cpu"]), ...(profile.memoryMaxBytes === undefined && profile.swapMaxBytes === undefined ? [] : ["memory"]), ...(profile.tasksMax === undefined ? [] : ["pids"])];
}
function delegated(required: readonly string[]): string {
  const entry = readFileSync("/proc/self/cgroup", "utf8").split("\n").find(line => line.startsWith("0::"));
  if (!entry) throw new Error("unified cgroup v2 membership is unavailable");
  let current = realpathSync(join(CGROUP, entry.slice(3)));
  for (;;) {
    if (current !== CGROUP && Number(statfsSync(current).type) === 0x63677270) {
      try {
        accessSync(current, constants.W_OK | constants.X_OK);
        const enabled = new Set(read(current, "cgroup.subtree_control").split(/\s+/));
        if (required.every(controller => enabled.has(controller))) return current;
      } catch { /* a nondelegated ancestor is not an available profile */ }
    }
    if (current === CGROUP || !current.startsWith(`${CGROUP}/`)) break;
    current = dirname(current);
  }
  throw new Error(`no delegated cgroup v2 parent provides ${required.join(", ") || "workload placement"}`);
}
export function resourceSupport(profile: WorkloadResourceProfile): ResourceObservation {
  try {
    if (profile.cpuCores !== undefined && (profile.cpuCores < 0.001 || profile.cpuCores * 1000000 > Number.MAX_SAFE_INTEGER)) throw new Error("requested CPU bandwidth cannot be represented by cgroup v2");
    accessSync("/bin/bash", constants.X_OK); accessSync("/usr/bin/env", constants.X_OK);
    if (profile.tmpfsMaxBytes !== undefined) {
      const help = runProcessSync({ executable: "/usr/bin/bwrap", argv: ["--help"], env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
        timeoutMs: 10000, stdoutBytes: 65536, stderrBytes: 8192 });
      if (help.kind !== "exited" || help.exitCode !== 0 || !/--size\s/.test(help.stdout.toString("utf8")))
        throw new Error("bubblewrap cannot enforce the requested tmpfs size");
    }
    const needed = controllers(profile), scope = needed.length ? delegated(needed) : null;
    return { requested: profile, effective: { maxConcurrentCheckPipelines: 1 }, supported: true, reason: null, scope,
      included: ["Worker engines and tool descendants", "candidate pipelines", "canonical preparation helpers"],
      excluded: ["broker control process", "Principal host UI", "external inference servers", "external graders and other applications"] };
  } catch (error) { return { requested: profile, effective: {}, supported: false, reason: error instanceof Error ? error.message : String(error), scope: null, included: [], excluded: [] }; }
}
export class WorkloadBudget {
  readonly observation: ResourceObservation;
  private readonly root: string | null;
  private readonly leases = new Set<WorkloadLease>();
  constructor(readonly profile: WorkloadResourceProfile, identity: string) {
    const support = resourceSupport(profile);
    if (!support.supported) throw new StoreError("UNSUPPORTED_PROFILE", `resource profile cannot be enforced: ${support.reason}`);
    this.root = support.scope === null ? null : join(support.scope, `oma-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}.workload`);
    const effective = { ...support.effective };
    if (this.root !== null) {
      try { mkdirSync(this.root); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      if (fields(read(this.root, "cgroup.events")).populated !== 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous workload cgroup is still populated; recover its native scopes first");
      for (const entry of readdirSync(this.root, { withFileTypes: true })) if (entry.isDirectory()) rmdirSync(join(this.root, entry.name));
      // Recreate only after the whole owned tree is empty, so omitted limits
      // cannot inherit a previous profile after a crash.
      rmdirSync(this.root); mkdirSync(this.root);
      const limits: Record<string, string | undefined> = {
        "cpu.max": profile.cpuCores === undefined ? undefined : `${Math.floor(profile.cpuCores * 1000000)} 1000000`,
        "memory.max": profile.memoryMaxBytes?.toString(), "memory.swap.max": profile.swapMaxBytes?.toString(), "pids.max": profile.tasksMax?.toString(),
      };
      for (const [file, value] of Object.entries(limits)) if (value !== undefined) { writeFileSync(join(this.root, file), value); effective[file] = read(this.root, file); }
      const needed = controllers(profile);
      if (needed.length) writeFileSync(join(this.root, "cgroup.subtree_control"), needed.map(controller => `+${controller}`).join(" "));
    }
    for (const key of ["checkWallTimeMs", "tmpfsMaxBytes"] as const) if (profile[key] !== undefined) effective[key] = profile[key];
    this.observation = { ...support, scope: this.root, effective };
  }
  acquire(): WorkloadLease | undefined {
    if (this.root === null) return undefined;
    const path = join(this.root, `run-${randomUUID()}`); mkdirSync(path);
    // The same ceiling at the leaf adds no restriction beyond the aggregate
    // and makes locally exhausted task capacity observable at its owner.
    if (this.profile.tasksMax !== undefined) writeFileSync(join(path, "pids.max"), String(this.profile.tasksMax));
    const placementFd = openSync(join(path, "cgroup.procs"), constants.O_WRONLY | constants.O_NOFOLLOW);
    let closed = false;
    const counters = (file: string, key: string): number => { try { return fields(read(path, file))[key] ?? 0; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; } };
    const lease: WorkloadLease = { placementFd, path,
      events: () => {
        const unavailable: string[] = [];
        const metric = (file: string, key?: string, scope = path): number | null => {
          try {
            const text = read(scope, file), value = key === undefined ? Number(text) : fields(text)[key];
            if (value === undefined || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid counter");
            return value;
          } catch { unavailable.push(key === undefined ? file : `${file}:${key}`); return null; }
        };
        const metrics: WorkloadMetrics = { observedAtMs: Date.now(), cpuThrottlingScope: this.root!,
          memoryPeakBytes: metric("memory.peak"), swapPeakBytes: metric("memory.swap.peak"), tasksPeak: metric("pids.peak"),
          cpuUsageUsec: metric("cpu.stat", "usage_usec"), cpuThrottledUsec: metric("cpu.stat", "throttled_usec", this.root!),
          cpuThrottledPeriods: metric("cpu.stat", "nr_throttled", this.root!), unavailable };
        return { oomKills: counters("memory.events", "oom_kill"), taskLimitHits: counters("pids.events", "max"), metrics };
      },
      close: () => {
        if (closed) return;
        if (fields(read(path, "cgroup.events")).populated !== 0) throw new StoreError("RUN_TERMINATION_UNKNOWN", "workload resources are still populated");
        closeSync(placementFd); closed = true; rmdirSync(path); this.leases.delete(lease);
      } };
    this.leases.add(lease); return lease;
  }
  command(command: CommandSpec): CommandSpec {
    if (this.profile.tmpfsMaxBytes === undefined || command.executable !== "/usr/bin/bwrap") return command;
    const parsed = parseBubblewrapArguments(command.argv), args: string[] = [];
    let pendingSize = Infinity;
    for (const option of parsed.options) {
      // --size applies to the next tmpfs. Keep an existing smaller per-mount
      // bound; a workload ceiling may tighten it but must not create two flags.
      if (option.flag === "--size") {
        const value = Number(option.values[0]);
        if (!Number.isSafeInteger(value) || value <= 0 || pendingSize !== Infinity)
          throw new StoreError("UNSUPPORTED_PROFILE", "invalid sandbox tmpfs size");
        pendingSize = value; continue;
      }
      if (option.flag === "--tmpfs") {
        args.push("--size", String(Math.min(pendingSize, this.profile.tmpfsMaxBytes)));
        pendingSize = Infinity;
      }
      args.push(option.flag, ...option.values);
    }
    if (pendingSize !== Infinity) throw new StoreError("UNSUPPORTED_PROFILE", "sandbox size has no tmpfs target");
    return { ...command, argv: [...args, ...command.argv.slice(parsed.boundary)] };
  }
  close(): void {
    for (const lease of this.leases) lease.close();
    if (this.root !== null) rmdirSync(this.root);
  }
}
