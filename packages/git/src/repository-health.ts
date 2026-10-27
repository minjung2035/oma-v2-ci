import { GIT_ENV } from "@oma/process/policies";
import type { CommandSpec, ProcessObservation } from "@oma/process/command";
import { StoreError } from "@oma/domain/errors";

/** Shared observation policy; the caller owns the repository and child lease. */
export function repositoryHealthCommand(repository: string, diagnostics?: string): CommandSpec {
  return { executable: "/usr/bin/git",
    argv: ["--git-dir", repository, "fsck", "--strict", "--no-reflogs", "--progress"], env: GIT_ENV,
    timeoutMs: 24 * 3600 * 1000, silenceMs: 120000,
    stdoutBytes: 1024 * 1024, stderrBytes: 1024 * 1024,
    stdoutOverflow: "discard", stderrOverflow: "discard",
    ...(diagnostics === undefined ? {} : { stderrSpool: diagnostics }) };
}
export function requireHealthyRepository(result: ProcessObservation): void {
  if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", "repository health observation is uncertain");
  if (result.exitCode !== 0) throw new StoreError("STORE_CORRUPT", "repository health observation failed");
}
