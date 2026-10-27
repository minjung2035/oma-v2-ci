/** The delivery lifecycle of one Pi engine process: start it from a plan,
 * hand it a prepared batch, and wait for the trusted boundary it reports.
 * How the process is started lives in `pi-spawn-plan.ts`.
 */
import { stopOwnedChild } from "@oma/process/async";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { PreparedBatch } from "@oma/contracts";
import { CLI_OBSERVATION_SECONDS } from "@oma/domain/limits";
import { StoreError, unobserved } from "@oma/domain/errors";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX, PI_WAIT_PREFIX, PI_WAIT_OBSERVATION_PREFIX } from "@oma/protocol/delivery-boundary";
import { type DeliveryBoundary } from "@oma/contracts";
import type { PathView } from "@oma/contracts/runtime";
import type { ResidentEngineEffects } from "./ports.js";
import { PiRpcClient, alarm, assertPiRpcLimits, type PiEvent, type Timer } from "./pi-rpc.js";
import { planPiSpawn, type PiAdapterOptions, type PiSpawnPlan } from "./pi-spawn-plan.js";
import { preparePiRetry } from "./pi-runtime.js";

function failure(
  code: "SESSION_BOUNDARY_UNCONFIRMED" | "PROVIDER_FAILED" | "UNSUPPORTED_PROFILE" | "DEADLINE_EXCEEDED",
  message: string,
  cause?: unknown,
): StoreError {
  return new StoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
/** WP10: a deadline that rejects `promise` once `seconds` pass without
 * `rearm()`. Built on the monotonic, overflow-safe `alarm`. */
function deadline(
  seconds: number,
  error: StoreError,
): { promise: Promise<never>; rearm(waitSeconds?: number): void; hold(): void; cancel(): void } {
  let fire: (reason: StoreError) => void = () => {};
  const promise = new Promise<never>((_, reject) => { fire = reject; });
  promise.catch(() => {});
  let live = true;
  let timer: Timer | null = alarm(seconds, () => fire(error));
  return {
    promise,
    /** Starts the budget again; a held one resumes, a cancelled one stays cancelled. */
    rearm(waitSeconds = seconds) { if (!live) return; timer?.cancel(); timer = alarm(waitSeconds, () => fire(error)); },
    /** Stops the clock until the next rearm. */
    hold() { timer?.cancel(); timer = null; },
    cancel() { live = false; timer?.cancel(); timer = null; },
  };
}
/** The trusted extension's boundary notice for this batch, or null. The one
 * decoder for it: the Resident adapter and the Principal's delivery both read
 * the engine's notice through this, so neither can accept what the other
 * would refuse. */
export function boundaryOf(
  event: PiEvent,
  batch: PreparedBatch,
): DeliveryBoundary | null {
  if (
    event.type !== "extension_ui_request" ||
    event.method !== "notify" ||
    typeof event.message !== "string" ||
    !event.message.startsWith(PI_BOUNDARY_PREFIX)
  )
    return null;
  let raw: unknown;
  try {
    raw = JSON.parse(event.message.slice(PI_BOUNDARY_PREFIX.length));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const keys = [
    "adapterRevision",
    "batchId",
    "incarnation",
    "sessionPath",
    "entryId",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.adapterRevision !== PI_ADAPTER_REVISION ||
    value.batchId !== batch.id ||
    value.incarnation !== batch.incarnation ||
    typeof value.sessionPath !== "string" ||
    typeof value.entryId !== "string" ||
    !/^[0-9a-f]{8}$/.test(value.entryId)
  )
    return null;
  return {
    adapterRevision: PI_ADAPTER_REVISION,
    batchId: batch.id,
    incarnation: batch.incarnation,
    sessionPath: value.sessionPath,
    entryId: value.entryId,
  };
}
/** RUN-003: a wait notice names only this attempt and cannot be a receipt.
 * Mirrors the trusted extension's wire spelling (PI-001). */
export function waitOf(event: PiEvent, batch: PreparedBatch): boolean {
  const prefix = PI_WAIT_PREFIX;
  if (event.type !== "extension_ui_request" || event.method !== "notify" ||
    typeof event.message !== "string" || !event.message.startsWith(prefix)) return false;
  let raw: unknown;
  try { raw = JSON.parse(event.message.slice(prefix.length)); } catch { return false; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  return Object.keys(value).length === 3 && value.adapterRevision === PI_ADAPTER_REVISION &&
    value.batchId === batch.id && value.incarnation === batch.incarnation;
}

/** Control-phase evidence only; neither a wait request nor a receipt. */
export function waitObservationOf(event: PiEvent, batch: PreparedBatch): "begin" | "end" | "failed" | null {
  const prefix = PI_WAIT_OBSERVATION_PREFIX;
  if (event.type !== "extension_ui_request" || event.method !== "notify" ||
    typeof event.message !== "string" || !event.message.startsWith(prefix)) return null;
  let raw: unknown;
  try { raw = JSON.parse(event.message.slice(prefix.length)); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || value.adapterRevision !== PI_ADAPTER_REVISION ||
    value.batchId !== batch.id || value.incarnation !== batch.incarnation) return null;
  return value.phase === "begin" || value.phase === "end" || value.phase === "failed" ? value.phase : null;
}

/** What the runner last saw its engine doing -- the payload of
 * `runner.observe` minus the send-time stamp. `"tool"` is the only reason
 * that names the tool; the rest describe the engine's own phases. This is a
 * diagnostic, never evidence: nothing the broker or a receipt decides reads
 * it. */
export interface EngineObservation {
  readonly reason: string;
  readonly toolName?: string;
}
/** One event's report of engine activity, or null when the event says none.
 * The events a delivery already watches are its only source -- the same
 * bytes the boundary logic trusts, reported at face value. */
export function runnerObservationOf(
  event: PiEvent,
  batch: PreparedBatch,
): EngineObservation | null {
  if (waitOf(event, batch)) return { reason: "waiting" };
  if (event.type === "tool_execution_start")
    return typeof event.toolName === "string"
      ? { reason: "tool", toolName: event.toolName }
      : { reason: "tool" };
  if (event.type === "turn_start") return { reason: "inference" };
  if (event.type === "compaction_start") return { reason: "compaction" };
  return null;
}
/** Optional listeners on a delivery's event stream. The adapter reports;
 * what the runner does with an observation is its own business. */
export interface DeliveryHooks {
  observe?(observation: EngineObservation): void;
}

export class PiAdapter {
  private issuedView: PathView | undefined;
  constructor(private readonly effects: ResidentEngineEffects, private readonly options: PiAdapterOptions) {
    if (options.confinement === undefined)
      throw failure("UNSUPPORTED_PROFILE", "Resident execution requires confinement");
    if (!Number.isSafeInteger(options.profile.inferenceSeconds) || options.profile.inferenceSeconds <= 0)
      throw failure("UNSUPPORTED_PROFILE", "Pi inference silence budget is unavailable");
    for (const path of [
      options.paths.piCommand,
      // The vendored engine entry is an asset too, not just an argument.
      ...(options.paths.piArgs ?? []),
      options.paths.coreExtension,
      options.paths.cli,
      options.paths.workspace,
      options.paths.sessionDir,
      options.paths.agentHome,
      options.paths.mailArchive,
      options.paths.batchView,
    ]) {
      try {
        realpathSync(path);
      } catch (cause) {
        throw unobserved(cause, `the Pi adapter path ${basename(path)}`) ?? failure(
          "UNSUPPORTED_PROFILE",
          `Pi adapter path is unavailable: ${basename(path)}`,
          cause,
        );
      }
    }
  }
  /** How the engine will be started. Public because how a Resident is confined
   * is a property callers and operators need to be able to read, and because a
   * plan that can only be observed by running it cannot be checked.
   */
  spawnPlan(): PiSpawnPlan {
    return planPiSpawn(this.effects.sandbox, this.options, this.pathView());
  }
  /** One immutable path recipe for this adapter's argv and session return.
   * This holds no liveness/grant observation; those owners still recheck. */
  private pathView(): PathView {
    const confinement = this.options.confinement;
    return this.issuedView ??= this.effects.sandbox.pathView(confinement.host, confinement.lease, confinement.directories, {
      ...(confinement.inference === undefined ? {} : { inference: confinement.inference.socketHostPath }),
      ...(confinement.egress === undefined ? {} : { egress: confinement.egress.socketHostPath }),
    });
  }
  /** AV17: a confined engine reports its session file by the sandbox's view of
   * it; the receipt the trusted runner publishes names it by its host path
   * (D01, SB-006). A boundary whose session path is not a file of this
   * Resident's session mount is no boundary. */
  private hostBoundary(boundary: DeliveryBoundary | null): DeliveryBoundary | null {
    if (boundary === null) return null;
    const sessionPath = this.pathView().sessionPathToHost(boundary.sessionPath);
    return sessionPath === null ? null : { ...boundary, sessionPath };
  }
  /** null is a deliberate wait after persisted tools, never delivery success. */
  async deliver(batch: PreparedBatch, hooks?: DeliveryHooks): Promise<DeliveryBoundary | null> {
    assertPiRpcLimits(this.options.limits);
    if (batch.agent !== this.options.actor)
      throw failure(
        "SESSION_BOUNDARY_UNCONFIRMED",
        "prepared batch belongs to another actor",
      );
    // operations/README + TUI-010: the recorded digests are checked again here,
    // at the last moment before the file is handed to Pi.
    this.effects.assertExtensions(this.options.profile.extensions);
    preparePiRetry(this.effects.settings, join(this.options.paths.agentHome, "engine"));
    const spawn = this.spawnPlan();
    // DR18 (D-5): a confined engine's sandbox filter reaches bubblewrap on the
    // descriptor only this parent holds, and nowhere else.
    const child = this.effects.sandbox.spawn(spawn);
    let childClosed = false;
    let onClose!: () => void;
    const closed = new Promise<void>(resolve => {
      onClose = () => { childClosed = true; resolve(); };
      child.once("close", onClose);
    });
    let rpc: PiRpcClient | null = null;
    let unsubscribe: (() => void) | null = null;
    let acceptDeadline: ReturnType<typeof deadline> | null = null;
    let idleDeadline: ReturnType<typeof deadline> | null = null;
    let inferenceDeadline: ReturnType<typeof deadline> | null = null;
    let observationDeadline: ReturnType<typeof deadline> | null = null;
    let closeDeadline: ReturnType<typeof deadline> | null = null;
    let primary: { error: unknown } | null = null;
    try {
      rpc = new PiRpcClient(child, this.options.limits);
      let accepted = false;
      let settled = false;
      let waiting = false;
      let observingWait = false;
      let waitUnobserved = false;
      let lastStop = "";
      const providerFailed = (): boolean => ["error", "aborted"].includes(lastStop);
      let boundary: DeliveryBoundary | null = null;
      let wake!: () => void;
      const changed = new Promise<void>((resolve) => {
        wake = resolve;
      });
      // DR27/WP10: a delivery can contain any number of requests and tools.
      // Only silence has a budget: a model request (including before its first
      // token) or compaction uses the model budget; control events use the RPC
      // budget. Announced tools keep their own timeout/cancellation semantics.
      // No elapsed delivery time is evidence of failure or task completion.
      acceptDeadline = deadline(this.options.limits.receiptWaitSeconds, failure(
        "SESSION_BOUNDARY_UNCONFIRMED", "Pi did not accept the delivery command before the acceptance deadline"));
      idleDeadline = deadline(this.options.limits.idleStreamSeconds, failure(
        "DEADLINE_EXCEEDED", "Pi produced no event for the configured idle stream budget"));
      inferenceDeadline = deadline(this.options.profile.inferenceSeconds, failure(
        "DEADLINE_EXCEEDED", "Pi inference or compaction produced no progress for the configured model silence budget"));
      inferenceDeadline!.hold();
      // One absolute CLI observation plus a bounded startup/drain allowance.
      // Repeated begin/progress events cannot extend this phase indefinitely.
      observationDeadline = deadline(CLI_OBSERVATION_SECONDS + this.options.limits.receiptWaitSeconds,
        failure("SESSION_BOUNDARY_UNCONFIRMED", "Pi did not finish observing the current run's wait intent"));
      observationDeadline!.hold();
      const tools = new Set<string>();
      let inferring = false;
      let compacting = false;
      unsubscribe = rpc.onEvent((event) => {
        // runner.observe's one source: report what the event says at face
        // value before the boundary logic consumes it.
        const seen = runnerObservationOf(event, batch);
        if (seen !== null) hooks?.observe?.(seen);
        const observation = waitObservationOf(event, batch);
        if (observation === "begin" && !observingWait) {
          observingWait = true; observationDeadline!.rearm();
        } else if (observingWait && (observation === "end" || observation === "failed")) {
          observingWait = false; observationDeadline!.hold();
          if (observation === "failed") waitUnobserved = true;
        }
        const message = "message" in event ? event.message : undefined;
        const assistant = message !== null && typeof message === "object" && !Array.isArray(message) &&
          (message as Record<string, unknown>).role === "assistant";
        // message_start can come only after the first provider bytes. turn_start
        // is emitted before the request and protects silent initial reasoning.
        if (event.type === "turn_start" || (assistant && ["message_start", "message_update"].includes(event.type))) inferring = true;
        if ((assistant && event.type === "message_end") || event.type === "turn_end") inferring = false;
        if (event.type === "compaction_start") compacting = true;
        if (event.type === "compaction_end") compacting = false;
        if (event.type === "agent_settled") { inferring = false; compacting = false; }
        if ("toolCallId" in event && typeof event.toolCallId === "string") {
          if (event.type === "tool_execution_start") tools.add(event.toolCallId);
          if (event.type === "tool_execution_end") tools.delete(event.toolCallId);
        }
        if (compacting || inferring) { idleDeadline!.hold(); inferenceDeadline!.rearm(); }
        else {
          inferenceDeadline!.hold();
          if (tools.size > 0 || observingWait) idleDeadline!.hold();
          else if (event.type === "auto_retry_start" && typeof event.delayMs === "number" &&
            Number.isSafeInteger(event.delayMs) && event.delayMs >= 0 && event.delayMs <= 8000)
            idleDeadline!.rearm(this.options.limits.idleStreamSeconds + event.delayMs / 1000);
          else idleDeadline!.rearm();
        }
        if (
          event.type === "response" &&
          event.id === batch.id &&
          event.command === "prompt"
        ) {
          accepted = event.success === true;
          acceptDeadline!.cancel();
          if (!accepted) wake();
        }
        if (event.type === "message_end") {
          // Remembered, not acted on. Pi retries a retryable failure and
          // compacts before continuing the same run, so one failed assistant
          // message is not the end of it; only the last one before the run
          // settles says how the delivery ended.
          const message = event.message;
          if (
            message &&
            typeof message === "object" &&
            !Array.isArray(message) &&
            (message as Record<string, unknown>).role === "assistant"
          )
            lastStop = String(
              (message as Record<string, unknown>).stopReason ?? "",
            );
        }
        if (event.type === "agent_settled") settled = true;
        const decoded = this.hostBoundary(boundaryOf(event, batch));
        if (decoded) boundary = decoded;
        if (waitOf(event, batch)) waiting = true;
        if ((accepted && settled && !observingWait && (boundary || waiting || waitUnobserved)) || (settled && providerFailed()))
          wake();
      });
      await rpc.send({
        id: batch.id,
        type: "prompt",
        message: `/oma-deliver ${batch.id}`,
      });
      await Promise.race([
        changed,
        acceptDeadline.promise,
        idleDeadline.promise,
        inferenceDeadline.promise,
        observationDeadline.promise,
        rpc.completion.then((result) => {
          if (result.state === "failed") throw result.error;
          throw failure(
            "SESSION_BOUNDARY_UNCONFIRMED",
            "Pi exited before confirming the delivery boundary",
          );
        }),
      ]);
      acceptDeadline.cancel(); idleDeadline.cancel(); inferenceDeadline.cancel(); observationDeadline.cancel();
      if (!accepted)
        throw failure("SESSION_BOUNDARY_UNCONFIRMED", "Pi refused the delivery command");
      if (waitUnobserved)
        throw failure("SESSION_BOUNDARY_UNCONFIRMED", "Pi could not observe the current run's wait intent");
      if (!waiting && !boundary && providerFailed())
        throw failure(
          "PROVIDER_FAILED",
          "Pi provider failed before the batch reached a settled boundary",
        );
      if (!accepted || !settled || observingWait || (!boundary && !waiting))
        throw failure(
          "SESSION_BOUNDARY_UNCONFIRMED",
          "Pi delivery evidence was incomplete",
        );
      child.kill("SIGTERM");
      closeDeadline = deadline(
        this.options.limits.receiptWaitSeconds,
        failure(
          "SESSION_BOUNDARY_UNCONFIRMED",
          "Pi did not close after its settled boundary",
        ),
      );
      // EOF ends a transport, not the process. Keep ownership until close.
      const [ended] = await Promise.race([Promise.all([rpc.completion, closed]), closeDeadline.promise]);
      if (ended.state === "failed")
        throw failure(
          "SESSION_BOUNDARY_UNCONFIRMED",
          "Pi transport failed while sealing its session",
          ended.error,
        );
      return waiting ? null : boundary;
    } catch (error) {
      primary = { error };
      throw error;
    } finally {
      acceptDeadline?.cancel(); idleDeadline?.cancel(); inferenceDeadline?.cancel(); observationDeadline?.cancel();
      closeDeadline?.cancel();
      const cleanupErrors: unknown[] = [];
      try { unsubscribe?.(); } catch (error) { cleanupErrors.push(error); }
      try { if (rpc) rpc.close(); else stopOwnedChild(child); }
      catch (error) { cleanupErrors.push(error); }
      // Ending the transport is not child death. Observe OS close, or report
      // an unconfirmed stop; elapsed time never creates a delivery receipt or
      // proves that arbitrary descendants (the execution owner's responsibility) died.
      if (!childClosed) {
        const stopDeadline = deadline(this.options.limits.receiptWaitSeconds,
          failure("SESSION_BOUNDARY_UNCONFIRMED", "Pi child termination could not be confirmed"));
        try { await Promise.race([closed, stopDeadline.promise]); }
        catch (cleanup) { cleanupErrors.push(cleanup); }
        finally { stopDeadline.cancel(); child.off("close", onClose); }
      }
      if (cleanupErrors.length > 0) {
        if (primary !== null) throw new AggregateError([primary.error, ...cleanupErrors], "Pi delivery and child termination failed");
        throw new AggregateError(cleanupErrors, "Pi child termination failed");
      }
    }
  }
}
