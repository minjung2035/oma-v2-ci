/** Canonical bundle import runs in a disposable mount/pid/user namespace.
 * Commit content and prerequisites are verified before objects enter the owned
 * project. Broker cancellation, namespace death and the retained tree lease
 * own shutdown; uncertain outcomes retain their staging for fresh recovery. */
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree } from "@oma/storage/tree-lease";
import { entryAt, withinDirectory } from "@oma/native/files";
import type { GitPaths } from "./paths.js";
import { StoreError } from "@oma/domain/errors";
import { decodeProcessText, type ProcessObservation } from "@oma/process/run";
import { PreparationExecutor } from "@oma/process/preparation";
import { GIT_ENV } from "@oma/process/policies";
import { CANONICAL_PROCESS_LIMITS } from "./canonical-command.js";
const SCRIPT = [
    "set -eu",
    "bundle=$1; project=$2; candidate=$3; export_ref=$4; shift 4",
    "root=$1; shift",
    "git=/usr/bin/git",
    "phase() { printf 'OMA_PHASE=%s\\n' \"$1\" >&2; }",
    "quiet() { \"$@\" 2>/dev/null; }",
    "fail_unsupported() { printf '\\nOMA_ERROR=UNSUPPORTED_PROFILE\\n' >&2; exit 70; }",
    "fail_bundle() { printf '\\nOMA_ERROR=BUNDLE_INVALID\\n' >&2; exit 71; }",
    "fail_prereq() { printf '\\nOMA_ERROR=PREREQUISITE_MISSING\\n' >&2; exit 72; }",
    "fail_internal() { printf '\\nOMA_ERROR=INTERNAL_ERROR\\n' >&2; exit 73; }",
    "fail_refstate() { printf '\\nOMA_ERROR=REF_STATE_UNKNOWN\\n' >&2; exit 74; }",
    "mount --make-rprivate / || fail_unsupported",
    "phase mounts",
    "mkdir -p \"$root/project\" \"$root/bundle\" \"$root/quarantine\"",
    "touch \"$root/bundle/input.bundle\"",
    "cleanup() { umount \"$root/project\" 2>/dev/null || true; umount \"$root/bundle/input.bundle\" 2>/dev/null || true; umount \"$root/quarantine\" 2>/dev/null || true; rmdir \"$root/project\" \"$root/bundle\" \"$root/quarantine\" \"$root/hooks\" \"$root\" 2>/dev/null || true; }",
    "trap cleanup EXIT",
    "mount --bind \"$project\" \"$root/project\" || fail_unsupported",
    "mount -o remount,bind,ro \"$root/project\" || fail_unsupported",
    "mount -t tmpfs tmpfs \"$root/quarantine\" || fail_unsupported",
    // Read the already-checked bundle descriptor; the OS governs available memory.
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
    "format=$($git --git-dir=\"$root/project\" rev-parse --show-object-format) || fail_internal",
    "quiet $git --git-dir=\"$repo\" init -q --bare --object-format=\"$format\" >/dev/null || fail_unsupported",
    "mkdir -p \"$repo/objects/info\"",
    "printf '%s\\n' \"$root/project/objects\" > \"$repo/objects/info/alternates\"",
    "phase bundle-verify",
    "quiet $git --git-dir=\"$repo\" bundle verify \"$root/bundle/input.bundle\" >/dev/null || fail_bundle",
    "heads=$(quiet $git --git-dir=\"$repo\" bundle list-heads \"$root/bundle/input.bundle\") || fail_bundle",
    "count=0; head_ref=''",
    "while IFS= read -r line; do [ -z \"$line\" ] && continue; count=$((count + 1)); head_ref=${line##* }; done <<EOF",
    "$heads",
    "EOF",
    "[ \"$count\" -eq 1 ] && [ \"$head_ref\" = \"$export_ref\" ] || fail_bundle",
    "phase fetch",
    "refspec=\"$export_ref:refs/oma/input\"",
    "$git --git-dir=\"$repo\" fetch --progress --no-tags \"$root/bundle/input.bundle\" \"$refspec\" >/dev/null || fail_bundle",
    "input=$(quiet $git --git-dir=\"$repo\" rev-parse refs/oma/input) || fail_bundle",
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
    "for prerequisite in \"$@\"; do $git --git-dir=\"$repo\" cat-file -e \"$prerequisite^{commit}\" >/dev/null 2>&1 || fail_prereq; done",
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
                    for (let at = 0; at < span;)
                        at += readSync(fd, out, at, span - at, size - span + at);
                    return out;
                }
                finally {
                    closeSync(fd);
                }
            }
            catch {
                return null;
            }
        })();
        if (tail === null)
            return null;
        bytes = tail;
    }
    try {
        return decodeProcessText(bytes);
    }
    catch {
        return null;
    }
}
export class QuarantineImporter {
    private readonly executor = new PreparationExecutor();
    /** The staging an unproven run left behind; its lease is the death proof. */
    private staleRoot: string | null = null;
    constructor(private readonly paths: GitPaths, private readonly canonicalHas: (candidate: string) => boolean) { }
    async importBundle(bundleFd: number, candidate: string, exportRef: string, prerequisites: readonly string[]): Promise<void> {
        if (this.paths.ownerSignal?.aborted)
            throw new StoreError("REF_STATE_UNKNOWN", "quarantine owner is stopping");
        if (this.executor.blocked) {
            // The run that never reached a complete observation left its staging --
            // and its lease -- behind. Collecting it is the fresh authoritative
            // observation that the namespace's children are gone; the stale
            // unknown clears on it, never on the attempt itself.
            const stale = this.staleRoot;
            const observed = stale === null ? "unknown" as const
                : this.executor.reverifyStale(() => { try {
                    return collectLeasedTree(stale).kind;
                }
                catch {
                    return "unknown";
                } });
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
        try {
            withinDirectory(root, (parent, name) => mkdirSync(entryAt(parent, name), { mode: 0o700 }));
        }
        catch (error) {
            lease.release();
            throw error;
        }
        try {
            // CommandSpec supplies the complete scrubbed environment; an extra env
            // launcher duplicates it. Enter the namespace directly before the shell.
            const result = await this.executor.run({ executable: "/usr/bin/unshare", argv: [
                    // SIGKILL cannot be forwarded; --kill-child owns the forked namespace.
                    "--user", "--map-root-user", "--mount", "--pid", "--net", "--fork",
                    "--kill-child=SIGKILL", "--mount-proc", "/bin/sh", "-c", SCRIPT, "oma-quarantine",
                    "/proc/self/fd/3", this.paths.projectGit, candidate, exportRef, root, ...prerequisites,
                ], env: { ...GIT_ENV, TMPDIR: "/nonexistent" }, timeoutMs: null,
                stdoutBytes: 4 * 1024 * 1024, stderrBytes: 4 * 1024 * 1024,
                stdoutOverflow: "discard", stderrOverflow: "discard",
                stderrSpool: join(root, "stderr") }, this.paths.ownerSignal, [bundleFd, lease.descriptor]).catch(error => {
                if (error instanceof StoreError && error.code === "CANCELLED_BEFORE_COMMIT")
                    throw new StoreError("REF_STATE_UNKNOWN", "accepted quarantine import interrupted by owner shutdown");
                throw error;
            });
            if (result.kind !== "exited")
                throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome is ${result.kind}`);
            settledNamespaceCommand = true;
            let stdout: string;
            let stderr: string | null;
            try {
                stdout = decodeProcessText(result.stdout);
            }
            catch {
                throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8");
            }
            stderr = classificationText(result);
            if (stderr === null)
                throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8");
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
            if (stdout !== `${candidate}\n` || !this.canonicalHas(candidate))
                throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
        }
        finally {
            // No abort/disconnect cleanup of accepted bundle evidence. Unknown native
            // quiescence retains the namespace staging and blocks this executor owner;
            // its lease tells the next start when the namespace is gone -- and one
            // proof is attempted now, clearing the stale unknown when the children
            // are already reaped.
            lease.release();
            if (settledNamespaceCommand) {
                collectLeasedTree(root);
                this.staleRoot = null;
            }
            else {
                this.staleRoot = root;
                try {
                    if (this.executor.reverifyStale(() => collectLeasedTree(root).kind) === "quiescent") {
                        collectLeasedTree(root);
                        this.staleRoot = null;
                    }
                }
                catch { /* the retained staging stays for the next attempt's proof */ }
            }
        }
    }
}
