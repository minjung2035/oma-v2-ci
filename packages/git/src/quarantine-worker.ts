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
/** Git alternates accept C-quoted byte paths, not JSON unicode escapes or a
 * raw newline-delimited host name. Emit octal UTF-8 bytes for all controls and
 * non-ASCII, preserving every path byte without a second entry or truncation.
 * See Git v2.47.3 parse_alt_odb_entry/unquote_c_style. */
function alternateObjectDirectory(path: string): string {
  let quoted = '"';
  for (const byte of Buffer.from(path)) {
    if (byte === 0x22 || byte === 0x5c) quoted += `\\${String.fromCharCode(byte)}`;
    else if (byte < 0x20 || byte >= 0x7f) quoted += `\\${byte.toString(8).padStart(3, "0")}`;
    else quoted += String.fromCharCode(byte);
  }
  return quoted + '"\n';
}
export async function executeQuarantinePhase(input: QuarantineInput): Promise<void> {
  // The entry validates again inside the view. It never trusts inherited
  // environment, host path strings, shell expansion, hooks or filters.
  input = decodeQuarantineInput(input);
  const { project: PROJECT, root: ROOT, bundle: BUNDLE, temporary } = input.view, REPO = join(ROOT, "repo");
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
  ensureOwnedDirectory(join(REPO, "objects", "info"), ROOT, 0o700);
  replaceDerivedFile(join(REPO, "objects", "info", "alternates"), alternateObjectDirectory(join(PROJECT, "objects")), 0o600);
  await command(REPO, ["bundle", "verify", BUNDLE], "BUNDLE_INVALID");
  const heads = (await command(REPO, ["bundle", "list-heads", BUNDLE], "BUNDLE_INVALID", true)).trimEnd().split("\n");
  if (heads.length !== 1 || heads[0] !== `${input.candidate} ${input.exportRef}`)
    throw new StoreError("BUNDLE_INVALID", "bundle must export exactly the frozen candidate and ref");
  await command(REPO, ["fetch", "--progress", "--no-tags", BUNDLE, `${input.exportRef}:refs/oma/input`], "BUNDLE_INVALID");
  if ((await command(REPO, ["rev-parse", "refs/oma/input"], "BUNDLE_INVALID", true)) !== `${input.candidate}\n`)
    throw new StoreError("BUNDLE_INVALID", "quarantined candidate differs from the accepted OID");
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
