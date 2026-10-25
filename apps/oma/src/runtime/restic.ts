import { ResticTarVerifier } from "./restic-tar.js";
import type { CacheTreeObservation } from "@oma/storage/cache-trees";
/** Local-only, pinned Restic execution. Credentials and repository paths stay
 * outside every model mount. Every native reader/writer inherits the society
 * fence, project lock and preparation lease, and is awaited through close. */
import { closeSync, fchmodSync, fstatSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { RESTIC_RELEASE } from "@oma/domain/deployment";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { repairOwnedEntryMode } from "@oma/storage/directory";
import { digestDescriptor } from "@oma/storage/cache-trees";
import { startProcess } from "@oma/process/async";
import type { ProcessObservation } from "@oma/process/run";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/fence";

export function managedResticPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== "linux" || (process.arch !== "x64" && process.arch !== "arm64")) return null;
  const data = env.XDG_DATA_HOME ?? (env.HOME ? join(env.HOME, ".local/share") : null);
  if (data === null || !isAbsolute(data)) return null;
  return join(data, "oma-toolchain", "restic", RESTIC_RELEASE.version, `linux-${process.arch}`, "restic");
}
export async function openResticTool(env: NodeJS.ProcessEnv = process.env): Promise<number | null> {
  const managed = managedResticPath(env), executable = env.OMA_RESTIC_COMMAND ?? managed;
  if (executable === null || executable === undefined) return null;
  if (!isAbsolute(executable)) throw new StoreError("UNSUPPORTED_PROFILE", "OMA_RESTIC_COMMAND must be absolute");
  if (executable === managed) repairOwnedEntryMode(executable);
  let fd: number;
  try { fd = withinDirectory(executable, (parent, name) => openRegularBeneath(parent, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const pin = RESTIC_RELEASE.linux[process.arch as "x64" | "arm64"];
    const stat = fstatSync(fd);
    if (pin === undefined || (stat.mode & 0o022) !== 0 || await digestDescriptor(fd) !== pin.binarySha256)
      throw new StoreError("UNSUPPORTED_PROFILE", "Restic differs from the pinned host tool; run npm run setup:storage");
    if ((stat.mode & 0o100) === 0 && executable === managed && stat.uid === process.getuid?.()) fchmodSync(fd, stat.mode | 0o100);
    return fd;
  } catch (error) { return withAsyncCleanup(async () => { throw error; }, () => closeSync(fd)); }
}

export function requireResticSuccess(result: ProcessObservation): string {
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("BROKER_UNAVAILABLE", `session storage command ${result.kind}${result.kind === "exited" ? ` (${result.exitCode})` : ""}: ${result.stderr.toString("utf8").slice(0, 400)}`);
  return result.stdout.toString("utf8");
}
export interface ResticProcessOptions {
  readonly tool: number; readonly password: number; readonly fence: number;
  readonly projectLock: number; readonly stageLease: number;
  readonly projectRoot: string; readonly stage: string; readonly source: string;
  readonly signal?: AbortSignal;
}
export class ResticProcess {
  constructor(private readonly options: ResticProcessOptions) {}
  private get common(): string[] {
    return ["--repo", join(this.options.projectRoot, "repository"), "--password-file", "/dev/stdin",
      // Verification must read the repository itself. A cached tree could hide
      // a missing/corrupt pack until a later restore on a cache-free machine.
      "--no-cache", "--json", "--quiet"];
  }
  private async execute(argv: readonly string[], options: { readonly spool?: string; readonly extra?: readonly number[]; readonly stdoutSink?: (bytes: Uint8Array) => void } = {}): Promise<string> {
    const own = this.options;
    let failed: { error: unknown } | undefined;
    // Node's default pipe is a socketpair: Go cannot reopen that socket via
    // /dev/stdin (ENXIO). Pass the owned regular password descriptor as stdin.
    const task = startProcess({ executable: "/proc/self/fd/3", argv: [...this.common, ...argv], stdinFd: own.password,
      cwd: own.source,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C", TZ: "UTC", HOME: own.projectRoot,
        TMPDIR: own.stage, [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) },
      timeoutMs: null, stdoutBytes: options.spool === undefined && options.stdoutSink === undefined ? 1024 * 1024 : 0, stderrBytes: 256 * 1024, stderrOverflow: "discard",
      ...(options.stdoutSink === undefined ? {} : { stdoutOverflow: "discard" as const }),
      ...(options.spool === undefined ? {} : { stdoutSpool: options.spool, stdoutOverflow: "discard" as const }),
    }, { ...(own.signal === undefined ? {} : { signal: own.signal }), processGroup: true,
      inheritedFds: [own.tool, own.fence, own.projectLock, own.stageLease, ...(options.extra ?? [])],
      ...(options.stdoutSink === undefined ? {} : { stdoutSink: (bytes: Uint8Array) => {
        try { options.stdoutSink!(bytes); } catch (error) { failed = { error }; throw error; }
      } }) });
    const result = await task.result;
    await task.closed;
    if (failed !== undefined) throw failed.error;
    return requireResticSuccess(result);
  }
  init(): Promise<string> { return this.execute(["init"]); }
  async backup(society: string, list: string): Promise<string> {
    const fd = withinDirectory(list, (parent, name) => openRegularBeneath(parent, name));
    return withAsyncCleanup(async () => {
      const output = await this.execute(["backup", "--force", "--host", "oma", "--tag", society, "--files-from-raw", "/proc/self/fd/7"], { extra: [fd] });
      const summaries = output.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
        .filter(value => value.message_type === "summary");
      const snapshot = summaries.length === 1 ? summaries[0]!.snapshot_id : null;
      if (typeof snapshot !== "string" || !/^[0-9a-f]{64}$/.test(snapshot))
        throw new StoreError("STORE_CORRUPT", "Restic returned no complete snapshot identity");
      return snapshot;
    }, () => closeSync(fd));
  }
  async inventory(snapshot: string): Promise<string> {
    const file = join(this.options.stage, "snapshot-inventory.jsonl");
    await this.execute(["ls", "--long", snapshot], { spool: file }); return file;
  }
  async compare(snapshot: string, source: CacheTreeObservation): Promise<void> {
    const verifier = new ResticTarVerifier(source);
    await this.execute(["dump", snapshot, "/"], { stdoutSink: bytes => verifier.push(bytes) });
    // A valid tar EOF is insufficient: execute also requires exit 0 and close.
    verifier.finish();
  }
  async restore(snapshot: string, target: string): Promise<void> {
    await this.execute(["restore", snapshot, "--target", target, "--verify", "--sparse"]);
  }
}
