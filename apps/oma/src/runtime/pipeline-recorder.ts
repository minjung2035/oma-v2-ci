/** Broker-owned files. Private frames describe steps; their stdout is never parsed as control. */
import { statfsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CheckPipeline } from "@oma/contracts/integration";
import { createResult } from "@oma/tool-files";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { replaceDerivedFile } from "@oma/storage/durable-fs";
import { canonicalJson, sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import type { PipelineFrame } from "@oma/git/candidate-check";
type Output = ReturnType<typeof createResult>;
/** Every output owns descriptors, including siblings after an earlier flush fails. */
function finishOutputs(outputs: readonly Output[]) {
  const results: ReturnType<Output["finish"]>[] = [], failures: unknown[] = [];
  for (const output of outputs) {
    try { results.push(output.finish()); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "pipeline output completion failed");
  return results;
}
export class PipelineRecorder {
  readonly directory: string;
  private active: { index: number; stdout: Output; stderr: Output } | null = null;
  private tracked: Output | null = null;
  private readonly steps: object[] = [];
  private next = 0;
  private ended: Extract<PipelineFrame, { kind: "pipeline-end" }> | null = null;
  private closed = false;
  private readonly startedAtMs = Date.now();
  private firstStepAtMs: number | null = null;
  private cacheObservation: object | null = null;
  private resourceObservation: object | null = null;
  resources(observation: object | undefined): void { this.resourceObservation = observation ?? null; }
  cache(observation: object): void { this.cacheObservation = observation; }
  constructor(root: string, private readonly candidate: string, private readonly pipeline: CheckPipeline, private readonly attempt: string | null) {
    ensureOwnedDirectory(join(root, "checks"), root, 0o700);
    this.directory = join(root, "checks", randomUUID()); ensureOwnedDirectory(this.directory, root, 0o700);
    replaceDerivedFile(join(this.directory, "started.json"), canonicalJson({ version: 2, candidate, attempt,
      policyDigest: sha256Hex(canonicalJson(pipeline)), startedAt: new Date().toISOString() }), 0o600);
  }
  frame(frame: PipelineFrame): void {
    const fail = (): never => { throw new StoreError("REF_STATE_UNKNOWN", "pipeline private receipt sequence differs"); };
    if (this.ended || this.closed || !frame || typeof frame !== "object") fail();
    const keys = Object.keys(frame).sort().join();
    const append = (file: Output, value: unknown): void => {
      if (typeof value !== "string" || value.length > 21848 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail();
      file.append(Buffer.from(value as string, "base64"));
    };
    if (frame.kind === "step-start") {
      const expected = [...this.pipeline.setupSteps, ...this.pipeline.checkSteps][this.next];
      if (keys !== "id,index,kind,phase,startedAt" || this.active || !expected || frame.index !== this.next || frame.id !== expected.id ||
        frame.phase !== (this.next < this.pipeline.setupSteps.length ? "setup" : "check") || typeof frame.startedAt !== "string" || !Number.isFinite(Date.parse(frame.startedAt))) fail();
      this.firstStepAtMs ??= Date.now();
      const stdout = createResult(this.directory);
      try { this.active = { index: this.next, stdout, stderr: createResult(this.directory) }; }
      catch (error) {
        try { stdout.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "pipeline output setup and cleanup failed"); }
        throw error;
      }
      this.steps.push({ ...frame });
    } else if (frame.kind === "step-output") {
      if (keys !== "data,index,kind,stream" || !this.active || frame.index !== this.active.index || !["stdout", "stderr"].includes(frame.stream)) fail();
      append(this.active![frame.stream], frame.data);
    } else if (frame.kind === "step-end") {
      if (keys !== "elapsedMs,exitCode,index,kind,outcome,signal" || !this.active || frame.index !== this.active.index ||
        !["exited", "signalled", "timed-out", "aborted", "spawn-failed", "output-limited", "stalled", "unobserved"].includes(frame.outcome) ||
        !(frame.exitCode === null || Number.isSafeInteger(frame.exitCode)) || !(frame.signal === null || typeof frame.signal === "string") ||
        !Number.isFinite(frame.elapsedMs) || frame.elapsedMs < 0) fail();
      const [stdout, stderr] = finishOutputs([this.active!.stdout, this.active!.stderr]);
      this.steps.push({ ...frame, stdout, stderr });
      this.active = null; this.next++;
    } else if (frame.kind === "tracked-output") {
      if (keys !== "data,kind" || this.active) fail();
      this.tracked ??= createResult(this.directory); append(this.tracked, frame.data);
    } else if (frame.kind === "pipeline-end") {
      if (keys !== "kind,passed,timedOut,tracked" || this.active || typeof frame.passed !== "boolean" || typeof frame.timedOut !== "boolean" ||
        (frame.passed && this.next !== this.pipeline.setupSteps.length + this.pipeline.checkSteps.length)) fail();
      if (frame.tracked?.kind === "observed") {
        if (Object.keys(frame.tracked).sort().join() !== "bytes,kind,sha256" || !Number.isSafeInteger(frame.tracked.bytes) || !/^[a-f0-9]{64}$/.test(frame.tracked.sha256)) fail();
      } else if (frame.tracked?.kind !== "unknown" || Object.keys(frame.tracked).join() !== "kind") fail();
      this.ended = frame;
    } else fail();
  }
  get complete(): boolean { return this.ended !== null; }
  get passed(): boolean { return this.ended?.passed === true; }
  get timedOut(): boolean { return this.ended?.timedOut === true; }
  finish(scopeConfirmedDead: boolean, code: string | null): void {
    if (this.closed) return;
    const outputs = finishOutputs([...(this.active === null ? [] : [this.active.stdout, this.active.stderr]),
      ...(this.tracked === null ? [] : [this.tracked])]);
    const partial = this.active === null ? null : { index: this.active.index, stdout: outputs[0], stderr: outputs[1], complete: false };
    const tracked = this.tracked === null ? null : outputs.at(-1)!;
    if (this.ended?.tracked.kind === "observed" && (this.ended.tracked.bytes !== (tracked?.bytes ?? 0) ||
      this.ended.tracked.sha256 !== (tracked?.sha256 ?? sha256Hex("")))) throw new StoreError("REF_STATE_UNKNOWN", "tracked delta differs from private evidence");
    let diskFreeBytes: number | null = null;
    try { const disk = statfsSync(this.directory); const value = disk.bavail * disk.bsize; if (Number.isSafeInteger(value)) diskFreeBytes = value; } catch { /* unavailable, never a successful zero */ }
    const timing = { elapsedMs: Date.now() - this.startedAtMs, preparationToFirstStepMs: this.firstStepAtMs === null ? null : this.firstStepAtMs - this.startedAtMs };
    const receipt = { version: 2, candidate: this.candidate, attempt: this.attempt, policyDigest: sha256Hex(canonicalJson(this.pipeline)),
      timing, diskFreeBytes, steps: this.steps, partial, tracked, cache: this.cacheObservation, resources: this.resourceObservation, outcome: this.ended, scopeConfirmedDead,
      status: !scopeConfirmedDead ? "unknown" : code !== null || this.ended?.passed !== true ? "failed" : "succeeded", code, endedAt: new Date().toISOString() };
    replaceDerivedFile(join(this.directory, "receipt.json"), canonicalJson(receipt), 0o600);
    this.closed = true;
  }
}
