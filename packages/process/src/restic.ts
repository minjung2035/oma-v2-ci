/** Restic argv and child/FD lifetime. Storage supplies stream validation;
 * this module cannot interpret checkpoints, tree digests or archive metadata. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { setLinkTimesAt } from "@oma/native/posix-files";
import { startProcess } from "./async.js";
import type { ProcessObservation } from "./command.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./fence.js";
import { inheritedDescriptorPath } from "@oma/native/descriptor-path";
import { bundledJobHelper } from "@oma/native/darwin-job-launch";
import { resticReleaseFor } from "@oma/domain/deployment";
import { launchDarwinJobScope } from "./darwin-execution.js";
import { ExecutionNotStarted, type CommandSpec } from "@oma/domain/process-command";

export function requireResticSuccess(result: ProcessObservation): string {
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("BROKER_UNAVAILABLE", `session storage command ${result.kind}${result.kind === "exited" ? ` (${result.exitCode})` : ""}: ${result.stderr.toString("utf8").slice(0, 400)}`);
  return result.stdout.toString("utf8");
}
export interface ResticProcessOptions {
  readonly tool: number; readonly password: number; readonly fence: number;
  readonly projectLock: number; readonly stageLease: number;
  readonly projectRoot: string; readonly stage: string; readonly source: string;
  /** Darwin: the installation path the held `tool` was verified from. Darwin
   * refuses exec through /dev/fd, so its job scope selects this path and binds
   * the mapped image to the pinned digest before release. */
  readonly executable?: string;
  readonly signal?: AbortSignal;
}
/** The pinned Restic main image, selected by digest and released only after the
 * Darwin job helper matches the mapped image's CodeDirectory. Same argv, env,
 * stdio and descriptor slots as the Linux descriptor exec. */
async function runDarwinRestic(executable: string, command: Omit<CommandSpec, "executable" | "cwd">, cwd: string,
  slots: readonly number[], fence: number | undefined, signal: AbortSignal | undefined, stdoutSink?: (bytes: Uint8Array) => void): Promise<ProcessObservation> {
  const pin = resticReleaseFor(process.platform, process.arch);
  if (pin === null) throw new StoreError("UNSUPPORTED_PROFILE", "session storage requires a pinned Restic release for this host");
  const helper = createHash("sha256").update(readFileSync(bundledJobHelper())).digest("hex");
  const directory = openSync(cwd, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  return withAsyncCleanup(async () => {
    const scope = await launchDarwinJobScope({ ...command, executable } as CommandSpec, {
      files: slots.map((fd, index) => ({ target: index + 3, fd })), ...(fence === undefined ? {} : { cooperationFd: fence }), directoryFd: directory,
      imageDigests: { helper, images: [pin.binarySha256] },
      ...(signal === undefined ? {} : { signal }), ...(stdoutSink === undefined ? {} : { stdoutSink }) })
      .catch(error => { throw error instanceof ExecutionNotStarted && error.cause !== undefined ? error.cause : error; });
    try {
      await scope.prepared;
      scope.release();
      const result = await scope.result;
      await scope.closed;
      return result;
    } catch (error) {
      try { scope.terminate(); await scope.closed; } catch { /* the original failure is reported */ }
      throw error;
    } finally { scope.close(); }
  }, () => closeSync(directory));
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
    const slots = [own.tool, own.fence, own.projectLock, own.stageLease, ...(options.extra ?? [])];
    if (process.platform === "darwin") {
      if (own.executable === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "Darwin session storage requires the verified Restic installation path");
      const sink = options.stdoutSink === undefined ? undefined : (bytes: Uint8Array) => {
        try { options.stdoutSink!(bytes); } catch (error) { failed = { error }; throw error; }
      };
      // Darwin's /dev/stdin open duplicates the descriptor and shares its offset, so a
      // second command would read the held password at EOF. Read it positioned
      // (the held offset is unchanged) and give each command its own stdin pipe.
      const size = fstatSync(own.password).size;
      if (!Number.isSafeInteger(size) || size < 1 || size > 4096) throw new StoreError("STORE_CORRUPT", "session storage password has an invalid size");
      const secret = Buffer.alloc(size);
      if (readSync(own.password, secret, 0, size, 0) !== size) throw new StoreError("STORE_CORRUPT", "session storage password could not be read whole");
      const result = await runDarwinRestic(own.executable, { argv: [...this.common, ...argv], input: secret,
        env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C", TZ: "UTC", HOME: own.projectRoot, TMPDIR: own.stage, [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) },
        timeoutMs: null, stdoutBytes: options.spool === undefined && options.stdoutSink === undefined ? 1024 * 1024 : 0, stderrBytes: 256 * 1024, stderrOverflow: "discard",
        ...(options.stdoutSink === undefined ? {} : { stdoutOverflow: "discard" as const }),
        ...(options.spool === undefined ? {} : { stdoutSpool: options.spool, stdoutOverflow: "discard" as const }) }, own.source, slots, own.fence, own.signal, sink);
      if (failed !== undefined) throw failed.error;
      return requireResticSuccess(result);
    }
    const task = startProcess({ executable: inheritedDescriptorPath(3, "execute"), argv: [...this.common, ...argv], stdinFd: own.password,
      cwd: own.source,
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C", TZ: "UTC", HOME: own.projectRoot,
        TMPDIR: own.stage, [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) },
      timeoutMs: null, stdoutBytes: options.spool === undefined && options.stdoutSink === undefined ? 1024 * 1024 : 0, stderrBytes: 256 * 1024, stderrOverflow: "discard",
      ...(options.stdoutSink === undefined ? {} : { stdoutOverflow: "discard" as const }),
      ...(options.spool === undefined ? {} : { stdoutSpool: options.spool, stdoutOverflow: "discard" as const }),
    }, { ...(own.signal === undefined ? {} : { signal: own.signal }), processGroup: true,
      inheritedFds: slots,
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
      const output = await this.execute(["backup", "--force", "--host", "oma", "--tag", society, "--files-from-raw", inheritedDescriptorPath(7, "read")], { extra: [fd] });
      const summaries = output.split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
        .filter(value => value.message_type === "summary");
      const snapshot = summaries.length === 1 ? summaries[0]!.snapshot_id : null;
      if (typeof snapshot !== "string" || !/^[0-9a-f]{64}$/.test(snapshot))
        throw new StoreError("STORE_CORRUPT", "Restic returned no complete snapshot identity");
      return snapshot;
    }, () => closeSync(fd));
  }
  async inventory(snapshot: string): Promise<string> {
    const file = join(this.options.stage, `snapshot-inventory-${randomUUID()}.jsonl`);
    await this.execute(["ls", "--long", snapshot], { spool: file }); return file;
  }
  async dump(snapshot: string, consume: (bytes: Uint8Array) => void): Promise<void> {
    await this.execute(["dump", snapshot, "/"], { stdoutSink: consume });
  }
  async restore(snapshot: string, target: string): Promise<void> {
    await this.execute(["restore", snapshot, "--target", target, "--verify", "--sparse"]);
    // The pinned Restic does not restore a symlink's own time on Darwin. The
    // snapshot holds it exactly; apply it, then the caller's digest verifies.
    if (process.platform === "darwin") for (const link of await this.links(snapshot))
      withinDirectory(join(target, link.path), (parent, name) => setLinkTimesAt(parent, name, link.mtimeNs));
  }
  private async links(snapshot: string): Promise<readonly { readonly path: string; readonly mtimeNs: bigint }[]> {
    const file = join(this.options.stage, `snapshot-links-${randomUUID()}.jsonl`);
    await this.execute(["ls", "--json", snapshot], { spool: file });
    const links: { path: string; mtimeNs: bigint }[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.length === 0) continue;
      const node = JSON.parse(line) as Record<string, unknown>;
      if (node.type !== "symlink") continue;
      if (typeof node.path !== "string" || !node.path.startsWith("/") || node.path.split("/").some((part, index) => index > 0 && (part === "" || part === "." || part === "..")))
        throw new StoreError("STORE_CORRUPT", "Restic listed a symlink outside its snapshot tree");
      links.push({ path: node.path.slice(1), mtimeNs: rfc3339Nanoseconds(node.mtime) });
    }
    return links;
  }
}
/** RFC 3339 with up to nanosecond precision and any offset, as exact nanoseconds. */
function rfc3339Nanoseconds(value: unknown): bigint {
  const match = typeof value === "string" ? /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value) : null;
  if (match === null) throw new StoreError("STORE_CORRUPT", "Restic listed an unreadable symlink time");
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  let seconds = BigInt(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) / 1000);
  if (zone !== "Z") seconds -= BigInt((zone!.startsWith("-") ? -1 : 1) * (Number(zone!.slice(1, 3)) * 3600 + Number(zone!.slice(4, 6)) * 60));
  return seconds * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}
/** Setup's post-install check of the held, verified installation (Darwin has no
 * descriptor exec): `restic version` through the same image-verified scope. */
export async function verifyInstalledDarwinRestic(executable: string, held: number): Promise<string> {
  if (process.platform !== "darwin") throw new StoreError("UNSUPPORTED_PROFILE", "Darwin Restic verification requires Darwin");
  return requireResticSuccess(await runDarwinRestic(executable, { argv: ["version"], env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    timeoutMs: 10000, stdoutBytes: 65536, stderrBytes: 65536 }, "/", [held], undefined, undefined));
}
