/** Exact checkout policy inside the disposable check view. Git attribute
 * overrides preserve committed bytes; gitlinks use the same domain refusal. */
import { decodeUtf8 } from "@oma/domain/utf8";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { replaceDerivedEntry } from "@oma/storage/durable-fs";
import { withinDirectory } from "@oma/native/files";
import { runProcess } from "@oma/process/async";
import { GIT_ENV } from "@oma/process/policies";
import { replaceProcess } from "@oma/process/replace";
import { StoreError } from "@oma/domain/errors";
import { isValidFullOid } from "@oma/domain/identifiers";
import { requireNoGitlinks, observed } from "@oma/domain/git-facts";
import { createCanonicalObserver } from "./canonical-command.js";
import { decodeCandidateExecutionView, decodePipelineExecutionView, type CandidateExecutionView, type PipelineExecutionView } from "@oma/protocol/git-execution-view";
import { join } from "node:path";
import { checkPipelineCheck, frozenPipeline } from "@oma/domain/check-pipeline";
import { executePipeline, type PipelineFrame } from "./check-pipeline.js";
import type { CheckPipeline } from "@oma/contracts/integration";
export type { PipelineFrame } from "./check-pipeline.js";
export interface CandidateInvocation { readonly candidate: string; readonly argv: readonly string[]; readonly view: CandidateExecutionView; readonly pipeline?: CheckPipeline; readonly pipelineView?: PipelineExecutionView; readonly downloadCache?: { key: string; files: readonly string[] } }
type SetupOutcome = { kind: "ready" } | { kind: "failed"; code: "UNSUPPORTED_PROFILE" | "REF_STATE_UNKNOWN" };
/** Closed private protocol. Only prepared can request the host's final
 * authorization/release; EOF and diagnostic output never authorize exec. */
export class CandidateSetupStatus {
  private pending = Buffer.alloc(0);

  private phase: "opening" | "prepared" | "ready" | "failed" = "opening";
  private outcome: SetupOutcome | null = null;
  private failure: { readonly error: unknown } | null = null;
  constructor(private readonly prepared: () => void, private readonly pipelineFrame?: (frame: PipelineFrame) => void) {}
  write(bytes: Uint8Array): void {
    if (this.failure !== null) throw this.failure.error;
    try { this.consume(bytes); }
    catch (error) { this.failure = { error }; throw error; }
  }
  private consume(bytes: Uint8Array): void {

    this.pending = Buffer.concat([this.pending, bytes]);
    for (;;) {
      const end = this.pending.indexOf(10);
      if (end < 0) { if (this.pending.length > (this.pipelineFrame === undefined ? 1024 : 32768)) this.refuse(); return; }
      if (end > (this.pipelineFrame === undefined ? 1024 : 32768)) this.refuse();
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
      } else if (this.phase === "ready" && this.pipelineFrame !== undefined) this.pipelineFrame(frame as unknown as PipelineFrame);
      else this.refuse();
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
  if (!(["argv,candidate,view", "argv,candidate,pipeline,pipelineView,view", "argv,candidate,downloadCache,pipeline,pipelineView,view"].includes(Object.keys(raw).sort().join())) || !isValidFullOid(raw.candidate) || !Array.isArray(raw.argv) ||
      !raw.argv.length || raw.argv.some(value => typeof value !== "string" || value.includes("\0")) || raw.argv[0] === "")
    throw new StoreError("INVALID_REQUEST", "check setup differs from its closed invocation");
  if (raw.pipeline !== undefined && checkPipelineCheck(raw.pipeline) !== null) throw new StoreError("INVALID_REQUEST", "invalid pipeline");
  if (raw.downloadCache !== undefined) {
    const cache = raw.downloadCache as { key: string; files: string[] };
    if (!cache || Object.keys(cache).sort().join() !== "files,key" || !/^[a-f0-9]{64}$/.test(cache.key) || !Array.isArray(cache.files) || cache.files.some(file => !/^[a-f0-9-]{36}\.result$/.test(file))) throw new StoreError("INVALID_REQUEST", "invalid private download cache");
  }
  const pipelineView = raw.pipeline === undefined ? undefined : decodePipelineExecutionView(raw.pipelineView);
  if ((raw.downloadCache === undefined) !== (pipelineView?.downloads === undefined)) throw new StoreError("INVALID_REQUEST", "pipeline download view differs from its cache input");
  return Object.freeze({ ...(raw.downloadCache === undefined ? {} : { downloadCache: raw.downloadCache as { key: string; files: string[] } }), ...(raw.pipeline === undefined ? {} : { pipeline: frozenPipeline(raw.pipeline as CheckPipeline), pipelineView: pipelineView! }), candidate: raw.candidate as string, argv: Object.freeze([...raw.argv]) as readonly string[],
    view: decodeCandidateExecutionView(raw.view) });
}
export async function executeCandidateCheck(input: CandidateInvocation, beforeExec: () => void, status?: (frame: PipelineFrame) => void,
  projectReference?: string): Promise<number> {
  input = decodeCandidateInvocation(input);
  const { workspace, git: executable } = input.view;
  // Selected by the trusted setup entry after acquiring its physical cwd,
  // never by a decoded invocation/model field. Linux keeps its mounted view.
  const project = projectReference ?? input.view.project;
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
  // Keep the source relative to the canonical cwd while writing the private
  // checkout's object database. -C would reinterpret that source there.
  await git(["--git-dir", join(workspace, ".git"), "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--no-auto-maintenance", project, input.candidate]);
  ensureOwnedDirectory(join(workspace, ".git/info"), workspace, 0o700);
  // Unaccepted setup bytes belong to this disposable workspace. Its owner
  // supplies the root; setup must not open/flush ancestors outside its view.
  const attributes = join(workspace, ".git/info/attributes");
  withinDirectory(attributes, (parent, name) => replaceDerivedEntry(parent, name, attributes,
    "* -text -filter -ident !eol !working-tree-encoding\n", 0o600));
  await git(["-C", workspace, "-c", "core.autocrlf=false", "-c", "core.symlinks=true", "checkout", "-q", "--detach", input.candidate]);
  if (input.pipeline !== undefined) {
    if (!status) throw new StoreError("UNSUPPORTED_PROFILE", "pipeline requires a private receipt channel");
    return executePipeline(input.pipeline, workspace, executable, input.candidate, beforeExec, status, input.pipelineView!, input.downloadCache);
  }
  return replaceProcess({ executable: input.argv[0]!, argv: input.argv.slice(1), cwd: workspace, env: process.env }, beforeExec);
}
