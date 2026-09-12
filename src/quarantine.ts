// GIT-002/003: bundle parsing and verification remain inside quarantine.
// S-01 remains an explicit deployment gate; process observation is not a PASS.
import { mkdirSync, readFileSync, lstatSync, openSync, writeFileSync, closeSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { GitSubmitInput, QuarantineModule, CheckSandbox, StagingId, StagingRef, StreamDescriptor, ResourceLimits } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { isValidFullOid } from "./ids.js";
import { digestHexBytes } from "./hash.js";
import { fsyncFile, fsyncDir, ensureDurableDirectory } from "./storage/durable-fs.js";
import { runQuarantineCommand } from "./process/policies.js";

function hostGit(args: string[], gitDir: string): string {
  const result = runQuarantineCommand("/usr/bin/git", ["--git-dir", gitDir, ...args], 30000, 32 * 1024 * 1024);
  if (result.status !== 0) throw new StoreError("INTERNAL_ERROR", `git ${args[0]}: ${result.stderr.slice(0, 300)}`);
  return result.stdout.trim();
}
export function requireGitReliabilitySpike(): void {
  if (process.env.OMA_UNSAFE_TEST_SPIKES !== "1") throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE-BUNDLE has no approved PASS record");
}
export interface ParsedBundleHeader { version: 2 | 3; objectFormat: "sha1" | "sha256"; prerequisites: string[]; candidate: string }
/** Header bounds are a format guard, not a replacement for quarantined Git. */
export function parseBundleHeader(bytes: Buffer): ParsedBundleHeader {
  const end = bytes.indexOf(Buffer.from("\n\n"));
  if (end < 0 || end > 1024 * 1024) throw new StoreError("INVALID_REQUEST", "bundle header missing or too large");
  const lines = bytes.subarray(0, end).toString("utf8").split("\n");
  const first = lines.shift(); const version = first === "# v2 git bundle" ? 2 : first === "# v3 git bundle" ? 3 : null;
  if (!version) throw new StoreError("INVALID_REQUEST", "unsupported bundle header");
  let objectFormat: "sha1" | "sha256" = "sha1"; let formatSeen = false;
  const prerequisites: string[] = []; const advertised: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@")) {
      if (version !== 3 || formatSeen || !/^@object-format=(sha1|sha256)$/.test(line)) throw new StoreError("INVALID_REQUEST", "unsupported/duplicate bundle capability");
      objectFormat = line.endsWith("sha256") ? "sha256" : "sha1"; formatSeen = true; continue;
    }
    if (line.startsWith("-")) {
      const oid = line.slice(1).split(" ")[0]!;
      if (!isValidFullOid(oid)) throw new StoreError("INVALID_REQUEST", "invalid bundle prerequisite");
      prerequisites.push(oid); continue;
    }
    const parts = line.split(" ");
    if (parts.length !== 2 || parts[1] !== "refs/heads/candidate" || !isValidFullOid(parts[0])) throw new StoreError("INVALID_REQUEST", "bundle must advertise only refs/heads/candidate");
    advertised.push(parts[0]!);
  }
  if (advertised.length !== 1 || new Set(prerequisites).size !== prerequisites.length) throw new StoreError("INVALID_REQUEST", "bundle ref/prerequisite shape invalid");
  const width = objectFormat === "sha1" ? 40 : 64;
  if ([advertised[0]!, ...prerequisites].some(oid => oid.length !== width)) throw new StoreError("INVALID_REQUEST", "bundle object format mismatch");
  return { version, objectFormat, prerequisites: [...prerequisites].sort(), candidate: advertised[0]! };
}
export function validateGitSubmitInput(input: GitSubmitInput): void {
  const width = input.objectFormat === "sha1" ? 40 : 64;
  if (!isValidFullOid(input.candidate) || input.candidate.length !== width) throw new StoreError("INVALID_REQUEST", "candidate/objectFormat mismatch");
  if (input.prerequisites.some(oid => !isValidFullOid(oid) || oid.length !== width) || new Set(input.prerequisites).size !== input.prerequisites.length) throw new StoreError("INVALID_REQUEST", "invalid prerequisite set");
  if (input.summary.trim().length === 0) throw new StoreError("INVALID_REQUEST", "summary must be nonempty");
  const topics = new Set<string>();
  for (const topic of input.topics) {
    if (topics.has(topic.name) || !isValidFullOid(topic.tip) || topic.tip.length !== width) throw new StoreError("INVALID_REQUEST", "invalid topic metadata");
    topics.add(topic.name);
  }
}
export async function streamToStaging(staging: string, descriptor: StreamDescriptor, stream: AsyncIterable<Uint8Array>): Promise<string> {
  ensureDurableDirectory(staging); const path = join(staging, "bundle.dat");
  const fd = openSync(path, "wx", 0o600); const hash = createHash("sha256"); let count = 0;
  try {
    for await (const bytes of stream) {
      const chunk = Buffer.from(bytes); count += chunk.length;
      if (count > descriptor.bytes) throw new StoreError("STREAM_INVALID", "bundle stream exceeds declaration");
      hash.update(chunk); writeFileSync(fd, chunk);
    }
    if (count !== descriptor.bytes || hash.digest("hex") !== descriptor.sha256) throw new StoreError("STREAM_INVALID", "bundle length/SHA-256 mismatch");
  } finally { closeSync(fd); }
  fsyncFile(path); fsyncDir(staging); return path;
}
export interface QuarantineConfig {
  projectGit: string; society: string; tmpBytes: number; timeoutSeconds: number;
  resources: { cpuSeconds: number; memoryBytes: number; tasks: number };
}
/** Named scope policy: RuntimeMaxSec owns the sandbox lifetime; an uncertain
 * launcher outcome does not prove that the scope/cgroup has disappeared.
 */
function runCheckedBwrap(society: string, bwrapArgs: string[], cfg: {
  tmpBytes: number; timeoutSeconds: number; cpuSeconds: number; memoryBytes: number; tasks: number; cpuQuotaPercent?: number;
}): string {
  const name = `oma-${society}-quarantine-${randomUUID()}`;
  const args = ["--user", "--scope", "--wait", "--collect", "--quiet", "--unit", name,
    `--property=MemoryMax=${cfg.memoryBytes}`, "--property=MemorySwapMax=0", `--property=TasksMax=${cfg.tasks}`,
    "--property=KillMode=control-group", `--property=RuntimeMaxSec=${cfg.timeoutSeconds}`,
    ...(cfg.cpuQuotaPercent ? [`--property=CPUQuota=${cfg.cpuQuotaPercent}%`] : []),
    "/usr/bin/prlimit", `--cpu=${cfg.cpuSeconds}`, "--", "/usr/bin/bwrap", ...bwrapArgs];
  const result = runQuarantineCommand("systemd-run", args, (cfg.timeoutSeconds + 5) * 1000, 32 * 1024 * 1024);
  if (result.status !== 0) {
    if (result.stderr.includes("bwrap") || result.stderr.includes("Failed to connect")) throw new StoreError("SPIKE_UNRESOLVED", `sandbox launch failed: ${result.stderr.slice(0, 200)}`);
    throw new StoreError("INVALID_REQUEST", `quarantine verification failed: ${result.stderr.slice(0, 300)}`);
  }
  return result.stdout;
}
export class BwrapQuarantine implements QuarantineModule {
  constructor(private readonly cfg: QuarantineConfig) {}
  async verifyBundle(staging: StagingRef, input: GitSubmitInput, stream: AsyncIterable<Uint8Array>): Promise<{ staging: StagingId; candidate: string; prerequisites: string[] }> {
    requireGitReliabilitySpike(); validateGitSubmitInput(input);
    if (!input.bundle) throw new StoreError("INVALID_REQUEST", "bundle descriptor required for quarantine");
    const path = join(staging.path, "bundle.dat");
    if (!existsSync(path)) await streamToStaging(staging.path, input.bundle, stream);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== input.bundle.bytes) throw new StoreError("STREAM_INVALID", "staged bundle size/type mismatch");
    if (input.bundle.bytes > 64 * 1024 * 1024) throw new StoreError("LIMIT_EXCEEDED", "bundle verifier bound is 64 MiB");
    const bytes = readFileSync(path);
    if (digestHexBytes(bytes) !== input.bundle.sha256) throw new StoreError("STREAM_INVALID", "staged bundle SHA-256 mismatch");
    const header = parseBundleHeader(bytes);
    if (header.candidate !== input.candidate || header.objectFormat !== input.objectFormat || JSON.stringify(header.prerequisites) !== JSON.stringify([...input.prerequisites].sort())) throw new StoreError("INVALID_REQUEST", "bundle header and input differ");
    if (hostGit(["rev-parse", "--show-object-format"], this.cfg.projectGit) !== input.objectFormat) throw new StoreError("INVALID_REQUEST", "canonical object format mismatch");
    const allowed = new Set(hostGit(["for-each-ref", "--format=%(objectname)", "refs/heads/main", "refs/oma/published/"], this.cfg.projectGit).split("\n").filter(Boolean));
    for (const prerequisite of input.prerequisites) if (!allowed.has(prerequisite)) throw new StoreError("PREREQUISITE_MISSING", `unknown prerequisite ${prerequisite}`);
    const verified = join(staging.path, "verified.git");
    const initialized = runQuarantineCommand("/usr/bin/git", ["init", "--bare", `--object-format=${input.objectFormat}`, verified], 30000, 1024 * 1024);
    if (initialized.status !== 0) throw new StoreError("SPIKE_UNRESOLVED", "cannot initialize isolated verification repository");
    for (const prerequisite of input.prerequisites) hostGit(["fetch", "--no-tags", this.cfg.projectGit, prerequisite], verified);
    const script = `set -eu
/usr/bin/git --git-dir=/verified.git bundle verify /bundle.dat
/usr/bin/git --git-dir=/verified.git fetch --no-tags /bundle.dat refs/heads/candidate:refs/heads/candidate
/usr/bin/git --git-dir=/verified.git cat-file -e ${input.candidate}^{commit}
/usr/bin/git --git-dir=/verified.git fsck --connectivity-only --no-reflogs
${input.topics.map(topic => `/usr/bin/git --git-dir=/verified.git cat-file -e ${topic.tip}^{commit}\n/usr/bin/git --git-dir=/verified.git merge-base --is-ancestor ${topic.tip} ${input.candidate}`).join("\n")}
`;
    const args = ["--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--clearenv",
      "--setenv", "HOME", "/nonexistent", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C", "--setenv", "LC_ALL", "C",
      "--setenv", "GIT_CONFIG_NOSYSTEM", "1", "--setenv", "GIT_CONFIG_GLOBAL", "/dev/null", "--setenv", "GIT_CONFIG_SYSTEM", "/dev/null",
      "--setenv", "GIT_TERMINAL_PROMPT", "0", "--setenv", "GIT_NO_REPLACE_OBJECTS", "1", "--setenv", "GIT_CONFIG_COUNT", "1",
      "--setenv", "GIT_CONFIG_KEY_0", "core.hooksPath", "--setenv", "GIT_CONFIG_VALUE_0", "/dev/null",
      "--proc", "/proc", "--dev", "/dev", "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
      ...(existsSync("/lib") ? ["--ro-bind", "/lib", "/lib"] : []), ...(existsSync("/lib64") ? ["--ro-bind", "/lib64", "/lib64"] : []),
      "--ro-bind", path, "/bundle.dat", "--bind", verified, "/verified.git", "--size", String(this.cfg.tmpBytes), "--tmpfs", "/tmp", "/bin/sh", "-c", script];
    runCheckedBwrap(this.cfg.society, args, { ...this.cfg.resources, tmpBytes: this.cfg.tmpBytes, timeoutSeconds: this.cfg.timeoutSeconds });
    const imported = hostGit(["rev-parse", "refs/heads/candidate^{commit}"], verified);
    if (imported !== input.candidate) throw new StoreError("STORE_CORRUPT", "verified candidate changed");
    hostGit(["fsck", "--connectivity-only", "--no-reflogs"], verified);
    return { staging: staging.id, candidate: imported, prerequisites: [...input.prerequisites] };
  }
}
export interface CheckConfig { society: string; tmpBytes: number; timeoutSeconds: number; rootfs?: string; assetsDir?: string; projectGit?: string }
export class BwrapCheckSandbox implements CheckSandbox {
  constructor(private readonly cfg: CheckConfig) {}
  async runChecks(input: { candidate: string; treeGit: string; checks: Array<{ id: string; argv: string[]; env: Record<string, string>; timeoutSeconds?: number; tmpBytes?: number; resources?: ResourceLimits }>; policyRevision: string }): Promise<Array<{ id: string; exitCode: number; detail?: string }>> {
    if (input.checks.length === 0) return [];
    if (process.env.OMA_UNSAFE_CHECK_FIXTURE !== "1" || !this.cfg.rootfs || !this.cfg.assetsDir) throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE read-only check rootfs profile is not pinned");
    if (!isValidFullOid(input.candidate) || !this.cfg.projectGit || input.treeGit !== this.cfg.projectGit) throw new StoreError("INVALID_REQUEST", "check candidate repository is not the host-pinned canonical store");
    const results: Array<{ id: string; exitCode: number; detail?: string }> = [];
    for (const check of input.checks) {
      if (!check.argv.length || !check.argv[0]!.startsWith("/")) throw new StoreError("UNSUPPORTED_PROFILE", "check argv[0] must be absolute inside the pinned rootfs");
      const resources = check.resources;
      if (!resources || resources.memoryBytes <= 0 || resources.tasks <= 0 || resources.cpuQuotaPercent <= 0) throw new StoreError("UNSUPPORTED_PROFILE", "check cgroup resources are absent");
      const env: string[] = [];
      for (const [key, value] of Object.entries(check.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || value.includes("\0")) throw new StoreError("INVALID_REQUEST", "invalid host check environment");
        env.push("--setenv", key, value);
      }
      const script = `set -eu
/bin/mkdir -p /tmp/source
/usr/bin/git --git-dir=/repo.git archive ${input.candidate} | /bin/tar -xf - -C /tmp/source
exec /usr/bin/bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --die-with-parent --clearenv --ro-bind / / --proc /proc --dev /dev --ro-bind /tmp/source /candidate --size ${check.tmpBytes ?? this.cfg.tmpBytes} --tmpfs /tmp --chdir /candidate "$@"
`;
      const args = ["--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--clearenv",
        "--setenv", "HOME", "/nonexistent", "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "LANG", "C", "--setenv", "LC_ALL", "C",
        "--setenv", "GIT_CONFIG_NOSYSTEM", "1", "--setenv", "GIT_CONFIG_GLOBAL", "/dev/null", "--setenv", "GIT_CONFIG_SYSTEM", "/dev/null",
        "--setenv", "GIT_CONFIG_COUNT", "1", "--setenv", "GIT_CONFIG_KEY_0", "core.hooksPath", "--setenv", "GIT_CONFIG_VALUE_0", "/dev/null",
        "--ro-bind", this.cfg.rootfs, "/", "--ro-bind", this.cfg.assetsDir, "/assets", "--ro-bind", input.treeGit, "/repo.git",
        "--proc", "/proc", "--dev", "/dev", "--size", String(check.tmpBytes ?? this.cfg.tmpBytes), "--tmpfs", "/tmp",
        "/bin/sh", "-c", script, "check", ...env, "--", ...check.argv];
      try {
        const stdout = runCheckedBwrap(this.cfg.society, args, { tmpBytes: check.tmpBytes ?? this.cfg.tmpBytes,
          timeoutSeconds: check.timeoutSeconds ?? this.cfg.timeoutSeconds, cpuSeconds: check.timeoutSeconds ?? this.cfg.timeoutSeconds,
          memoryBytes: resources.memoryBytes, tasks: resources.tasks, cpuQuotaPercent: resources.cpuQuotaPercent });
        results.push({ id: check.id, exitCode: 0, detail: stdout.slice(0, 512) });
      } catch (error) {
        if (error instanceof StoreError && error.code === "SPIKE_UNRESOLVED") throw error;
        results.push({ id: check.id, exitCode: 1, detail: (error as Error).message.slice(0, 512) }); break;
      }
    }
    return results;
  }
}
