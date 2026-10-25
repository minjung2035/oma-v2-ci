/** Restic argv and child/FD lifetime. Storage supplies stream validation;
 * this module cannot interpret checkpoints, tree digests or archive metadata. */
import { closeSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { openRegularBeneath, withinDirectory } from "@oma/native/files";
import { startProcess } from "./async.js";
import type { ProcessObservation } from "./command.js";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./fence.js";
import { inheritedDescriptorPath } from "@oma/native/descriptor-path";

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
    const task = startProcess({ executable: inheritedDescriptorPath(3, "execute"), argv: [...this.common, ...argv], stdinFd: own.password,
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
    const file = join(this.options.stage, "snapshot-inventory.jsonl");
    await this.execute(["ls", "--long", snapshot], { spool: file }); return file;
  }
  async dump(snapshot: string, consume: (bytes: Uint8Array) => void): Promise<void> {
    await this.execute(["dump", snapshot, "/"], { stdoutSink: consume });
  }
  async restore(snapshot: string, target: string): Promise<void> {
    await this.execute(["restore", snapshot, "--target", target, "--verify", "--sparse"]);
  }
}
