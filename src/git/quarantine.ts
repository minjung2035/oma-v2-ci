/** S-05/GIT-006: the existing disposable namespace recipe, not a new candidate
 * executor. No host fallback parses an untrusted bundle when isolation fails.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { GitPaths } from "./paths.js";
import { StoreError } from "../domain/errors.js";
import { decodeProcessText } from "../process/run.js";
import { PreparationExecutor } from "../process/preparation.js";
import { GIT_ENV } from "../process/policies.js";

const SCRIPT = [
  "set -eu",
  "bundle=$1; project=$2; candidate=$3; export_ref=$4; tmp_bytes=$5; shift 5",
  "root=$1; shift",
  "git=/usr/bin/git",
  "fail_spike() { echo OMA_ERROR=SPIKE_UNRESOLVED >&2; exit 70; }",
  "fail_bundle() { echo OMA_ERROR=BUNDLE_INVALID >&2; exit 71; }",
  "fail_prereq() { echo OMA_ERROR=PREREQUISITE_MISSING >&2; exit 72; }",
  "fail_internal() { echo OMA_ERROR=INTERNAL_ERROR >&2; exit 73; }",
  "mount --make-rprivate / || fail_spike",
  "mkdir -p \"$root/project\" \"$root/bundle\" \"$root/quarantine\"",
  "touch \"$root/bundle/input.bundle\"",
  "cleanup() { umount \"$root/project\" 2>/dev/null || true; umount \"$root/bundle/input.bundle\" 2>/dev/null || true; umount \"$root/quarantine\" 2>/dev/null || true; rmdir \"$root/project\" \"$root/bundle\" \"$root/quarantine\" \"$root/hooks\" \"$root\" 2>/dev/null || true; }",
  "trap cleanup EXIT",
  "mount --bind \"$project\" \"$root/project\" || fail_spike",
  "mount -o remount,bind,ro \"$root/project\" || fail_spike",
  "mount --bind \"$bundle\" \"$root/bundle/input.bundle\" || fail_spike",
  "mount -o remount,bind,ro \"$root/bundle/input.bundle\" || fail_spike",
  "mount -t tmpfs -o size=\"$tmp_bytes\" tmpfs \"$root/quarantine\" || fail_spike",
  "mkdir -p \"$root/quarantine/tmp\"",
  "export TMPDIR=\"$root/quarantine/tmp\"",
  "mkdir -p \"$root/hooks\"",
  "export GIT_CONFIG_VALUE_0=\"$root/hooks\"",
  "repo=\"$root/quarantine/repo\"",
  "format=$($git --git-dir=\"$root/project\" rev-parse --show-object-format) || fail_internal",
  "$git --git-dir=\"$repo\" init -q --bare --object-format=\"$format\" >/dev/null 2>&1 || fail_spike",
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
  "mount -o remount,bind,rw \"$root/project\" || fail_spike",
  "$git --git-dir=\"$root/project\" fetch -q -f --no-tags \"$repo\" +refs/oma/input:refs/oma/input >/dev/null 2>&1 || fail_internal",
  "printf '%s\\n' \"$input\"",
].join("\n");

export class QuarantineImporter {
  private readonly executor = new PreparationExecutor();
  constructor(private readonly paths: GitPaths, private readonly canonicalHas: (candidate: string) => boolean) {}
  async importBundle(bundlePath: string, candidate: string, exportRef: string, prerequisites: readonly string[]): Promise<void> {
    const limits = this.paths.quarantineResources;
    if (!limits || ![limits.cpuSeconds, limits.memoryBytes, limits.tasks, this.paths.quarantineTmpBytes, this.paths.checkTimeoutSeconds]
      .every(value => Number.isSafeInteger(value) && value > 0))
      throw new StoreError("SPIKE_UNRESOLVED", "quarantine resource profile is unavailable");
    const timeoutMs = this.paths.checkTimeoutSeconds * 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 0x7fffffff)
      throw new StoreError("SPIKE_UNRESOLVED", "quarantine timeout cannot be enforced by the native timer");
    if (this.executor.blocked) throw new StoreError("REF_STATE_UNKNOWN", "canonical quarantine preparation is active or uncertain");
    const root = mkdtempSync(join(this.paths.stateRoot, "staging", "quarantine-ns-"));
    let settledNamespaceCommand = false;
    try {
      const result = await this.executor.run({ executable: "/usr/bin/prlimit", argv: [
        `--cpu=${limits.cpuSeconds}`, `--as=${limits.memoryBytes}`, `--nproc=${limits.tasks}`, "--",
        "/usr/bin/env", "-i", "HOME=/nonexistent", "PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TMPDIR=/nonexistent",
        "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
        "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1", "GIT_CONFIG_COUNT=3",
        "GIT_CONFIG_KEY_0=core.hooksPath", "GIT_CONFIG_KEY_1=core.fsync", "GIT_CONFIG_KEY_2=core.fsyncMethod",
        "GIT_CONFIG_VALUE_0=/dev/null", "GIT_CONFIG_VALUE_1=all", "GIT_CONFIG_VALUE_2=fsync",
        "/usr/bin/unshare", "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
        "--kill-child=SIGKILL", "--forward-signals", "--mount-proc", "/bin/sh", "-c", SCRIPT, "oma-quarantine",
        bundlePath, this.paths.projectGit, candidate, exportRef, String(this.paths.quarantineTmpBytes), root, ...prerequisites,
      ], env: GIT_ENV, timeoutMs: Math.max(1000, timeoutMs), stdoutBytes: 4 * 1024 * 1024, stderrBytes: 4 * 1024 * 1024 });
      if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome is ${result.kind}`);
      settledNamespaceCommand = true;
      let stdout: string; let stderr: string;
      try { stdout = decodeProcessText(result.stdout); stderr = decodeProcessText(result.stderr); }
      catch { throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8"); }
      if (result.exitCode !== 0) {
        const code = /OMA_ERROR=(BUNDLE_INVALID|PREREQUISITE_MISSING|INTERNAL_ERROR|SPIKE_UNRESOLVED)/.exec(stderr)?.[1];
        if (code === "BUNDLE_INVALID" || code === "PREREQUISITE_MISSING" || code === "INTERNAL_ERROR" || code === "SPIKE_UNRESOLVED")
          throw new StoreError(code, stderr.slice(0, 400) || "quarantine failed");
        throw new StoreError("SPIKE_UNRESOLVED", "required quarantine namespace is unavailable");
      }
      if (stdout !== `${candidate}\n` || !this.canonicalHas(candidate)) throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
    } finally {
      // No abort/disconnect cleanup of accepted bundle evidence. Unknown native
      // quiescence retains the namespace staging and blocks this executor owner.
      if (settledNamespaceCommand) rmSync(root, { recursive: true, force: true });
    }
  }
}
