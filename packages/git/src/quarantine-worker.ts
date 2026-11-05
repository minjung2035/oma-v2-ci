/** Trusted TypeScript verifier, executed only inside the selected disposable
 * sandbox. Verification has a read-only canonical mount; promotion is a
 * second fixed invocation after the verifier's whole scope ended. */
import { join } from "node:path";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { runProcess } from "@oma/process/async";
import { GIT_ENV } from "@oma/process/policies";
import { decodeProcessText } from "@oma/process/run";
import { StoreError } from "@oma/domain/errors";
import type { ErrorCode } from "@oma/contracts/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { checkExportRef } from "@oma/domain/validation";
import { decodeQuarantineExecutionView, type QuarantineExecutionView } from "@oma/protocol/git-execution-view";

export interface QuarantineInput {
  readonly phase: "verify" | "import"; readonly candidate: string;
  readonly exportRef: string; readonly prerequisites: readonly string[];
  readonly view: QuarantineExecutionView;
}
export function decodeQuarantineInput(value: unknown): QuarantineInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("INVALID_REQUEST", "invalid quarantine invocation");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join() !== "candidate,exportRef,phase,prerequisites,view" || (raw.phase !== "verify" && raw.phase !== "import") ||
      !isValidFullOid(raw.candidate) || checkExportRef(raw.exportRef) !== null || !Array.isArray(raw.prerequisites) ||
      raw.prerequisites.some(oid => !isValidFullOid(oid) || (oid as string).length !== (raw.candidate as string).length))
    throw new StoreError("INVALID_REQUEST", "quarantine invocation differs from its closed contract");
  return Object.freeze({ phase: raw.phase as QuarantineInput["phase"], candidate: raw.candidate as string,
    exportRef: raw.exportRef as string, prerequisites: Object.freeze([...raw.prerequisites]) as readonly string[],
    view: decodeQuarantineExecutionView(raw.view) });
}
async function git(view: QuarantineExecutionView, repository: string, argv: readonly string[], code: ErrorCode, parse = false) {
  const result = await runProcess({ executable: view.git, argv: ["--git-dir", repository, ...argv],
    env: { ...GIT_ENV, TMPDIR: view.temporary }, timeoutMs: null,
    stdoutBytes: 4 * 1024 * 1024, stderrBytes: 64 * 1024, stdoutOverflow: "discard", stderrOverflow: "discard" },
    { stderrFd: 2 });
  if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `quarantine Git observation is ${result.kind}`);
  if (result.exitCode !== 0) throw new StoreError(code, "quarantine Git command failed");
  if (parse && result.stdoutTruncated) throw new StoreError(code, "quarantine Git answer exceeds its closed representation");
  return parse ? decodeProcessText(result.stdout) : "";
}
export async function executeQuarantinePhase(input: QuarantineInput, projectReference?: string): Promise<void> {
  // The entry validates again inside the view. It never trusts inherited
  // environment, host path strings, shell expansion, hooks or filters.
  input = decodeQuarantineInput(input);
  const { root: ROOT, bundle: BUNDLE, temporary } = input.view, REPO = join(ROOT, "repo");
  const PROJECT = projectReference ?? input.view.project;
  const command = (repository: string, argv: readonly string[], code: ErrorCode, parse = false) => git(input.view, repository, argv, code, parse);
  if (input.phase === "import") {
    await command(PROJECT, ["fetch", "--progress", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", "--refmap=", REPO, "refs/oma/input"], "INTERNAL_ERROR");
    process.stdout.write(`${input.candidate}\n`); return;
  }
  ensureOwnedDirectory(temporary, ROOT, 0o700);
  const format = (await command(PROJECT, ["rev-parse", "--show-object-format"], "REF_STATE_UNKNOWN", true)).trim();
  if ((format !== "sha1" && format !== "sha256") || input.candidate.length !== (format === "sha1" ? 40 : 64))
    throw new StoreError("BUNDLE_INVALID", "bundle object format differs from the canonical repository");
  await command(REPO, ["init", "-q", "--bare", `--object-format=${format}`], "UNSUPPORTED_PROFILE");
  // Materialize prerequisite graphs in the private object database. An
  // absolute alternates path would reopen a replaceable canonical name.
  // One validated OID per invocation avoids a new argv-size admission limit.
  for (const prerequisite of input.prerequisites) {
    try { await command(REPO, ["fetch", "-q", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", PROJECT, prerequisite], "PREREQUISITE_MISSING"); }
    catch (error) {
      if (!(error instanceof StoreError) || error.code !== "PREREQUISITE_MISSING") throw error;
      await command(PROJECT, ["fsck", "--strict", "--no-reflogs", "--progress"], "REF_STATE_UNKNOWN");
      throw error;
    }
  }
  await command(REPO, ["bundle", "verify", BUNDLE], "BUNDLE_INVALID");
  const heads = (await command(REPO, ["bundle", "list-heads", BUNDLE], "BUNDLE_INVALID", true)).trimEnd().split("\n");
  if (heads.length !== 1 || heads[0] !== `${input.candidate} ${input.exportRef}`)
    throw new StoreError("BUNDLE_INVALID", "bundle must export exactly the frozen candidate and ref");
  await command(REPO, ["fetch", "--progress", "--no-tags", BUNDLE, `${input.exportRef}:refs/oma/input`], "BUNDLE_INVALID");
  if ((await command(REPO, ["rev-parse", "refs/oma/input"], "BUNDLE_INVALID", true)) !== `${input.candidate}\n`)
    throw new StoreError("BUNDLE_INVALID", "quarantined candidate differs from the accepted OID");
  if ((await command(REPO, ["cat-file", "-t", "refs/oma/input"], "BUNDLE_INVALID", true)) !== "commit\n")
    throw new StoreError("BUNDLE_INVALID", "bundle candidate must name a commit object without peeling a tag");
  // The old full fsck included the canonical alternates database. Keep that
  // corruption observation even though its objects are now private copies.
  await command(PROJECT, ["fsck", "--strict", "--no-reflogs", "--progress"], "REF_STATE_UNKNOWN");
  try { await command(REPO, ["fsck", "--strict", "--no-reflogs", "--progress"], "BUNDLE_INVALID"); }
  catch (error) {
    if (!(error instanceof StoreError) || error.code !== "BUNDLE_INVALID") throw error;
    await command(PROJECT, ["fsck", "--strict", "--no-reflogs", "--progress"], "REF_STATE_UNKNOWN");
    throw error;
  }
  for (const prerequisite of input.prerequisites)
    await command(REPO, ["cat-file", "-e", `${prerequisite}^{commit}`], "PREREQUISITE_MISSING");
  process.stdout.write(`${input.candidate}\n`);
}
