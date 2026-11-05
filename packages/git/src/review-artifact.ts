/** Canonical patch streaming, owned before its first asynchronous effect. */
import { join } from "node:path";
import { closeSync, constants, fstatSync, fsyncSync } from "node:fs";
import { mkdirAt } from "@oma/file-descriptors";
import { openBeneath } from "@oma/native/files";
import { cleanupAll, withCleanup, withAsyncCleanup } from "@oma/native/cleanup";
import { createResult } from "@oma/tool-files/results";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import { publishedArtifact } from "@oma/storage/preaccept-artifact";
import { PreparationExecutor } from "@oma/process/preparation";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";
import type { PreacceptArtifactOwner, ReviewDiffArtifact } from "@oma/contracts/files";
import { CANONICAL_SAFE_ARGS, GIT_BIN, bindCanonicalCommand, type CanonicalExecution } from "./canonical-command.js";
/** Caller owns this cursor. It is relative to the same canonical capability
 * used by Git; the string root remains the logical artifact address. */
export function openReviewDirectory(repository: string, execution?: CanonicalExecution, create = false): number | undefined {
  const project = execution?.directories.get(repository);
  if (project === undefined) return undefined;
  if (create) {
    try { mkdirAt(project, "oma-results", 0o700); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  const directory = openBeneath(project, "oma-results", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const stat = fstatSync(directory);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", "review result directory is not privately owned");
    if (create) { fsyncSync(directory); fsyncSync(project); }
    return directory;
  } catch (error) { return withCleanup(() => { throw error; }, () => closeSync(directory)); }
}
export class ReviewArtifacts {
  private readonly executor = new PreparationExecutor();
  constructor(private readonly repository: string, private readonly execution?: CanonicalExecution) {}
  async prepare(operation: string, base: string, candidate: string, own: (owner: PreacceptArtifactOwner) => void): Promise<{ diff: ReviewDiffArtifact; preview: Buffer }> {
    const root = join(this.repository, "oma-results"), directory = openReviewDirectory(this.repository, this.execution, true);
    let writer: ReturnType<typeof createResult> | undefined;
    return withAsyncCleanup(async () => {
      if (directory === undefined) ensureOwnedDurableDirectory(root, this.repository, 0o700);
      writer = createResult(root, operation.slice(3), directory === undefined ? {} : { directoryFd: directory });
      // Register while the original writer and directory capabilities are held.
      const artifact = publishedArtifact(writer.path, directory);
      try { own(artifact); }
      catch (error) { return withCleanup(() => { throw error; }, () => artifact.discardUnaccepted()); }
      let preview = Buffer.alloc(0);
      const physical = bindCanonicalCommand({ executable: GIT_BIN,
        argv: [...CANONICAL_SAFE_ARGS, "--git-dir", this.repository, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", base, candidate],
        env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1" }, timeoutMs: null,
        stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 8192, stderrOverflow: "discard" }, this.execution);
      const result = await this.executor.run(physical.command, undefined, [], {
        stdoutSink: bytes => { const b = Buffer.from(bytes); writer!.append(b); if (preview.length < 16384) preview = Buffer.concat([preview, b.subarray(0, 16384 - preview.length)]); },
      }, physical.directoryFd === undefined ? {} : { directoryFd: physical.directoryFd });
      if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", `diff generation is ${result.kind}`);
      return { diff: { version: 1, base, candidate, ...writer.finish() }, preview };
    }, () => cleanupAll([() => writer?.close(), () => { if (directory !== undefined) closeSync(directory); }]));
  }
}
