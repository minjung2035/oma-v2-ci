import { preparePipelineCache } from "./pipeline-cache.js";
import { PipelineRecorder } from "./pipeline-recorder.js";
import { residentRootfsPath } from "@oma/platform-linux/resident-rootfs";
/** INT-002/007: a check reads an exact commit in a disposable sandbox.
 * An injected native execution owner owns the whole scope; there is no host execution fallback,
 * persistent checker, request file, checkout cleanup or model-facing endpoint.
 */
import { closeSync, createReadStream, writeSync } from "node:fs";
import { once } from "node:events";
import { controlPipe } from "@oma/native/control-socket";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { openOwnedDirectoryPath } from "@oma/storage/directory";
import { ExecutionStaging, type ExecutionStage } from "@oma/storage/execution-staging";
import { CandidateSetupStatus } from "@oma/git/candidate-check";
import type { CommandSpec, ProcessObservation } from "@oma/process/command";
import { candidateSandbox } from "@oma/platform-linux/candidate-sandbox";
import { candidateSeatbelt } from "@oma/platform-mac/git-sandbox";
import { observeMacDeveloperTools } from "@oma/platform-mac/developer-tools";
import { StoreError } from "@oma/domain/errors";
import type { GitPaths } from "@oma/git/paths";
import type { FrozenCheck } from "@oma/domain/integration-policy";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { observed, requireNoGitlinks } from "@oma/domain/git-facts";
import { type GitObserver } from "@oma/git/observe";


export class CandidateChecks {
  private readonly staging: ExecutionStaging | null;
  constructor(private readonly paths: GitPaths,
    private readonly execute: (command: CommandSpec, signal: AbortSignal, authorize: () => void, inheritedFds: readonly number[], prepared: () => void) => Promise<ProcessObservation>,
    private readonly observations: Pick<GitObserver, "gitlinks"> = createCanonicalObserver(),
    private readonly ownerSignal?: AbortSignal,
    private readonly confirmDead?: () => boolean,
    private readonly resources?: import("@oma/contracts/host").WorkloadResourceProfile) { this.staging = confirmDead === undefined ? null : new ExecutionStaging(paths.stateRoot, "candidate", confirmDead); }
  async run(candidate: string, check: FrozenCheck, cancellationSignal: AbortSignal | undefined, authorize: () => void, attempt: string | null = null): Promise<void> {
    if (this.ownerSignal?.aborted) throw new StoreError("REF_STATE_UNKNOWN", "check owner is stopping");
    if (cancellationSignal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "the request was cancelled before checks");
    const recorder = check.pipeline === undefined ? null : new PipelineRecorder(this.paths.stateRoot, candidate, check.pipeline, attempt);
    let failureCode: string | null = null;
    const deadline = new AbortController(); let expired = false;
    const timer = this.resources?.checkWallTimeMs === undefined ? undefined : setTimeout(() => { expired = true; deadline.abort(); }, this.resources.checkWallTimeMs);
    const signal = AbortSignal.any([deadline.signal, ...(cancellationSignal === undefined ? [] : [cancellationSignal])]);
    try {
      if (process.platform === "darwin") {
        if (this.staging === null) throw new StoreError("UNSUPPORTED_PROFILE", "candidate staging requires its execution-scope owner");
        await this.staging.run(stage => this.runPrepared(candidate, check, signal, authorize, recorder, stage));
      } else await this.runPrepared(candidate, check, signal, authorize, recorder);
    } catch (error) {
      failureCode = error instanceof StoreError ? error.code : "REF_STATE_UNKNOWN";
      if (expired && !this.ownerSignal?.aborted && !(error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN")) {
        if (this.confirmDead?.() !== true) throw new StoreError("RUN_TERMINATION_UNKNOWN", "check deadline expired but scope death is unconfirmed", { cause: error });
        failureCode = "CHECK_TIMEOUT";
        throw new StoreError("CHECK_TIMEOUT", "check deadline expired; the complete scope is confirmed dead", { cause: error });
      }
      throw error;
    } finally { clearTimeout(timer); recorder?.finish(this.confirmDead?.() === true, failureCode); }
  }
  private async runPrepared(candidate: string, check: FrozenCheck, cancellationSignal: AbortSignal | undefined, authorize: () => void,
    recorder: PipelineRecorder | null, stage?: ExecutionStage): Promise<void> {
    if (this.ownerSignal?.aborted) throw new StoreError("REF_STATE_UNKNOWN", "check owner is stopping");
    if (cancellationSignal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "the request was cancelled before checks");
    const own = new AbortController();
    const signal = AbortSignal.any([own.signal, this.ownerSignal, cancellationSignal].filter((value): value is AbortSignal => value !== undefined));
    let cacheFd: number | undefined;
    let project: number | undefined, read: number | undefined, write: number | undefined;
    let releaseRead: number | undefined, releaseWrite: number | undefined;
    let reader: ReturnType<typeof createReadStream> | undefined;
    const closeWriter = (): void => { const fd = write; write = undefined; if (fd !== undefined) closeSync(fd); };
    const closeReleaseRead = (): void => { const fd = releaseRead; releaseRead = undefined; if (fd !== undefined) closeSync(fd); };
    const closeReleaseWrite = (): void => { const fd = releaseWrite; releaseWrite = undefined; if (fd !== undefined) closeSync(fd); };
    return withAsyncCleanup(async () => {
      const cache = check.pipeline === undefined ? null : await preparePipelineCache(this.paths, candidate, check.pipeline, signal);
      if (cache !== null) cacheFd = openOwnedDirectoryPath(cache.root);
      recorder?.cache(cache === null ? { state: "off-or-miss" } : { state: cache.state, key: cache.key, files: cache.files.length });
      project = openOwnedDirectoryPath(this.paths.projectGit);
      const pipe = controlPipe(); read = pipe.read; write = pipe.write;
      const release = controlPipe(); releaseRead = release.read; releaseWrite = release.write;
      reader = createReadStream("", { fd: read, autoClose: true }); read = undefined;
      const status = new CandidateSetupStatus(() => {
        if (signal.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "candidate was cancelled before final exec");
        authorize();
        if (signal.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "candidate was cancelled during final authority check");
        if (releaseWrite === undefined || writeSync(releaseWrite, Buffer.from([1])) !== 1)
          throw new StoreError("REF_STATE_UNKNOWN", "candidate final exec gate was not released");
        closeReleaseWrite();
      }, recorder === null ? undefined : frame => recorder.frame(frame));
      const evidence = (async () => {
        for await (const chunk of reader!) status.write(chunk);
        return status.finish();
      })();
      let setupFailure: { error: unknown } | undefined;
      void evidence.catch(error => { setupFailure = { error }; own.abort(); });
      if (!this.paths.checkNode || !this.paths.checkAssetsDir)
        throw new StoreError("UNSUPPORTED_PROFILE", "candidate sandbox installation is incomplete");
      let command: CommandSpec;
      if (process.platform === "darwin") {
        if (stage === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "candidate has no owned physical staging");
        const tools = await observeMacDeveloperTools(stage.temporary,
          command => this.execute(command, signal, authorize, [stage.leaseFd], () => {}));
        command = candidateSeatbelt({ node: this.paths.checkNode, libdir: this.paths.checkAssetsDir, tools },
          { git: tools.git, project: this.paths.projectGit, workspace: stage.workspace }, stage.temporary, candidate, check).command;
      } else command = candidateSandbox({ rootfs: residentRootfsPath(this.paths.stateRoot), node: this.paths.checkNode, libdir: this.paths.checkAssetsDir, ...(cache === null ? {} : { downloadCache: { key: cache.key, files: cache.files } }) }, candidate, check);
      let observation: ProcessObservation;
      let initialRefusal: { error: unknown } | undefined;
      try { observation = await this.execute(command, signal, () => {
        try { authorize(); } catch (error) { initialRefusal = { error }; throw error; }
      }, [write!, project, releaseRead, ...(cacheFd === undefined ? [] : [cacheFd]), ...(stage === undefined ? [] : [stage.leaseFd])], () => cleanupAll([closeWriter, closeReleaseRead])); }
      catch (error) {
        if (initialRefusal?.error === error) throw error;
        if (setupFailure !== undefined) throw new AggregateError([setupFailure.error, error], "candidate setup and execution cleanup failed");
        throw error;
      }
      closeWriter();
      recorder?.resources(observation.resources);
      if (setupFailure !== undefined) throw setupFailure.error;
      if (this.ownerSignal?.aborted) throw new StoreError("REF_STATE_UNKNOWN", `trusted check ${check.id} was interrupted by owner shutdown`);
      if (cancellationSignal?.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "the request was cancelled during checks");
      if (observation.resources && (observation.kind !== "exited" || observation.exitCode !== 0)) {
        if (observation.resources.oomKills > 0) throw new StoreError("CHECK_OOM", "check scope has an observed OOM kill");
        if (observation.resources.taskLimitHits > 0) throw new StoreError("CHECK_TASK_LIMIT", "check scope has an observed task limit refusal");
      }
      if (observation.kind !== "exited") throw new StoreError("REF_STATE_UNKNOWN", `trusted check ${check.id} outcome is ${observation.kind}`);
      const setup = await evidence;
      if (setup.kind === "failed") {
        if (setup.code === "UNSUPPORTED_PROFILE") this.refuseGitlinks(candidate);
        throw new StoreError(setup.code, "trusted candidate setup refused before the check");
      }
      if (recorder?.timedOut) {
        if (this.confirmDead?.() !== true) throw new StoreError("RUN_TERMINATION_UNKNOWN", "pipeline step timed out before scope death was confirmed");
        throw new StoreError("CHECK_TIMEOUT", "pipeline step deadline expired and its whole scope is dead");
      }
      if (recorder !== null && !recorder.complete) throw new StoreError("REF_STATE_UNKNOWN", "pipeline completion has no private evidence");
      if (observation.exitCode === 0 && (recorder === null || recorder.passed)) return;
      throw new StoreError("CHECK_FAILED", `trusted check ${check.id} did not pass (runner exit ${observation.exitCode})`);
    }, async () => {
      own.abort();
      const failures: unknown[] = [];
      try { cleanupAll([closeWriter, closeReleaseRead, closeReleaseWrite, () => { if (read !== undefined) closeSync(read); }, () => { if (project !== undefined) closeSync(project); }, () => { if (cacheFd !== undefined) closeSync(cacheFd); }]); }
      catch (error) { failures.push(error); }
      if (reader !== undefined && !reader.closed) {
        const current = reader;
        // Destroying an async iterator can emit its expected ABORT_ERR before
        // the descriptor actually closes. Join close even after an error;
        // retain genuine I/O failures without duplicating our own abort.
        const closed = new Promise<void>(resolve => current.once("close", resolve));
        const outcome = once(current, "close").then(() => null, (error: unknown) => ({ error }));
        current.destroy();
        const failure = await outcome; await closed;
        if (failure !== null && !(failure.error instanceof Error && "code" in failure.error && failure.error.code === "ABORT_ERR")) failures.push(failure.error);
      }
      if (failures.length) throw new AggregateError(failures, "candidate setup descriptor cleanup failed");
    });
  }

  /** The private setup descriptor is closed on exec and never reaches check
   * code. A gitlink refusal is also re-observed through its canonical owner. */
  private refuseGitlinks(candidate: string): void {
    requireNoGitlinks(observed(this.observations.gitlinks(this.paths.projectGit, candidate), "candidate gitlinks"));
  }
}
