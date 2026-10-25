import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QuarantineImporter } from "@oma/git/quarantine";
import { PreparationExecutor } from "@oma/process/preparation";
import { StoreError } from "@oma/domain/errors";
import type { GitPaths } from "@oma/git/paths";
import type { CommandSpec, ProcessObservation } from "@oma/process/command";
const pathsOf = (root: string): GitPaths => ({
    stateRoot: root,
    projectGit: join(root, "project.git"),
    contextGit: join(root, "context.git"),
    worldDir: join(root, "world"),
    society: "demo",
});
const CANDIDATE = "a".repeat(40);
/** Runs importBundle with the namespace command replaced by a fabrication.
 * The importer's isolation argv and classification of the command's own
 * failure words are
 * observable without unshare. */
async function withStubbedRun(run: (spec: CommandSpec) => Promise<ProcessObservation>, work: (importer: QuarantineImporter, fd: number) => Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "oma-quarantine-"));
    const original = PreparationExecutor.prototype.run;
    PreparationExecutor.prototype.run = function (spec: CommandSpec) { return run.call(this, spec); };
    const fd = openSync("/dev/null", "r");
    try {
        await work(new QuarantineImporter(pathsOf(root), () => true), fd);
    }
    finally {
        closeSync(fd);
        PreparationExecutor.prototype.run = original;
        rmSync(root, { recursive: true, force: true });
    }
}
const exited = (exitCode: number, stdout: string, stderr: string): ProcessObservation => ({ kind: "exited", exitCode, stdout: Buffer.from(stdout, "utf8"), stderr: Buffer.from(stderr, "utf8"), stdoutTruncated: false, stderrTruncated: false }) as ProcessObservation;
test("NB-01: quarantine imports retain isolation without execution resource caps", async () => {
    await withStubbedRun(async (spec) => {
        assert.equal(spec.executable, "/usr/bin/unshare");
        assert.equal(spec.timeoutMs, null);
        assert.equal(spec.silenceMs, undefined);
        assert.equal(spec.argv.some(arg => /^--(?:cpu|as|nproc)=/.test(arg)), false);
        assert.ok(spec.argv.includes("--user") && spec.argv.includes("--pid"));
        const script = spec.argv[spec.argv.indexOf("-c") + 1]!;
        assert.doesNotMatch(script, /size=|heartbeat|hb_/);
        return exited(0, `${CANDIDATE}\n`, "");
    }, importer => importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []));
});
test("NB-02: canonical repository damage behind a failed fsck is REF_STATE_UNKNOWN, not a bundle defect", async () => {
    await withStubbedRun(async () => exited(74, "", "OMA_ERROR=REF_STATE_UNKNOWN\ncanonical objects corrupt\n"), importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []), (error: unknown) => error instanceof StoreError && error.code === "REF_STATE_UNKNOWN"
        && /canonical objects corrupt/.test(error.message))
        .then(() => undefined));
});
test("NB-02: a bundle-only fsck failure stays BUNDLE_INVALID", async () => {
    await withStubbedRun(async () => exited(71, "", "OMA_ERROR=BUNDLE_INVALID\n"), importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []), (error: unknown) => error instanceof StoreError && error.code === "BUNDLE_INVALID")
        .then(() => undefined));
});
test("NB-02: a namespace failure with no classified word is unsupported, never a bundle defect", async () => {
    await withStubbedRun(async () => exited(1, "", "unshare: unrecognized option"), importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE")
        .then(() => undefined));
});
test("S-05: the failure word must own its whole stderr line — inside a longer line it classifies nothing", async () => {
    // The script's echo emits `OMA_ERROR=<code>` as its own line; the same bytes
    // inside a longer line are the command's own output, not the failure class —
    // an unclassified exit stays the honest namespace refusal.
    for (const stderr of [
        "mount failed: OMA_ERROR=BUNDLE_INVALID was here\n",
        "OMA_ERROR=BUNDLE_INVALID trailing words\n",
        "prefix OMA_ERROR=PREREQUISITE_MISSING\n",
        "OMA_ERROR=BUNDLE_INVALIDE\nOMA_ERROR=BUNDLE_INVALI\n",
        "OMA_ERROR=BUNDLE_INVALID\r\n",
    ])
        await withStubbedRun(async () => exited(1, "", stderr), importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []), (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE"
            && /required quarantine namespace is unavailable/.test(error.message), JSON.stringify(stderr))
            .then(() => undefined));
    // Positive controls: the marker line mid-stream and at EOF still decode.
    for (const [stderr, expected] of [
        ["diagnostic first\nOMA_ERROR=BUNDLE_INVALID\nmore\n", "BUNDLE_INVALID"],
        ["OMA_ERROR=REF_STATE_UNKNOWN", "REF_STATE_UNKNOWN"],
    ] as const)
        await withStubbedRun(async () => exited(74, "", stderr), importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []), (error: unknown) => error instanceof StoreError && error.code === expected, JSON.stringify(stderr))
            .then(() => undefined));
});
