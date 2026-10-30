/** Canonical patch streaming, owned before its first asynchronous effect. */
import { join } from "node:path";
import { createResult } from "@oma/tool-files/results";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import { publishedArtifact } from "@oma/storage/preaccept-artifact";
import { PreparationExecutor } from "@oma/process/preparation";
import { GIT_ENV } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";
import type { PreacceptArtifactOwner, ReviewDiffArtifact } from "@oma/contracts/files";
import { CANONICAL_SAFE_ARGS, GIT_BIN } from "./canonical-command.js";
export class ReviewArtifacts {
  private readonly executor = new PreparationExecutor();
  constructor(private readonly repository: string) {}
  async prepare(operation: string, base: string, candidate: string, own: (owner: PreacceptArtifactOwner) => void): Promise<{ diff: ReviewDiffArtifact; preview: Buffer }> {
    const root = join(this.repository, "oma-results"); ensureOwnedDurableDirectory(root, this.repository, 0o700);
    const writer = createResult(root, operation.slice(3));
    // Register synchronously while the creating descriptor still pins its inode.
    try { own(publishedArtifact(writer.path)); }
    catch (error) { writer.close(); throw error; }
    let preview = Buffer.alloc(0);
    try {
      const result = await this.executor.run({ executable: GIT_BIN,
        argv: [...CANONICAL_SAFE_ARGS, "--git-dir", this.repository, "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", base, candidate],
        env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1" }, timeoutMs: null,
        stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 8192, stderrOverflow: "discard" }, undefined, [], {
        stdoutSink: bytes => { const b = Buffer.from(bytes); writer.append(b); if (preview.length < 16384) preview = Buffer.concat([preview, b.subarray(0, 16384 - preview.length)]); },
      });
      if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", `diff generation is ${result.kind}`);
      return { diff: { version: 1, base, candidate, ...writer.finish() }, preview };
    } finally { writer.close(); }
  }
}
