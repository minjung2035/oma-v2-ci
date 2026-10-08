/** S-05/GIT-006: the existing disposable namespace recipe, not a new candidate
 * executor. No host fallback parses an untrusted bundle when isolation fails.
 *
 * The import is no longer bounded by a clock on the whole recipe: the script
 * reports its own progress -- a phase marker before each stage, `dd`'s own
 * status on the bundle copy, `--progress` on every fsck/fetch, and a 15 s
 * heartbeat dot around the quiet plumbing checks -- so the executor's
 * silence window is what ends a dead command, and only the generous ceiling
 * ends one that never stops producing output. stderr is spooled whole
 * (progress must never become an in-memory refusal); the parent reads its
 * tail for the `OMA_ERROR=` word. A run that never reached a complete
 * observation blocks the importer only until the retained staging's lease
 * proves the namespace's children are gone -- the stale unknown clears on
 * that fresh observation, never on the attempt.
 */
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureOwnedDirectory } from "../storage/directory.js";
import { TreeLease, collectLeasedTree } from "../storage/tree-lease.js";
import { entryAt, withinDirectory } from "../storage/contained-fs.js";
import type { GitPaths } from "./paths.js";
import { StoreError } from "../domain/errors.js";
import { decodeProcessText, type ProcessObservation } from "../process/run.js";
import { PreparationExecutor } from "../process/preparation.js";
import { GIT_ENV } from "../process/policies.js";
import { CANONICAL_PROCESS_LIMITS } from "./canonical-command.js";

/** The quarantine's resource profile: its CPU, memory and task bounds, and the
 * deadline of one bundle import start to end. P0V-29, P0-2: the import is
 * canonical Git work in a disposable repository and is bounded like the
 * canonical Git commands; it is not an integration check, whose deadline it
 * used to take (1 s when, as by default, there are no checks). */
export const QUARANTINE_RESOURCES = Object.freeze({
  cpuSeconds: 30, memoryBytes: 512 * 1024 * 1024, tasks: 1024,
  // A generous ceiling on the whole import, never its deadline: the
  // silence window ends a child that stopped producing output and only
  // this ceiling ends one that never stops -- a defect, not slow work.
  timeoutSeconds: 24 * 3600, silenceSeconds: 120,
});

const SCRIPT = [
  "set -eu",
  "bundle=$1; project=$2; candidate=$3; export_ref=$4; tmp_bytes=$5; shift 5",
  "root=$1; shift",
  "git=/usr/bin/git",
  // A working stage is never silent: phase markers bound each one, dd/fsck/
  // fetch carry their own progress, and a 15 s heartbeat covers the quiet
  // plumbing. Every byte re-arms the parent's silence window.
  "phase() { printf 'OMA_PHASE=%s\\n' \"$1\" >&2; }",
  "heartbeat=",
  "hb_off() { if [ -n \"$heartbeat\" ]; then kill \"$heartbeat\" 2>/dev/null || true; wait \"$heartbeat\" 2>/dev/null || true; heartbeat=; fi; }",
  // The heartbeat must not inherit a caller's command-substitution pipe on
  // stdout: the pipe would stay open until `sleep` exits and `$( )` would hang.
  "hb_start() { hb_off; ( while :; do sleep 15; printf '.' >&2; done ) >&- & heartbeat=$!; }",
  // `beat` silences nothing; `beatq` silences the command's own stderr while
  // its heartbeat still reaches the real one.
  "beat() { hb_start; \"$@\"; rc=$?; hb_off; return \"$rc\"; }",
  "beatq() { hb_start; \"$@\" 2>/dev/null; rc=$?; hb_off; return \"$rc\"; }",
  "fail_unsupported() { hb_off; printf '\\nOMA_ERROR=UNSUPPORTED_PROFILE\\n' >&2; exit 70; }",
  "fail_bundle() { hb_off; printf '\\nOMA_ERROR=BUNDLE_INVALID\\n' >&2; exit 71; }",
  "fail_prereq() { hb_off; printf '\\nOMA_ERROR=PREREQUISITE_MISSING\\n' >&2; exit 72; }",
  "fail_internal() { hb_off; printf '\\nOMA_ERROR=INTERNAL_ERROR\\n' >&2; exit 73; }",
  "fail_refstate() { hb_off; printf '\\nOMA_ERROR=REF_STATE_UNKNOWN\\n' >&2; exit 74; }",
  "mount --make-rprivate / || fail_unsupported",
  "phase mounts",
  "mkdir -p \"$root/project\" \"$root/bundle\" \"$root/quarantine\"",
  "touch \"$root/bundle/input.bundle\"",
  "cleanup() { hb_off; umount \"$root/project\" 2>/dev/null || true; umount \"$root/bundle/input.bundle\" 2>/dev/null || true; umount \"$root/quarantine\" 2>/dev/null || true; rmdir \"$root/project\" \"$root/bundle\" \"$root/quarantine\" \"$root/hooks\" \"$root\" 2>/dev/null || true; }",
  "trap cleanup EXIT",
  "mount --bind \"$project\" \"$root/project\" || fail_unsupported",
  "mount -o remount,bind,ro \"$root/project\" || fail_unsupported",
  // NB-01: the tmpfs holds the copied bundle AND the freshly written object
  // store -- roughly twice the declared bound -- so the size argument is the
  // tmpfs capacity, not the bundle bound alone.
  "mount -t tmpfs -o size=\"$tmp_bytes\" tmpfs \"$root/quarantine\" || fail_unsupported",
  // Read the inherited checked descriptor into the existing bounded private tmpfs.
  // A descriptor from the parent mount namespace is not a portable bind-mount source.
  "phase input",
  "dd if=\"$bundle\" of=\"$root/quarantine/input.bundle\" bs=1048576 iflag=fullblock status=progress || fail_unsupported",
  "mount --bind \"$root/quarantine/input.bundle\" \"$root/bundle/input.bundle\" || fail_unsupported",
  "mount -o remount,bind,ro \"$root/bundle/input.bundle\" || fail_unsupported",
  "mkdir -p \"$root/quarantine/tmp\"",
  "export TMPDIR=\"$root/quarantine/tmp\"",
  "mkdir -p \"$root/hooks\"",
  "export GIT_CONFIG_VALUE_0=\"$root/hooks\"",
  "repo=\"$root/quarantine/repo\"",
  "phase init",
  "format=$(beat $git --git-dir=\"$root/project\" rev-parse --show-object-format) || fail_internal",
  "beatq $git --git-dir=\"$repo\" init -q --bare --object-format=\"$format\" >/dev/null || fail_unsupported",
  "mkdir -p \"$repo/objects/info\"",
  "printf '%s\\n' \"$root/project/objects\" > \"$repo/objects/info/alternates\"",
  "phase bundle-verify",
  "beatq $git --git-dir=\"$repo\" bundle verify \"$root/bundle/input.bundle\" >/dev/null || fail_bundle",
  "heads=$(beatq $git --git-dir=\"$repo\" bundle list-heads \"$root/bundle/input.bundle\") || fail_bundle",
  "count=0; head_ref=''",
  "while IFS= read -r line; do [ -z \"$line\" ] && continue; count=$((count + 1)); head_ref=${line##* }; done <<EOF",
  "$heads",
  "EOF",
  "[ \"$count\" -eq 1 ] && [ \"$head_ref\" = \"$export_ref\" ] || fail_bundle",
  "phase fetch",
  "refspec=\"$export_ref:refs/oma/input\"",
  "$git --git-dir=\"$repo\" fetch --progress --no-tags \"$root/bundle/input.bundle\" \"$refspec\" >/dev/null || fail_bundle",
  "input=$(beatq $git --git-dir=\"$repo\" rev-parse refs/oma/input) || fail_bundle",
  "[ \"$input\" = \"$candidate\" ] || fail_bundle",
  // NB-02: fsck traverses alternates, so canonical-side damage used to read as
  // a bad bundle. On failure, fsck the canonical store itself: canonical damage
  // is a state observation (REF_STATE_UNKNOWN), never a bundle defect.
  "phase fsck",
  "if ! $git --git-dir=\"$repo\" fsck --strict --no-reflogs --progress >/dev/null; then",
  "  $git --git-dir=\"$root/project\" fsck --strict --no-reflogs --progress >/dev/null || fail_refstate",
  "  fail_bundle",
  "fi",
  "phase prerequisites",
  "hb_start; for prerequisite in \"$@\"; do $git --git-dir=\"$repo\" cat-file -e \"$prerequisite^{commit}\" >/dev/null 2>&1 || fail_prereq; done; hb_off",
  "mount -o remount,bind,rw \"$root/project\" || fail_unsupported",
  "phase import",
  // Import objects only. The coordinator owns the later immutable published ref.
  "$git --git-dir=\"$root/project\" fetch --progress --no-tags --no-write-fetch-head --no-auto-maintenance --refmap= \"$repo\" refs/oma/input >/dev/null || fail_internal",
  "printf '%s\\n' \"$input\"",
].join("\n");

/** The bytes the classifier reads for `OMA_ERROR=`: the stderr spool's tail
 * (the failure word is always the command's last word) or the retained head
 * when the run was small enough to keep. */
function classificationText(result: ProcessObservation): string | null {
  let bytes: Buffer | Uint8Array = result.stderr;
  if (result.stderrSpooledTo !== undefined) {
    const tail = ((): Buffer | null => {
      try {
        const fd = openSync(result.stderrSpooledTo!, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const size = fstatSync(fd).size, span = Math.min(size, 256 * 1024);
          const out = Buffer.alloc(span);
          for (let at = 0; at < span;) at += readSync(fd, out, at, span - at, size - span + at);
          return out;
        } finally { closeSync(fd); }
      } catch { return null; }
    })();
    if (tail === null) return null;
    bytes = tail;
  }
  try { return decodeProcessText(bytes); } catch { return null; }
}

export class QuarantineImporter {
  private readonly executor = new PreparationExecutor();
  /** The staging an unproven run left behind; its lease is the death proof. */
  private staleRoot: string | null = null;
  constructor(private readonly paths: GitPaths, private readonly canonicalHas: (candidate: string) => boolean) {}
  async importBundle(bundleFd: number, candidate: string, exportRef: string, prerequisites: readonly string[]): Promise<void> {
    const limits = this.paths.quarantineResources;
    if (!limits || ![limits.cpuSeconds, limits.memoryBytes, limits.tasks, limits.timeoutSeconds, limits.silenceSeconds, this.paths.quarantineTmpBytes]
      .every(value => Number.isSafeInteger(value) && value > 0) || limits.silenceSeconds > limits.timeoutSeconds)
      throw new StoreError("UNSUPPORTED_PROFILE", "quarantine resource profile is unavailable");
    // NB-01: the declared bound is the bundle's; the tmpfs must also hold the
    // imported object store (~the same size again). Enlarge the mount, checked.
    const tmpfsBytes = this.paths.quarantineTmpBytes * 2;
    if (!Number.isSafeInteger(tmpfsBytes))
      throw new StoreError("UNSUPPORTED_PROFILE", "quarantine tmpfs size cannot be enforced");
    const timeoutMs = limits.timeoutSeconds * 1000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 0x7fffffff)
      throw new StoreError("UNSUPPORTED_PROFILE", "quarantine timeout cannot be enforced by the native timer");
    if (this.executor.blocked) {
      // The run that never reached a complete observation left its staging --
      // and its lease -- behind. Collecting it is the fresh authoritative
      // observation that the namespace's children are gone; the stale
      // unknown clears on it, never on the attempt itself.
      const stale = this.staleRoot;
      const observed = stale === null ? "unknown" as const
        : this.executor.reverifyStale(() => { try { return collectLeasedTree(stale).kind; } catch { return "unknown"; } });
      if (observed !== "quiescent")
        throw new StoreError("REF_STATE_UNKNOWN", `canonical quarantine is ${observed === "active" ? "still active" : "uncertain"}; it will not be guessed at`);
      this.staleRoot = null;
    }
    // FS-005: made under a staging directory resolved once, and removed the same way.
    const staging = join(this.paths.stateRoot, "staging");
    ensureOwnedDirectory(staging, this.paths.stateRoot);
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
        "/proc/self/fd/3", this.paths.projectGit, candidate, exportRef, String(tmpfsBytes), root, ...prerequisites,
      ], env: GIT_ENV, timeoutMs, silenceMs: limits.silenceSeconds * 1000,
        stdoutBytes: 4 * 1024 * 1024, stderrBytes: 4 * 1024 * 1024,
        stderrSpool: join(root, "stderr") }, undefined, [bundleFd, lease.descriptor]);
      if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome is ${result.kind}`);
      settledNamespaceCommand = true;
      let stdout: string; let stderr: string | null;
      try { stdout = decodeProcessText(result.stdout); }
      catch { throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8"); }
      stderr = classificationText(result);
      if (stderr === null) throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8");
      if (result.exitCode !== 0) {
        // A failure word classifies only as a whole stderr line, exactly as
        // the script's echo emits it — the same bytes inside a longer line
        // are the command's own output, never the named class (the checker's
        // refusal marker follows the same rule in candidate-checks).
        const code = /(?:^|\n)OMA_ERROR=(BUNDLE_INVALID|PREREQUISITE_MISSING|INTERNAL_ERROR|UNSUPPORTED_PROFILE|REF_STATE_UNKNOWN)(?:\n|$)/.exec(stderr)?.[1];
        if (code === "BUNDLE_INVALID" || code === "PREREQUISITE_MISSING" || code === "INTERNAL_ERROR" || code === "UNSUPPORTED_PROFILE" || code === "REF_STATE_UNKNOWN")
          throw new StoreError(code, stderr.slice(-400) || "quarantine failed");
        throw new StoreError("UNSUPPORTED_PROFILE", "required quarantine namespace is unavailable");
      }
      if (stdout !== `${candidate}\n` || !this.canonicalHas(candidate)) throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
    } finally {
      // No abort/disconnect cleanup of accepted bundle evidence. Unknown native
      // quiescence retains the namespace staging and blocks this executor owner;
      // its lease tells the next start when the namespace is gone -- and one
      // proof is attempted now, clearing the stale unknown when the children
      // are already reaped.
      lease.release();
      if (settledNamespaceCommand) { collectLeasedTree(root); this.staleRoot = null; }
      else {
        this.staleRoot = root;
        try {
          if (this.executor.reverifyStale(() => collectLeasedTree(root).kind) === "quiescent") {
            collectLeasedTree(root); this.staleRoot = null;
          }
        } catch { /* the retained staging stays for the next attempt's proof */ }
      }
    }
  }
}
