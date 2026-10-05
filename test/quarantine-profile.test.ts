import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QuarantineImporter } from "../src/git/quarantine.js";
import { PreparationExecutor } from "../src/process/preparation.js";
import { StoreError } from "../src/domain/errors.js";
import type { GitPaths } from "../src/git/paths.js";
import type { CommandSpec, ProcessObservation } from "../src/process/command.js";

const pathsOf = (root: string, tmpBytes: number): GitPaths => ({
  stateRoot: root,
  projectGit: join(root, "project.git"),
  contextGit: join(root, "context.git"),
  worldDir: join(root, "world"),
  society: "demo",
  quarantineTmpBytes: tmpBytes,
  quarantineResources: { cpuSeconds: 30, memoryBytes: 512 * 1024 * 1024, tasks: 128, timeoutSeconds: 30 },
});

const CANDIDATE = "a".repeat(40);

/** Runs importBundle with the namespace command replaced by a fabrication.
 * The importer's obligations -- the resource math in the argv it hands to the
 * executor and the classification of the command's own failure words -- are
 * observable without unshare. */
async function withStubbedRun(
  run: (spec: CommandSpec) => Promise<ProcessObservation>,
  work: (importer: QuarantineImporter, fd: number) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-"));
  const original = PreparationExecutor.prototype.run;
  PreparationExecutor.prototype.run = function (spec: CommandSpec) { return run.call(this, spec); };
  const fd = openSync("/dev/null", "r");
  try { await work(new QuarantineImporter(pathsOf(root, 4096), () => true), fd); }
  finally {
    closeSync(fd); PreparationExecutor.prototype.run = original;
    rmSync(root, { recursive: true, force: true });
  }
}

const exited = (exitCode: number, stdout: string, stderr: string): ProcessObservation =>
  ({ kind: "exited", exitCode, stdout: Buffer.from(stdout, "utf8"), stderr: Buffer.from(stderr, "utf8"), stdoutTruncated: false, stderrTruncated: false }) as ProcessObservation;

test("NB-01: the quarantine tmpfs is sized for the bundle and its object store", async () => {
  await withStubbedRun(
    async spec => {
      // The mount argument is the tmpfs capacity: twice the bundle bound.
      const index = spec.argv.indexOf("oma-quarantine");
      assert.equal(spec.argv[index + 5], String(4096 * 2),
        "tmpfs holds input.bundle plus the imported repository");
      return exited(0, `${CANDIDATE}\n`, "");
    },
    importer => importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
  );
});

test("NB-01: a bound that cannot be doubled within the timer's arithmetic is refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-"));
  try {
    const importer = new QuarantineImporter({ ...pathsOf(root, Math.ceil(Number.MAX_SAFE_INTEGER / 2) + 1) }, () => true);
    await assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
      (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("NB-01: a missing quarantine profile is refused, not borrowed", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-"));
  try {
    const paths = pathsOf(root, 4096); delete (paths as { quarantineResources?: unknown }).quarantineResources;
    const importer = new QuarantineImporter(paths, () => true);
    await assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
      (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("NB-02: canonical repository damage behind a failed fsck is REF_STATE_UNKNOWN, not a bundle defect", async () => {
  await withStubbedRun(
    async () => exited(74, "", "OMA_ERROR=REF_STATE_UNKNOWN\ncanonical objects corrupt\n"),
    importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
      (error: unknown) => error instanceof StoreError && error.code === "REF_STATE_UNKNOWN"
        && /canonical objects corrupt/.test(error.message))
      .then(() => undefined),
  );
});

test("NB-02: a bundle-only fsck failure stays BUNDLE_INVALID", async () => {
  await withStubbedRun(
    async () => exited(71, "", "OMA_ERROR=BUNDLE_INVALID\n"),
    importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
      (error: unknown) => error instanceof StoreError && error.code === "BUNDLE_INVALID")
      .then(() => undefined),
  );
});

test("NB-02: a namespace failure with no classified word is unsupported, never a bundle defect", async () => {
  await withStubbedRun(
    async () => exited(1, "", "unshare: unrecognized option"),
    importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
      (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE")
      .then(() => undefined),
  );
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
    await withStubbedRun(
      async () => exited(1, "", stderr),
      importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
        (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE"
          && /required quarantine namespace is unavailable/.test(error.message), JSON.stringify(stderr))
        .then(() => undefined),
    );
  // Positive controls: the marker line mid-stream and at EOF still decode.
  for (const [stderr, expected] of [
    ["diagnostic first\nOMA_ERROR=BUNDLE_INVALID\nmore\n", "BUNDLE_INVALID"],
    ["OMA_ERROR=REF_STATE_UNKNOWN", "REF_STATE_UNKNOWN"],
  ] as const)
    await withStubbedRun(
      async () => exited(74, "", stderr),
      importer => assert.rejects(importer.importBundle(0, CANDIDATE, "refs/oma/export/x", []),
        (error: unknown) => error instanceof StoreError && error.code === expected, JSON.stringify(stderr))
        .then(() => undefined),
    );
});
