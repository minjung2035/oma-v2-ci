/** Exact checkout policy inside the disposable check view. Git attribute
 * overrides preserve committed bytes; gitlinks use the same domain refusal. */
import { decodeUtf8 } from "@oma/domain/utf8";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { runProcess } from "@oma/process/async";
import { GIT_ENV } from "@oma/process/policies";
import { replaceProcess } from "@oma/process/replace";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { requireNoGitlinks, observed } from "@oma/domain/git-facts";
import { createCanonicalObserver } from "./canonical-command.js";
import { decodeCandidateExecutionView, type CandidateExecutionView } from "@oma/protocol/git-execution-view";
import { join } from "node:path";
export interface CandidateInvocation { readonly candidate: string; readonly argv: readonly string[]; readonly view: CandidateExecutionView }
type SetupOutcome = { kind: "ready" } | { kind: "failed"; code: "UNSUPPORTED_PROFILE" | "REF_STATE_UNKNOWN" };
/** Closed private protocol. Only prepared can request the host's final
 * authorization/release; EOF and diagnostic output never authorize exec. */
export class CandidateSetupStatus {
  private pending = Buffer.alloc(0);
  private length = 0;
  private phase: "opening" | "prepared" | "ready" | "failed" = "opening";
  private outcome: SetupOutcome | null = null;
  private failure: { readonly error: unknown } | null = null;
  constructor(private readonly prepared: () => void) {}
  write(bytes: Uint8Array): void {
    if (this.failure !== null) throw this.failure.error;
    try { this.consume(bytes); }
    catch (error) { this.failure = { error }; throw error; }
  }
  private consume(bytes: Uint8Array): void {
    this.length += bytes.byteLength;
    if (this.length > 1024) throw new StoreError("REF_STATE_UNKNOWN", "candidate private exec status exceeds its closed grammar");
    this.pending = Buffer.concat([this.pending, bytes]);
    for (;;) {
      const end = this.pending.indexOf(10); if (end < 0) return;
      const line = this.pending.subarray(0, end); this.pending = this.pending.subarray(end + 1);
      let raw: unknown;
      try { raw = JSON.parse(decodeUtf8(line)); }
      catch { throw new StoreError("REF_STATE_UNKNOWN", "candidate setup outcome is malformed"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) this.refuse();
      const frame = raw as Record<string, unknown>, keys = Object.keys(frame).sort().join();
      if (frame.kind === "prepared" && keys === "kind" && this.phase === "opening") {
        this.phase = "prepared"; this.prepared();
      } else if (frame.kind === "ready" && keys === "kind" && this.phase === "prepared") {
        this.phase = "ready"; this.outcome = { kind: "ready" };
      } else if (frame.kind === "failed" && keys === "code,kind" && this.phase !== "failed" &&
          ["UNSUPPORTED_PROFILE", "REF_STATE_UNKNOWN"].includes(String(frame.code))) {
        this.phase = "failed"; this.outcome = { kind: "failed", code: frame.code as "UNSUPPORTED_PROFILE" | "REF_STATE_UNKNOWN" };
      } else this.refuse();
    }
  }
  finish(): SetupOutcome {
    if (this.failure !== null) throw this.failure.error;
    try {
      if (this.pending.length || this.outcome === null) this.refuse();
      return this.outcome;
    } catch (error) { this.failure = { error }; throw error; }
  }
  private refuse(): never { throw new StoreError("REF_STATE_UNKNOWN", "candidate private setup sequence is incomplete or differs"); }
}
export function decodeCandidateSetupStatus(bytes: Uint8Array): SetupOutcome {
  const status = new CandidateSetupStatus(() => {}); status.write(bytes); return status.finish();
}
export function decodeCandidateInvocation(value: unknown): CandidateInvocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("INVALID_REQUEST", "invalid check setup");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join() !== "argv,candidate,view" || !isValidFullOid(raw.candidate) || !Array.isArray(raw.argv) ||
      !raw.argv.length || raw.argv.some(value => typeof value !== "string" || value.includes("\0")) || raw.argv[0] === "")
    throw new StoreError("INVALID_REQUEST", "check setup differs from its closed invocation");
  return Object.freeze({ candidate: raw.candidate as string, argv: Object.freeze([...raw.argv]) as readonly string[],
    view: decodeCandidateExecutionView(raw.view) });
}
export async function executeCandidateCheck(input: CandidateInvocation, beforeExec: () => void): Promise<never> {
  input = decodeCandidateInvocation(input);
  const { project, workspace, git: executable } = input.view;
  const observer = createCanonicalObserver(executable);
  requireNoGitlinks(observed(observer.gitlinks(project, input.candidate), "candidate gitlinks"));
  const format = observed(observer.objectFormat(project), "candidate object format");
  const git = async (argv: readonly string[]): Promise<void> => {
    const task = runProcess({ executable, argv, env: GIT_ENV, timeoutMs: null,
      stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 0, stderrOverflow: "discard" }, { stderrFd: 2 });
    const result = await task;
    if (result.kind !== "exited" || result.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", "exact check checkout was not observed");
  };
  await git(["init", "-q", `--object-format=${format}`, workspace]);
  await git(["-C", workspace, "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", project, input.candidate]);
  ensureOwnedDirectory(join(workspace, ".git/info"), workspace, 0o700);
  replaceDerivedFile(join(workspace, ".git/info/attributes"), "* -text -filter -ident !eol !working-tree-encoding\n", 0o600);
  await git(["-C", workspace, "-c", "core.autocrlf=false", "-c", "core.symlinks=true", "checkout", "-q", "--detach", input.candidate]);
  return replaceProcess({ executable: input.argv[0]!, argv: input.argv.slice(1), cwd: workspace, env: process.env }, beforeExec);
}
