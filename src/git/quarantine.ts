/** S-05/GIT-006: the existing disposable namespace recipe, not a new candidate
 * executor. No host fallback parses an untrusted bundle when isolation fails.
 */
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureDirectory } from "../storage/directory.js";
import { TreeLease, collectLeasedTree } from "../storage/tree-lease.js";
import { entryAt, withinDirectory } from "../storage/contained-fs.js";
import type { GitPaths } from "./paths.js";
import { StoreError } from "../domain/errors.js";
import { decodeProcessText } from "../process/run.js";
import { PreparationExecutor } from "../process/preparation.js";
import { GIT_ENV } from "../process/policies.js";
import { CANONICAL_PROCESS_LIMITS } from "./canonical-command.js";

/** The quarantine's resource profile: its CPU, memory and task bounds, and the
 * deadline of one bundle import start to end. P0V-29, P0-2: the import is
 * canonical Git work in a disposable repository and is bounded like the
 * canonical Git commands; it is not an integration check, whose deadline it
 * used to take (1 s when, as by default, there are no checks). */
export const QUARANTINE_RESOURCES = Object.freeze({
  cpuSeconds: 30, memoryBytes: 512 * 1024 * 1024, tasks: 1024, timeoutSeconds: CANONICAL_PROCESS_LIMITS.timeout / 1000,
});

const SCRIPT = [
  "set -eu",
  "bundle=$1; project=$2; candidate=$3; export_ref=$4; tmp_bytes=$5; shift 5",
  "root=$1; shift",
  "git=/usr/bin/git",
  "fail_unsupported() { echo OMA_ERROR=UNSUPPORTED_PROFILE >&2; exit 70; }",
  "fail_bundle() { echo OMA_ERROR=BUNDLE_INVALID >&2; exit 71; }",
  "fail_prereq() { echo OMA_ERROR=PREREQUISITE_MISSING >&2; exit 72; }",
  "fail_internal() { echo OMA_ERROR=INTERNAL_ERROR >&2; exit 73; }",
  "mount --make-rprivate / || fail_unsupported",
  "mkdir -p \"$root/project\" \"$root/bundle\" \"$root/quarantine\"",
  "touch \"$root/bundle/input.bundle\"",
  "cleanup() { umount \"$root/project\" 2>/dev/null || true; umount \"$root/bundle/input.bundle\" 2>/dev/null || true; umount \"$root/quarantine\" 2>/dev/null || true; rmdir \"$root/project\" \"$root/bundle\" \"$root/quarantine\" \"$root/hooks\" \"$root\" 2>/dev/null || true; }",
  "trap cleanup EXIT",
  "mount --bind \"$project\" \"$root/project\" || fail_unsupported",
  "mount -o remount,bind,ro \"$root/project\" || fail_unsupported",
  "mount -t tmpfs -o size=\"$tmp_bytes\" tmpfs \"$root/quarantine\" || fail_unsupported",
  // Read the inherited checked descriptor into the existing bounded private tmpfs.
  // A descriptor from the parent mount namespace is not a portable bind-mount source.
  "cat \"$bundle\" > \"$root/quarantine/input.bundle\" || fail_unsupported",
  "mount --bind \"$root/quarantine/input.bundle\" \"$root/bundle/input.bundle\" || fail_unsupported",
  "mount -o remount,bind,ro \"$root/bundle/input.bundle\" || fail_unsupported",
  "mkdir -p \"$root/quarantine/tmp\"",
  "export TMPDIR=\"$root/quarantine/tmp\"",
  "mkdir -p \"$root/hooks\"",
  "export GIT_CONFIG_VALUE_0=\"$root/hooks\"",
  "repo=\"$root/quarantine/repo\"",
  "format=$($git --git-dir=\"$root/project\" rev-parse --show-object-format) || fail_internal",
  "$git --git-dir=\"$repo\" init -q --bare --object-format=\"$format\" >/dev/null 2>&1 || fail_unsupported",
  "mkdir -p \"$repo/objects/info\"",
  "printf '%s\\n' \"$root/project/objects\" > \"$repo/objects/info/alternates\"",
  "$git --git-dir=\"$repo\" bundle verify \"$root/bundle/input.bundle\" >/dev/null 2>&1 || fail_bundle",
  "heads=$($git --git-dir=\"$repo\" bundle list-heads \"$root/bundle/input.bundle\" 2>/dev/null) || fail_bundle",
  "count=0; head_ref=''",
  "while IFS= read -r line; do [ -z \"$line\" ] && continue; count=$((count + 1)); head_ref=${line##* }; done <<EOF",
  "$heads",
  "EOF",
  "[ \"$count\" -eq 1 ] && [ \"$head_ref\" = \"$export_ref\" ] || fail_bundle",
  "refspec=\"$export_ref:refs/oma/input\"",
  "$git --git-dir=\"$repo\" fetch -q --no-tags \"$root/bundle/input.bundle\" \"$refspec\" >/dev/null 2>&1 || fail_bundle",
  "input=$($git --git-dir=\"$repo\" rev-parse refs/oma/input 2>/dev/null) || fail_bundle",
  "[ \"$input\" = \"$candidate\" ] || fail_bundle",
  "$git --git-dir=\"$repo\" fsck --strict --no-reflogs >/dev/null 2>&1 || fail_bundle",
  "for prerequisite in \"$@\"; do $git --git-dir=\"$repo\" cat-file -e \"$prerequisite^{commit}\" >/dev/null 2>&1 || fail_prereq; done",
  "mount -o remount,bind,rw \"$root/project\" || fail_unsupported",
  // Import objects only. The coordinator owns the later immutable published ref.
  "$git --git-dir=\"$root/project\" fetch -q --no-tags --no-write-fetch-head --no-auto-maintenance --refmap= \"$repo\" refs/oma/input >/dev/null 2>&1 || fail_internal",
  "printf '%s\\n' \"$input\"",
].join("\n");

export class QuarantineImporter {
  private readonly executor = new PreparationExecutor();
  constructor(private readonly paths: GitPaths, private readonly canonicalHas: (candidate: string) => boolean) {}
  async importBundle(bundleFd: number, candidate: string, exportRef: string, prerequisites: readonly string[]): Promise<void> {
    const limits = this.paths.quarantineResources;
    if (!limits || ![limits.cpuSeconds, limits.memoryBytes, limits.tasks, limits.timeoutSeconds, this.paths.quarantineTmpBytes]
      .every(value => Number.isSafeInteger(value) && value > 0))
      throw new StoreError("UNSUPPORTED_PROFILE", "quarantine resource profile is unavailable");
    const timeoutMs = limits.timeoutSeconds * 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 0x7fffffff)
      throw new StoreError("UNSUPPORTED_PROFILE", "quarantine timeout cannot be enforced by the native timer");
    if (this.executor.blocked) throw new StoreError("REF_STATE_UNKNOWN", "canonical quarantine preparation is active or uncertain");
    // FS-005: made under a staging directory resolved once, and removed the same way.
    const staging = join(this.paths.stateRoot, "staging");
    ensureDirectory(staging);
    const root = join(staging, `quarantine-ns-${randomUUID()}`);
    // R6-04: the lease first, then the tree; every process of the namespace
    // command holds it, so a later start can prove they are all gone.
    const lease = TreeLease.take(root);
    let settledNamespaceCommand = false;
    try { withinDirectory(root, (parent, name) => mkdirSync(entryAt(parent, name), { mode: 0o700 })); }
    catch (error) { lease.release(); throw error; }
    try {
      const result = await this.executor.run({ executable: "/usr/bin/prlimit", argv: [
        `--cpu=${limits.cpuSeconds}`, `--as=${limits.memoryBytes}`, `--nproc=${limits.tasks}`, "--",
        "/usr/bin/env", "-i", "HOME=/nonexistent", "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TMPDIR=/nonexistent",
        "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
        "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1", "GIT_CONFIG_COUNT=3",
        "GIT_CONFIG_KEY_0=core.hooksPath", "GIT_CONFIG_KEY_1=core.fsync", "GIT_CONFIG_KEY_2=core.fsyncMethod",
        "GIT_CONFIG_VALUE_0=/dev/null", "GIT_CONFIG_VALUE_1=all", "GIT_CONFIG_VALUE_2=fsync",
        // The executor ends this tree only with SIGKILL to its process group,
        // which no process can forward; --kill-child is what takes the forked
        // namespace with unshare. util-linux 2.41 has no --forward-signals.
        "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
        "--kill-child=SIGKILL", "--mount-proc", "/bin/sh", "-c", SCRIPT, "oma-quarantine",
        "/proc/self/fd/3", this.paths.projectGit, candidate, exportRef, String(this.paths.quarantineTmpBytes), root, ...prerequisites,
      ], env: GIT_ENV, timeoutMs, stdoutBytes: 4 * 1024 * 1024, stderrBytes: 4 * 1024 * 1024 }, undefined, [bundleFd, lease.descriptor]);
      if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome is ${result.kind}`);
      settledNamespaceCommand = true;
      let stdout: string; let stderr: string;
      try { stdout = decodeProcessText(result.stdout); stderr = decodeProcessText(result.stderr); }
      catch { throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8"); }
      if (result.exitCode !== 0) {
        const code = /OMA_ERROR=(BUNDLE_INVALID|PREREQUISITE_MISSING|INTERNAL_ERROR|UNSUPPORTED_PROFILE)/.exec(stderr)?.[1];
        if (code === "BUNDLE_INVALID" || code === "PREREQUISITE_MISSING" || code === "INTERNAL_ERROR" || code === "UNSUPPORTED_PROFILE")
          throw new StoreError(code, stderr.slice(0, 400) || "quarantine failed");
        throw new StoreError("UNSUPPORTED_PROFILE", "required quarantine namespace is unavailable");
      }
      if (stdout !== `${candidate}\n` || !this.canonicalHas(candidate)) throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
    } finally {
      // No abort/disconnect cleanup of accepted bundle evidence. Unknown native
      // quiescence retains the namespace staging and blocks this executor owner;
      // its lease tells the next start when the namespace is gone.
      lease.release();
      if (settledNamespaceCommand) collectLeasedTree(root);
    }
  }
}
