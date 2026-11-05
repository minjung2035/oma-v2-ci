/** Trusted supervisor inside one exact checkout; candidate output is always data. */
import { createRequire } from "node:module";
import { pipeline as streamPipeline } from "node:stream/promises";
import { realpathSync, createReadStream } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { CheckPipeline } from "@oma/contracts/integration";
import { StoreError } from "@oma/domain/errors";
import { runProcess } from "@oma/process/async";
import { GIT_ENV } from "@oma/process/policies";
import { protectPipelineSupervisor } from "@oma/native/control-socket";
import { decodePipelineExecutionView, type PipelineExecutionView } from "@oma/protocol/git-execution-view";
export type PipelineFrame =
  | { kind: "step-start"; index: number; id: string; phase: "setup" | "check"; startedAt: string }
  | { kind: "step-output"; index: number; stream: "stdout" | "stderr"; data: string }
  | { kind: "step-end"; index: number; outcome: string; exitCode: number | null; signal: string | null; elapsedMs: number }
  | { kind: "tracked-output"; data: string }
  | { kind: "pipeline-end"; passed: boolean; timedOut: boolean; tracked: { kind: "observed"; bytes: number; sha256: string } | { kind: "unknown" } };
export async function executePipeline(pipeline: CheckPipeline, workspace: string, git: string, candidate: string,
  authorize: () => void, status: (frame: PipelineFrame) => void, view: PipelineExecutionView, downloads?: { key: string; files: readonly string[] }): Promise<number> {
  view = decodePipelineExecutionView(view);
  if ((downloads === undefined) !== (view.downloads === undefined)) throw new StoreError("INVALID_REQUEST", "pipeline download view differs from its cache input");
  protectPipelineSupervisor(); authorize();
  const root = realpathSync(workspace), steps = [...pipeline.setupSteps, ...pipeline.checkSteps];
  const privateCache = join(view.temporary, "oma-npm-cache");
  if (downloads !== undefined) {
    try {
      // Use npm's installed cache implementation, not a second cache format.
      // Local tarball `npm cache add` need not retain download content; populate
      // cacache explicitly and let npm verify the lockfile integrity on read.
      const requireNpm = createRequire(view.npm);
      const cacache = requireNpm("cacache") as { put: { stream(root: string, key: string, options: object): import("node:stream").Writable } };
      for (const file of downloads.files) await streamPipeline(createReadStream(join(view.downloads!, file)),
        cacache.put.stream(`${privateCache}/_cacache`, `oma-public-download:${file}`, { algorithms: ["sha512"] }));
    } catch { /* A miss does not skip or fail the explicit setup. */ }
  }
  let passed = true, timedOut = false;
  for (const [index, step] of steps.entries()) {
    status({ kind: "step-start", index, id: step.id, phase: index < pipeline.setupSteps.length ? "setup" : "check", startedAt: new Date().toISOString() });
    const emit = (stream: "stdout" | "stderr") => (bytes: Uint8Array): void => {
      for (let at = 0; at < bytes.byteLength; at += 16384)
        status({ kind: "step-output", index, stream, data: Buffer.from(bytes.subarray(at, at + 16384)).toString("base64") });
    };
    let cwd: string;
    try { cwd = realpathSync(join(root, step.cwd)); }
    catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      emit("stderr")(Buffer.from(`pipeline step ${step.id}: cwd ${JSON.stringify(step.cwd)} is not a directory\n`));
      status({ kind: "step-end", index, outcome: "exited", exitCode: 1, signal: null, elapsedMs: 0 });
      passed = false; break;
    }
    const local = relative(root, cwd);
    if (local === ".." || local.startsWith("../") || isAbsolute(local)) throw new StoreError("UNSUPPORTED_PROFILE", "pipeline step cwd escapes its workspace");
    const result = await runProcess({ executable: step.argv[0]!, argv: step.argv.slice(1), cwd,
      env: { ...process.env, ...(downloads === undefined ? {} : { npm_config_cache: privateCache }), ...pipeline.env, ...step.env, HOME: process.env.HOME, TMPDIR: view.temporary }, timeoutMs: step.deadlineMs ?? null,
      stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 0, stderrOverflow: "discard" },
    { stdoutSink: emit("stdout"), stderrSink: emit("stderr"), processGroup: true });
    status({ kind: "step-end", index, outcome: result.kind, exitCode: result.exitCode, signal: result.signal, elapsedMs: result.elapsedMs });
    if (result.kind !== "exited" || result.exitCode !== 0) { passed = false; timedOut = result.kind === "timed-out"; break; }
  }
  // Report the actual tracked delta. A generator may change sources; this is
  // evidence, not an implicit policy that all projects must remain pristine.
  const hash = createHash("sha256"); let bytes = 0;
  const diff = await runProcess({ executable: git, argv: ["-C", root, "diff", "--no-ext-diff", "--no-textconv", "--binary", candidate, "--"], env: GIT_ENV,
    timeoutMs: 30000, stdoutBytes: 0, stdoutOverflow: "discard", stderrBytes: 0, stderrOverflow: "discard" },
  { stdoutSink: chunk => { hash.update(chunk); bytes += chunk.byteLength; for (let at = 0; at < chunk.byteLength; at += 16384)
    status({ kind: "tracked-output", data: Buffer.from(chunk.subarray(at, at + 16384)).toString("base64") }); } });
  status({ kind: "pipeline-end", passed, timedOut, tracked: diff.kind === "exited" && diff.exitCode === 0
    ? { kind: "observed", bytes, sha256: hash.digest("hex") } : { kind: "unknown" } });
  return passed ? 0 : 1;
}
