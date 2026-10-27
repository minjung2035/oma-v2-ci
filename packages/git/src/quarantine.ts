import { mkdirAt } from "@oma/file-descriptors";
/** Canonical bundle import runs in a disposable native sandbox scope.
 * Commit content and prerequisites are verified before objects enter the owned
 * project. Broker cancellation, whole-scope death and the retained tree lease
 * own shutdown; uncertain outcomes retain their staging for fresh recovery. */
import { closeSync, constants, fstatSync, fsyncSync, readSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureOwnedDirectory, openOwnedDirectoryPath, openOwnedAppendFile } from "@oma/storage/directory";
import { TreeLease, collectLeasedTree } from "@oma/storage/tree-lease";
import { reopenPinned, withinDirectory } from "@oma/native/files";
import type { GitPaths } from "./paths.js";
import { StoreError } from "@oma/domain/errors";
import { decodeProcessText, type ProcessObservation } from "@oma/process/run";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
export interface QuarantineRequest {
    readonly phase: "verify" | "import"; readonly root: string; readonly candidate: string;
    readonly exportRef: string; readonly prerequisites: readonly string[]; readonly bundleFd: number;
    readonly rootFd: number; readonly projectFd: number; readonly leaseFd: number; readonly stderrFd: number;
}
export interface QuarantineExecution {
    execute(request: QuarantineRequest, authorize: () => void): Promise<ProcessObservation>;
    confirmDead(): boolean;
}
/** The bytes the classifier reads for `OMA_ERROR=`: the stderr spool's tail
 * (the failure word is always the command's last word) or the retained head
 * when the run was small enough to keep. */
function classificationText(fd: number): string {
    const size = fstatSync(fd).size, span = Math.min(size, 256 * 1024), bytes = Buffer.alloc(span);
    for (let at = 0; at < span;) {
        const n = readSync(fd, bytes, at, span - at, size - span + at);
        if (n <= 0) throw new StoreError("REF_STATE_UNKNOWN", "quarantine diagnostic tail was not completely observed");
        at += n;
    }
    try { return decodeProcessText(bytes); }
    catch { throw new StoreError("REF_STATE_UNKNOWN", "quarantine diagnostic tail is not valid UTF-8"); }
}

export class QuarantineImporter {
    /** The staging an unproven run left behind; scope journal is the recovery fence; the lease protects collection. */
    private staleRoot: string | null = null;
    constructor(private readonly paths: GitPaths, private readonly canonicalHas: (candidate: string) => boolean,
        private readonly execution: QuarantineExecution | null) { }
    async importBundle(bundleFd: number, candidate: string, exportRef: string, prerequisites: readonly string[], authorize: () => void): Promise<void> {
        const execution = this.execution;
        if (execution === null) throw new StoreError("UNSUPPORTED_PROFILE", "native quarantine execution owner is unavailable");
        if (this.paths.ownerSignal?.aborted)
            throw new StoreError("REF_STATE_UNKNOWN", "quarantine owner is stopping");
        if (!execution.confirmDead()) throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous quarantine scope is not confirmed dead");
        if (this.staleRoot !== null) {
            if (collectLeasedTree(this.staleRoot).kind !== "quiescent")
                throw new StoreError("REF_STATE_UNKNOWN", "previous quarantine staging remains owned or unobserved");
            this.staleRoot = null;
        }
        // FS-005: made under a staging directory resolved once, and removed the same way.
        const staging = join(this.paths.stateRoot, "staging");
        ensureOwnedDirectory(staging, this.paths.stateRoot);
        const root = join(staging, `quarantine-ns-${randomUUID()}`);
        // R6-04: lease before tree. It retains cooperating inherited users;
        // the execution owner's independent scope journal must also prove
        // death before collection or a later phase may start.
        const lease = TreeLease.take(root);
        try {
            withinDirectory(root, (parent, name) => mkdirAt(parent, name, 0o700));
        }
        catch (error) {
            lease.release();
            throw error;
        }
        let rootFd: number | undefined, projectFd: number | undefined, stderrFd: number | undefined, inputFd: number | undefined;
        return withAsyncCleanup(async () => {
            // Consumers such as bwrap --ro-bind-data advance an open file
            // description's cursor. Borrow the exact inode with an independent
            // cursor; never consume the caller's accepted bundle capability.
            inputFd = reopenPinned(bundleFd, constants.O_RDONLY | constants.O_NONBLOCK);
            if (!fstatSync(inputFd).isFile()) throw new StoreError("BUNDLE_INVALID", "bundle capability is not a regular file");
            rootFd = openOwnedDirectoryPath(root);
            projectFd = openOwnedDirectoryPath(this.paths.projectGit);
            for (const phase of ["verify", "import"] as const) {
            if (!execution.confirmDead())
                throw new StoreError("RUN_TERMINATION_UNKNOWN", "previous quarantine phase is not confirmed dead");
            stderrFd = openOwnedAppendFile(rootFd, `stderr-${phase}`);
            const stderrStat = fstatSync(stderrFd);
            if (stderrStat.nlink !== 1 || stderrStat.size !== 0) throw new StoreError("REF_STATE_UNKNOWN", "quarantine diagnostics are not exclusively owned");
            const result = await execution.execute({ phase, root, bundleFd: inputFd, candidate, exportRef, prerequisites,
                rootFd, projectFd, leaseFd: lease.descriptor, stderrFd }, authorize);
            fsyncSync(stderrFd);
            if (result.kind !== "exited")
                throw new StoreError("REF_STATE_UNKNOWN", `quarantine import outcome is ${result.kind}`);
            let stdout: string;
            let stderr: string | null;
            try {
                stdout = decodeProcessText(result.stdout);
            }
            catch {
                throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8");
            }
            stderr = classificationText(stderrFd);
            const closedDiagnostic = stderrFd; stderrFd = undefined; closeSync(closedDiagnostic);
            if (stderr === null)
                throw new StoreError("REF_STATE_UNKNOWN", "quarantine command output is not valid UTF-8");
            if (result.exitCode !== 0) {
                // A failure word classifies only as a whole stderr line, exactly as
                // the script's echo emits it — the same bytes inside a longer line
                // are the command's own output, never the named class (the checker's
                // refusal marker follows the same rule in candidate-checks).
                const code = /(?:^|\n)OMA_ERROR=(BUNDLE_INVALID|PREREQUISITE_MISSING|INTERNAL_ERROR|UNSUPPORTED_PROFILE|REF_STATE_UNKNOWN)\n?$/.exec(stderr)?.[1];
                if (code === "BUNDLE_INVALID" || code === "PREREQUISITE_MISSING" || code === "INTERNAL_ERROR" || code === "UNSUPPORTED_PROFILE" || code === "REF_STATE_UNKNOWN")
                    throw new StoreError(code, stderr.slice(-400) || "quarantine failed");
                throw new StoreError("UNSUPPORTED_PROFILE", "required quarantine namespace is unavailable");
            }
            if (stdout !== `${candidate}\n` || phase === "import" && !this.canonicalHas(candidate))
                throw new StoreError("BUNDLE_INVALID", "bundle candidate was not imported exactly");
            }
        }, () => {
            // No abort/disconnect cleanup of accepted bundle evidence. Unknown native
            // quiescence retains staging and blocks this executor owner;
            // the scope journal and lease must both permit collection -- one
            // proof is attempted now, clearing the stale unknown when the children
            // are already reaped.
            this.staleRoot = root;
            cleanupAll([() => { if (stderrFd !== undefined) closeSync(stderrFd); }, () => { if (inputFd !== undefined) closeSync(inputFd); }, () => { if (rootFd !== undefined) closeSync(rootFd); }, () => { if (projectFd !== undefined) closeSync(projectFd); },
                () => lease.release(), () => {
                    if (execution.confirmDead() && collectLeasedTree(root).kind === "quiescent") this.staleRoot = null;
                }]);
        });
    }
}
