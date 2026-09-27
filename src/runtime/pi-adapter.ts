/** The delivery lifecycle of one Pi engine process: start it from a plan,
 * hand it a prepared batch, and wait for the trusted boundary it reports.
 * How the process is started lives in `pi-spawn-plan.ts`.
 */
import { spawnOwnedRpc } from "../process/async.js";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { PreparedBatch } from "../../implementation/contracts.js";
import { StoreError, unobserved } from "../domain/errors.js";
import {
  PI_ADAPTER_REVISION,
  PI_BOUNDARY_PREFIX,
  type DeliveryBoundary,
} from "../storage/delivery-receipt.js";
import { assertExtensionIntegrity } from "./extension-integrity.js";
import { PiRpcClient, alarm, type PiEvent, type Timer } from "./pi-rpc.js";
import { planPiSpawn, type PiAdapterOptions, type PiSpawnPlan } from "./pi-spawn-plan.js";
import { hostSessionPath } from "../sandbox.js";

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
): { promise: Promise<never>; rearm(): void; hold(): void; cancel(): void } {
  let fire: (reason: StoreError) => void = () => {};
  const promise = new Promise<never>((_, reject) => { fire = reject; });
  promise.catch(() => {});
  let live = true;
  let timer: Timer | null = alarm(seconds, () => fire(error));
  return {
    promise,
    /** Starts the budget again; a held one resumes, a cancelled one stays cancelled. */
    rearm() { if (!live) return; timer?.cancel(); timer = alarm(seconds, () => fire(error)); },
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
export class PiAdapter {
  constructor(private readonly options: PiAdapterOptions) {
    if (!Number.isSafeInteger(options.profile.workspaceBytes) || options.profile.workspaceBytes <= 0)
      throw failure("UNSUPPORTED_PROFILE", "Pi workspace quota is unavailable");
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
    return planPiSpawn(this.options);
  }
  /** AV17: a confined engine reports its session file by the sandbox's view of
   * it; the receipt the trusted runner publishes names it by its host path
   * (D01, SB-006). A boundary whose session path is not a file of this
   * Resident's session mount is no boundary. */
  private hostBoundary(boundary: DeliveryBoundary | null): DeliveryBoundary | null {
    const confinement = this.options.confinement;
    if (boundary === null || confinement === undefined) return boundary;
    const sessionPath = hostSessionPath(confinement.directories, boundary.sessionPath);
    return sessionPath === null ? null : { ...boundary, sessionPath };
  }
  async deliver(batch: PreparedBatch): Promise<DeliveryBoundary> {
    if (batch.agent !== this.options.actor)
      throw failure(
        "SESSION_BOUNDARY_UNCONFIRMED",
        "prepared batch belongs to another actor",
      );
    // operations/README + TUI-010: the recorded digests are checked again here,
    // at the last moment before the file is handed to Pi.
    assertExtensionIntegrity(this.options.profile.extensions);
    const spawn = this.spawnPlan();
    // DR18 (D-5): a confined engine's sandbox filter reaches bubblewrap on the
    // descriptor only this parent holds, and nowhere else.
    const child = spawnOwnedRpc(spawn.command, spawn.args, spawn.cwd, spawn.env, spawn.filter !== undefined);
    if (spawn.filter !== undefined) {
      const channel = child.stdio[3] as unknown as { on(event: "error", listener: () => void): void; end(bytes: Uint8Array): void };
      // bubblewrap reads the program and closes its end, which may reset
      // ours. That is no failure of this process: a program bubblewrap could
      // not read fails bubblewrap itself, and that is the engine's start
      // failing, which this delivery reports.
      channel.on("error", () => {});
      channel.end(spawn.filter);
    }
    const rpc = new PiRpcClient(child, this.options.limits);
    let accepted = false;
    let settled = false;
    let lastStop = "";
    const providerFailed = (): boolean => ["error", "aborted"].includes(lastStop);
    let boundary: DeliveryBoundary | null = null;
    let wake!: () => void;
    const changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
    // WP10/D06: four budgets, four meanings. Acceptance of the command
    // (receiptWaitSeconds), silence between the engine's events
    // (idleStreamSeconds, re-armed by every event), the whole delivery turn
    // (the model profile's inferenceTimeoutSeconds) and the close after the
    // settled boundary (receiptWaitSeconds). A long turn that keeps
    // producing events is not idle, and neither is one running a tool it
    // announced (AV24): that silence is the tool's, which the tool's own
    // timeout and the turn budget bound. Idle is silence while the engine
    // owes an event.
    const acceptDeadline = deadline(this.options.limits.receiptWaitSeconds, failure(
      "SESSION_BOUNDARY_UNCONFIRMED", "Pi did not accept the delivery command before the acceptance deadline"));
    const idleDeadline = deadline(this.options.limits.idleStreamSeconds, failure(
      "DEADLINE_EXCEEDED", "Pi produced no event for the configured idle stream budget"));
    const turnDeadline = deadline(this.options.profile.turnSeconds, failure(
      "DEADLINE_EXCEEDED", "the delivery turn exceeded the model's inference timeout"));
    const tools = new Set<string>();
    const unsubscribe = rpc.onEvent((event) => {
      if (typeof event.toolCallId === "string") {
        if (event.type === "tool_execution_start") tools.add(event.toolCallId);
        if (event.type === "tool_execution_end") tools.delete(event.toolCallId);
      }
      if (tools.size > 0) idleDeadline.hold();
      else idleDeadline.rearm();
      if (
        event.type === "response" &&
        event.id === batch.id &&
        event.command === "prompt"
      ) {
        accepted = event.success === true;
        acceptDeadline.cancel();
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
      if ((accepted && settled && boundary) || (settled && providerFailed()))
        wake();
    });
    let closeDeadline: ReturnType<typeof deadline> | null = null;
    try {
      await rpc.send({
        id: batch.id,
        type: "prompt",
        message: `/oma-deliver ${batch.id}`,
      });
      await Promise.race([
        changed,
        acceptDeadline.promise,
        idleDeadline.promise,
        turnDeadline.promise,
        rpc.completion.then((result) => {
          if (result.state === "failed") throw result.error;
          throw failure(
            "SESSION_BOUNDARY_UNCONFIRMED",
            "Pi exited before confirming the delivery boundary",
          );
        }),
      ]);
      acceptDeadline.cancel(); idleDeadline.cancel(); turnDeadline.cancel();
      if (!accepted)
        throw failure("SESSION_BOUNDARY_UNCONFIRMED", "Pi refused the delivery command");
      if (!boundary && providerFailed())
        throw failure(
          "PROVIDER_FAILED",
          "Pi provider failed before the batch reached a settled boundary",
        );
      if (!accepted || !settled || !boundary)
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
      const ended = await Promise.race([rpc.completion, closeDeadline.promise]);
      if (ended.state === "failed")
        throw failure(
          "SESSION_BOUNDARY_UNCONFIRMED",
          "Pi transport failed while sealing its session",
          ended.error,
        );
      return boundary;
    } finally {
      acceptDeadline.cancel(); idleDeadline.cancel(); turnDeadline.cancel();
      closeDeadline?.cancel();
      unsubscribe();
      rpc.close();
    }
  }
}
