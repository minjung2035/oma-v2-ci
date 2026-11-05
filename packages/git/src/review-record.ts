/** Observational exports from recorded full OIDs. No refs, accepted plans,
 * caller repositories or current HEAD are opened or changed by this owner. */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, openSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewRecordFile, ReviewSourceLeaf, ReviewSourcePath, ReviewSourceRecord } from "@oma/contracts/files";
import { withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { isValidWirePath } from "@oma/domain/identifiers";
import { decodeUtf8 } from "@oma/domain/utf8";
import { runProcessSync } from "@oma/process/run";
import { GIT_ENV } from "@oma/process/policies";
import { fileDigest } from "@oma/storage/file-digest";
import { mkdirAt } from "@oma/file-descriptors";
import { withinDirectory } from "@oma/native/files";
import { removeOwnedEntryAt } from "@oma/storage/directory";
import { CANONICAL_PROCESS_LIMITS, CANONICAL_SAFE_ARGS, GIT_BIN, bindCanonicalCommand, type CanonicalExecution } from "./canonical-command.js";
import { gitOidArgument } from "./observe.js";

/** Parse NUL-framed raw changes incrementally. Neither whole-tree output nor a
 * blob is subject to a presentation budget. One name has the existing wire-path
 * grammar; a failed command or partial frame never becomes an empty delta. */
const RAW_RECORD_BYTES = 4 * 4096 + 256;
function rawPaths(path: string, width: number): readonly ReviewSourcePath[] {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  return withCleanup(() => {
    const paths: ReviewSourcePath[] = [], seen = new Set<string>(), chunk = Buffer.alloc(65536);
    let tail = Buffer.alloc(0), header: string | null = null;
    const leaf = (mode: string, oid: string): ReviewSourceLeaf | null => {
      if (mode === "000000" && oid === "0".repeat(width)) return null;
      if (!["100644", "100755", "120000", "160000"].includes(mode) ||
          !new RegExp(`^[0-9a-f]{${width}}$`).test(oid) || oid === "0".repeat(width))
        throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an invalid leaf identity");
      if (mode !== "100644" && mode !== "100755" && mode !== "120000" && mode !== "160000")
        throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an unsupported leaf mode");
      return Object.freeze({ mode, oid, kind: mode === "160000" ? "gitlink" : "blob" });
    };
    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      const bytes = Buffer.concat([tail, chunk.subarray(0, count)]);
      let from = 0;
      for (;;) {
        const end = bytes.indexOf(0, from);
        if (end < 0) break;
        // The existing grammar bounds UTF-16 units, not UTF-8 bytes.
        if (end - from > RAW_RECORD_BYTES) throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an unrepresentable raw record");
        const text = decodeUtf8(bytes.subarray(from, end)); from = end + 1;
        if (header === null) { header = text; continue; }
        const fields = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDT])$/.exec(header);
        if (!fields || !isValidWirePath(text) || seen.has(text))
          throw new StoreError("REF_STATE_UNKNOWN", "recorded source has malformed or duplicate raw changes");
        const before = leaf(fields[1]!, fields[3]!), after = leaf(fields[2]!, fields[4]!), status = fields[5];
        if ((status === "A" && (before !== null || after === null)) ||
            (status === "D" && (before === null || after !== null)) ||
            ((status === "M" || status === "T") && (before === null || after === null)))
          throw new StoreError("REF_STATE_UNKNOWN", "recorded source status differs from its endpoint identities");
        if (status !== "A" && status !== "M" && status !== "D" && status !== "T")
          throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an unsupported change status");
        seen.add(text); paths.push(Object.freeze({ path: text, status, before, after })); header = null;
      }
      tail = Buffer.from(bytes.subarray(from));
      if (tail.length > RAW_RECORD_BYTES) throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an oversized raw record");
    }
    if (tail.length || header !== null) throw new StoreError("REF_STATE_UNKNOWN", "recorded source has an incomplete raw change");
    return Object.freeze(paths);
  }, () => closeSync(fd));
}

export function withReviewSourceRecord(repository: string, base: string, candidate: string,
    objectFormat: "sha1" | "sha256", consume: (source: ReviewSourceRecord) => undefined, execution?: CanonicalExecution): void {
  gitOidArgument(base); gitOidArgument(candidate);
  const width = objectFormat === "sha1" ? 40 : 64;
  if (base.length !== width || candidate.length !== width)
    throw new StoreError("INVALID_OID", "recorded source differs from the canonical object format");
  const scratch = join(tmpdir(), `oma-review-record-${randomUUID()}`);
  withinDirectory(scratch, (parent, name) => {
    mkdirAt(parent, name, 0o700);
    let active = true, ordinal = 0;
    withCleanup(() => {
      const spool = (args: readonly string[]): ReviewRecordFile => {
        if (!active) throw new StoreError("INTERNAL_ERROR", "review source outlived its observation owner");
        const path = join(scratch, String(ordinal++));
        const physical = bindCanonicalCommand({ executable: GIT_BIN,
          argv: [...CANONICAL_SAFE_ARGS, "--git-dir", repository, ...args],
          env: { ...GIT_ENV, GIT_LITERAL_PATHSPECS: "1" }, timeoutMs: CANONICAL_PROCESS_LIMITS.timeout,
          stdoutBytes: 0, stderrBytes: 8192, stdoutSpool: path }, execution);
        const result = runProcessSync(physical.command, undefined, [], physical.directoryFd === undefined ? {} : { directoryFd: physical.directoryFd });
        if (result.kind === "timed-out") throw new StoreError("DEADLINE_EXCEEDED", "recorded review source observation timed out");
        if (result.kind !== "exited" || result.exitCode !== 0 || result.stderr.length !== 0)
          throw new StoreError("REF_STATE_UNKNOWN", "recorded review source could not be observed completely");
        const digest = fileDigest(path);
        if (digest.stat.nlink !== 1) throw new StoreError("REF_STATE_UNKNOWN", "review observation spool has an unexpected alias");
        return Object.freeze({ path, bytes: digest.stat.size, sha256: digest.sha256 });
      };
      const raw = spool(["diff-tree", "--no-commit-id", "--raw", "--no-abbrev", "-r", "-z", "--no-renames", base, candidate, "--"]);
      const paths = rawPaths(raw.path, width);
      const patch = spool(["diff", "--binary", "--full-index", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color",
        "--diff-algorithm=myers", "--no-indent-heuristic", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/", base, candidate, "--"]);
      const allowed = new Set(paths.flatMap(path => [path.before, path.after].flatMap(leaf => leaf?.kind === "blob" ? [leaf.oid] : [])));
      const blobs = new Map<string, ReviewRecordFile>();
      const source: ReviewSourceRecord = Object.freeze({ base, candidate, objectFormat, patch, paths,
        withBlob(oid: string, receiver: (file: ReviewRecordFile) => undefined): void {
          if (!active) throw new StoreError("INTERNAL_ERROR", "review source outlived its observation owner");
          if (!allowed.has(oid)) throw new StoreError("INVALID_REQUEST", "blob does not belong to these exact recorded endpoints");
          let file = blobs.get(oid);
          if (!file) {
            file = spool(["cat-file", "blob", gitOidArgument(oid)]);
            const hash = createHash(objectFormat).update(`blob ${file.bytes}\0`);
            const fd = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            withCleanup(() => {
              const chunk = Buffer.alloc(65536);
              for (;;) { const count = readSync(fd, chunk, 0, chunk.length, null); if (!count) break; hash.update(chunk.subarray(0, count)); }
            }, () => closeSync(fd));
            if (hash.digest("hex") !== oid) throw new StoreError("REF_STATE_UNKNOWN", "observed blob bytes differ from their full object identity");
            blobs.set(oid, file);
          }
          if (receiver(file) !== undefined) throw new StoreError("INTERNAL_ERROR", "review blob consumer must be synchronous and return undefined");
        } });
      if (consume(source) !== undefined) throw new StoreError("INTERNAL_ERROR", "review source consumer must be synchronous and return undefined");
    }, () => { active = false; removeOwnedEntryAt(parent, name); });
  });
}
