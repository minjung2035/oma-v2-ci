/** CTX-003/004: canonical object and filesystem mechanisms. This owner never
 * chooses a new request, changes an accepted plan, or authorizes a main writer.
 */
import { mkdirSync, lstatSync, chmodSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ContextEntry, Oid } from "../../implementation/contracts.js";
import type { OperationOf, ValidatedPlan } from "../storage/operation-codec.js";
import { StoreError } from "../domain/errors.js";
import { contextEntriesCheck, contextFileCheck, contextPathCheck } from "../domain/context-policy.js";
import { contextRevisionLinkFor } from "../domain/derived.js";
import { isValidFullOid } from "../ids.js";
import { sha256Hex } from "../hash.js";
import { readContextEntry, assertContextDirectory } from "../storage/context-files.js";
import { contextStagingPathAt, contextRevisionPathAt } from "../storage/paths.js";
import { ensureDurableDirectory, fsyncDir, fsyncTree, fsyncFile, writeExclusiveFsyncedFile } from "../storage/durable-fs.js";
import { publishContextRevision, verifyContextRevision } from "../storage/context-snapshot.js";
import { runProcessSync, type ProcessObservation } from "../process/run.js";
import { GIT_ENV } from "../process/policies.js";
import type { GitPaths } from "./paths.js";
import type { GitObserver, GitObservation } from "./observe.js";
import { consumeContextPublication, type ContextPublicationEvidence } from "./context-publication.js";

const CONTEXT_ENV: Readonly<NodeJS.ProcessEnv> = Object.freeze({
  ...GIT_ENV, GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "broker@oma.invalid",
  GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "broker@oma.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_CONFIG_COUNT: "8", GIT_CONFIG_KEY_3: "core.autocrlf", GIT_CONFIG_VALUE_3: "false",
  GIT_CONFIG_KEY_4: "commit.gpgSign", GIT_CONFIG_VALUE_4: "false", GIT_CONFIG_KEY_5: "user.signingKey", GIT_CONFIG_VALUE_5: "",
  GIT_CONFIG_KEY_6: "core.fileMode", GIT_CONFIG_VALUE_6: "false", GIT_CONFIG_KEY_7: "core.excludesFile", GIT_CONFIG_VALUE_7: "/dev/null",
});
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function present<T>(observation: GitObservation<T>, name: string): T {
  if (observation.kind === "present") return observation.value;
  throw new StoreError(observation.kind === "corrupt" ? "STORE_CORRUPT" : "REF_STATE_UNKNOWN", `${name}: ${observation.kind}`);
}
function text(bytes: Uint8Array): string {
  try { return utf8.decode(bytes); } catch { throw new StoreError("STORE_CORRUPT", "context Git returned malformed UTF-8 metadata"); }
}
function oneLine(bytes: Uint8Array): string {
  const value = text(bytes);
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

export class ContextRepository {
  private readonly paths: Readonly<Pick<GitPaths, "stateRoot" | "contextGit" | "worldDir">>;
  constructor(paths: Pick<GitPaths, "stateRoot" | "contextGit" | "worldDir">, private readonly observer: GitObserver) {
    this.paths = Object.freeze({ stateRoot: paths.stateRoot, contextGit: paths.contextGit, worldDir: paths.worldDir });
  }
  private command(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv> = GIT_ENV, stdoutBytes = 4 * 1024 * 1024): ProcessObservation {
    return runProcessSync({ executable: "/usr/bin/git", argv, env, timeoutMs: 120000, stdoutBytes, stderrBytes: 4 * 1024 * 1024 });
  }
  private success(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv> = GIT_ENV, stdoutBytes = 4 * 1024 * 1024): Buffer {
    const result = this.command(argv, env, stdoutBytes);
    if (result.kind !== "exited" || result.exitCode !== 0)
      throw new StoreError("REF_STATE_UNKNOWN", "context Git effect or observation was not completed successfully");
    return result.stdout;
  }
  private exists(): boolean {
    // assertDirectory intentionally treats missing components as corruption.
    // Observe repository absence separately, without swallowing EACCES/EIO.
    const stat = lstatSync(this.paths.contextGit, { throwIfNoEntry: false });
    if (!stat) return false;
    assertContextDirectory(this.paths.contextGit);
    return true;
  }
  current(): Oid | null {
    if (!this.exists()) return null;
    const observed = this.observer.ref(this.paths.contextGit, "refs/heads/main");
    return observed.kind === "absent" ? null : present(observed, "context main");
  }
  private initialize(): "sha1" | "sha256" {
    if (!this.exists()) {
      ensureDurableDirectory(this.paths.contextGit);
      // The former sanitized Git init also used SHA-1 for a new repository.
      this.success(["--git-dir", this.paths.contextGit, "init", "--bare", "--object-format=sha1"]);
      fsyncDir(this.paths.contextGit); fsyncDir(dirname(this.paths.contextGit));
    }
    return present(this.observer.objectFormat(this.paths.contextGit), "context object format");
  }
  private writeEntry(root: string, entry: ContextEntry, bytes: Uint8Array): void {
    if (bytes.byteLength !== entry.bytes || sha256Hex(bytes) !== entry.sha256 || contextFileCheck(entry.path, bytes))
      throw new StoreError("STORE_CORRUPT", `context file does not match frozen intent: ${entry.path}`);
    const path = join(root, entry.path);
    ensureDurableDirectory(dirname(path), 0o700);
    writeExclusiveFsyncedFile(path, bytes, 0o644);
    chmodSync(path, 0o644); fsyncFile(path); fsyncDir(dirname(path));
  }
  private importCandidate(work: string, candidate: Oid): void {
    assertContextDirectory(work); assertContextDirectory(join(work, ".git"));
    if (present(this.observer.ref(join(work, ".git"), "HEAD"), "frozen context HEAD") !== candidate)
      throw new StoreError("STORE_CORRUPT", "staged context HEAD differs from accepted candidate");
    this.success(["--git-dir", this.paths.contextGit, "fetch", "--no-tags", work, candidate]);
    fsyncTree(join(this.paths.contextGit, "objects")); fsyncDir(this.paths.contextGit);
  }

  prepareCandidate(tree: string, entries: ContextEntry[], expected: Oid | null): Oid {
    const invalid = contextEntriesCheck(entries, { requireSorted: true });
    if (invalid) throw new StoreError("STORE_CORRUPT", invalid);
    assertContextDirectory(tree);
    for (const entry of entries) readContextEntry(tree, entry);
    const format = this.initialize();
    if (expected !== null && (!isValidFullOid(expected) || expected.length !== (format === "sha1" ? 40 : 64)))
      throw new StoreError("INVALID_OID", "context base has the wrong repository object format");
    const staging = dirname(tree); const work = join(staging, "commit-work");
    mkdirSync(work, { mode: 0o700 }); fsyncDir(staging);
    this.success(["-C", work, "init", "-q", `--object-format=${format}`], CONTEXT_ENV);
    if (expected !== null) {
      this.success(["-C", work, "fetch", "--no-tags", this.paths.contextGit, expected], CONTEXT_ENV);
      this.success(["-C", work, "update-ref", "HEAD", expected], CONTEXT_ENV);
    }
    // No checkout of a prior tree: only the validated full snapshot enters work.
    this.success(["-C", work, "read-tree", "--empty"], CONTEXT_ENV);
    for (const entry of entries) this.writeEntry(work, entry, readContextEntry(tree, entry));
    this.success(["-C", work, "add", "-f", "-A"], CONTEXT_ENV);
    const committed = this.command(["-C", work, "commit", "-q", "--no-gpg-sign", "-m", "context"], CONTEXT_ENV);
    if (committed.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", "context candidate creation is uncertain");
    if (committed.exitCode !== 0) {
      if (expected === null) throw new StoreError("REF_STATE_UNKNOWN", "initial context commit was not created");
      this.success(["-C", work, "diff", "--cached", "--quiet", expected], CONTEXT_ENV);
    }
    const candidate = present(this.observer.ref(join(work, ".git"), "HEAD"), "prepared context candidate");
    fsyncTree(work, "context-single-link"); fsyncDir(staging); fsyncDir(dirname(staging));
    this.importCandidate(work, candidate);
    this.verifyCandidate(candidate, entries, expected);
    return candidate;
  }

  private blobs(candidate: Oid): Map<string, Oid> {
    const raw = this.success(["--git-dir", this.paths.contextGit, "ls-tree", "-r", "-z", "--full-tree", candidate]);
    if (raw.length === 0 || raw[raw.length - 1] !== 0) throw new StoreError("STORE_CORRUPT", "context candidate has no complete tree manifest");
    const entries = new Map<string, Oid>();
    for (const line of text(raw).slice(0, -1).split("\0")) {
      const tab = line.indexOf("\t");
      if (tab < 0) throw new StoreError("STORE_CORRUPT", "context tree metadata is malformed");
      const fields = line.slice(0, tab).split(" "); const path = line.slice(tab + 1); const oid = fields[2];
      if (fields.length !== 3 || fields[0] !== "100644" || fields[1] !== "blob" || !isValidFullOid(oid) ||
          oid.length !== candidate.length || contextPathCheck(path) || entries.has(path))
        throw new StoreError("STORE_CORRUPT", "context candidate has unsupported paths, modes or duplicate entries");
      entries.set(path, oid);
    }
    return entries;
  }
  private blob(oid: Oid, entry: ContextEntry): Buffer {
    if (!Number.isSafeInteger(entry.bytes + 1)) throw new StoreError("UNSUPPORTED_PROFILE", "context blob observation exceeds the supported byte counter");
    const result = this.command(["--git-dir", this.paths.contextGit, "cat-file", "blob", oid], GIT_ENV, Math.max(1, entry.bytes + 1));
    if (result.kind === "output-limited" && result.stdoutTruncated)
      throw new StoreError("STORE_CORRUPT", "canonical context blob exceeds its accepted size");
    if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", "canonical context blob could not be observed");
    const bytes = result.stdout;
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256 || contextFileCheck(entry.path, bytes))
      throw new StoreError("STORE_CORRUPT", `canonical context bytes differ from the accepted manifest: ${entry.path}`);
    return bytes;
  }
  private verifyCandidate(candidate: Oid, entries: readonly ContextEntry[], base: Oid | null): Map<string, Oid> {
    const invalid = contextEntriesCheck(entries, { requireSorted: true });
    if (invalid) throw new StoreError("STORE_CORRUPT", invalid);
    present(this.observer.commit(this.paths.contextGit, candidate), "canonical context candidate");
    const blobs = this.blobs(candidate);
    if (blobs.size !== entries.length) throw new StoreError("STORE_CORRUPT", "canonical context has missing or additional files");
    for (const entry of entries) {
      const oid = blobs.get(entry.path);
      if (!oid) throw new StoreError("STORE_CORRUPT", "canonical context is missing a frozen entry");
      this.blob(oid, entry);
    }
    if (candidate !== base) {
      const parents = oneLine(this.success(["--git-dir", this.paths.contextGit, "rev-list", "--parents", "-n", "1", candidate]));
      if (parents !== `${candidate}${base === null ? "" : ` ${base}`}`)
        throw new StoreError("STORE_CORRUPT", "context commit parent differs from the accepted base");
    }
    return blobs;
  }
  ensureCandidate(operation: OperationOf<"context.publish">): void {
    const plan = operation.plan;
    if (plan.stagingPath !== contextStagingPathAt(this.paths.stateRoot, operation.id)) throw new StoreError("STORE_CORRUPT", "context staging root differs from accepted identity");
    const observed = this.observer.commit(this.paths.contextGit, plan.candidate);
    if (observed.kind === "absent") this.importCandidate(join(plan.stagingPath, "commit-work"), plan.candidate);
    else present(observed, "accepted canonical context candidate");
    this.verifyCandidate(plan.candidate, plan.entries, plan.base);
  }
  publishSnapshot(operation: OperationOf<"context.publish">, proof: ContextPublicationEvidence): void {
    consumeContextPublication(proof, operation);
    this.ensureCandidate(operation);
    const plan = operation.plan; const work = join(plan.stagingPath, "commit-work");
    const current = lstatSync(work, { throwIfNoEntry: false });
    if (current) assertContextDirectory(work); else ensureDurableDirectory(work, 0o700);
    const blobs = this.blobs(plan.candidate);
    for (const entry of plan.entries) {
      const path = join(work, entry.path);
      if (lstatSync(path, { throwIfNoEntry: false })) readContextEntry(work, entry);
      else {
        const oid = blobs.get(entry.path);
        if (!oid) throw new StoreError("STORE_CORRUPT", "accepted context file disappeared from its canonical tree");
        this.writeEntry(work, entry, this.blob(oid, entry));
      }
    }
    publishContextRevision(this.paths.worldDir, plan.candidate, plan.entries, work);
  }
  snapshotReady(plan: ValidatedPlan<"context.publish">): boolean {
    const link = join(this.paths.worldDir, "context", "current");
    const observed = lstatSync(link, { throwIfNoEntry: false });
    if (!observed) return false;
    if (!observed.isSymbolicLink() || readlinkSync(link) !== contextRevisionLinkFor(plan.candidate))
      throw new StoreError("STORE_CORRUPT", "context current pointer does not name the completed canonical revision");
    const root = contextRevisionPathAt(this.paths.worldDir, plan.candidate);
    if (!lstatSync(root, { throwIfNoEntry: false })) return false;
    this.verifyCandidate(plan.candidate, plan.entries, plan.base);
    verifyContextRevision(root, plan.entries, true);
    return true;
  }
}
