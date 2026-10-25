/** Trusted TypeScript verifier, executed only inside the selected disposable
 * sandbox. Verification has a read-only canonical mount; promotion is a
 * second fixed invocation after the verifier's whole scope ended. */
import { join } from "node:path";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { runProcess } from "@oma/process/async";
import { GIT_ENV } from "@oma/process/policies";
import { decodeProcessText } from "@oma/process/run";
import { StoreError } from "@oma/domain/errors";
import type { ErrorCode } from "@oma/contracts/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { checkExportRef } from "@oma/domain/validation";

export interface QuarantineInput {
  readonly phase: "verify" | "import"; readonly candidate: string;
  readonly exportRef: string; readonly prerequisites: readonly string[];
}
export function decodeQuarantineInput(value: unknown): QuarantineInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("INVALID_REQUEST", "invalid quarantine invocation");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join() !== "candidate,exportRef,phase,prerequisites" || !["verify", "import"].includes(String(raw.phase)) ||
      !isValidFullOid(raw.candidate) || checkExportRef(raw.exportRef) !== null || !Array.isArray(raw.prerequisites) ||
      raw.prerequisites.some(oid => !isValidFullOid(oid) || (oid as string).length !== (raw.candidate as string).length))
    throw new StoreError("INVALID_REQUEST", "quarantine invocation differs from its closed contract");
  return Object.freeze({ phase: raw.phase as QuarantineInput["phase"], candidate: raw.candidate as string,
    exportRef: raw.exportRef as string, prerequisites: Object.freeze([...raw.prerequisites]) as readonly string[] });
}
const PROJECT = "/git/project.git", ROOT = "/quarantine", REPO = `${ROOT}/repo`, BUNDLE = "/bundle/input.bundle";
async function git(repository: string, argv: readonly string[], code: ErrorCode, parse = false) {
  const result = await runProcess({ executable: "/usr/bin/git", argv: ["--git-dir", repository, ...argv],
    env: { ...GIT_ENV, TMPDIR: `${ROOT}/tmp` }, timeoutMs: null,
    stdoutBytes: 4 * 1024 * 1024, stderrBytes: 64 * 1024, stdoutOverflow: "discard", stderrOverflow: "discard" },
    { stderrFd: 2 });
  if (result.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `quarantine Git observation is ${result.kind}`);
  if (result.exitCode !== 0) throw new StoreError(code, "quarantine Git command failed");
  if (parse && result.stdoutTruncated) throw new StoreError(code, "quarantine Git answer exceeds its closed representation");
  return parse ? decodeProcessText(result.stdout) : "";
}
export async function executeQuarantinePhase(input: QuarantineInput): Promise<void> {
  // The entry validates again inside the view. It never trusts inherited
  // environment, host path strings, shell expansion, hooks or filters.
  input = decodeQuarantineInput(input);
  if (input.phase === "import") {
    await git(PROJECT, ["fetch", "--progress", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", "--refmap=", REPO, "refs/oma/input"], "INTERNAL_ERROR");
    process.stdout.write(`${input.candidate}\n`); return;
  }
  ensureOwnedDirectory(`${ROOT}/tmp`, ROOT, 0o700);
  const format = (await git(PROJECT, ["rev-parse", "--show-object-format"], "REF_STATE_UNKNOWN", true)).trim();
  if ((format !== "sha1" && format !== "sha256") || input.candidate.length !== (format === "sha1" ? 40 : 64))
    throw new StoreError("BUNDLE_INVALID", "bundle object format differs from the canonical repository");
  await git(REPO, ["init", "-q", "--bare", `--object-format=${format}`], "UNSUPPORTED_PROFILE");
  ensureOwnedDirectory(join(REPO, "objects", "info"), ROOT, 0o700);
  replaceDerivedFile(join(REPO, "objects", "info", "alternates"), `${PROJECT}/objects\n`, 0o600);
  await git(REPO, ["bundle", "verify", BUNDLE], "BUNDLE_INVALID");
  const heads = (await git(REPO, ["bundle", "list-heads", BUNDLE], "BUNDLE_INVALID", true)).trimEnd().split("\n");
  if (heads.length !== 1 || heads[0] !== `${input.candidate} ${input.exportRef}`)
    throw new StoreError("BUNDLE_INVALID", "bundle must export exactly the frozen candidate and ref");
  await git(REPO, ["fetch", "--progress", "--no-tags", BUNDLE, `${input.exportRef}:refs/oma/input`], "BUNDLE_INVALID");
  if ((await git(REPO, ["rev-parse", "refs/oma/input"], "BUNDLE_INVALID", true)) !== `${input.candidate}\n`)
    throw new StoreError("BUNDLE_INVALID", "quarantined candidate differs from the accepted OID");
  try { await git(REPO, ["fsck", "--strict", "--no-reflogs", "--progress"], "BUNDLE_INVALID"); }
  catch (error) {
    if (!(error instanceof StoreError) || error.code !== "BUNDLE_INVALID") throw error;
    await git(PROJECT, ["fsck", "--strict", "--no-reflogs", "--progress"], "REF_STATE_UNKNOWN");
    throw error;
  }
  for (const prerequisite of input.prerequisites)
    await git(REPO, ["cat-file", "-e", `${prerequisite}^{commit}`], "PREREQUISITE_MISSING");
  process.stdout.write(`${input.candidate}\n`);
}
