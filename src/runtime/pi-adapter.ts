/** The delivery lifecycle of one Pi engine process: start it from a plan,
 * hand it a prepared batch, and wait for the trusted boundary it reports.
 * How the process is started lives in `pi-spawn-plan.ts`.
 */
import { spawnOwnedRpc } from "../process/async.js";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type { PreparedBatch } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import {
  PI_ADAPTER_REVISION,
  PI_BOUNDARY_PREFIX,
  type DeliveryBoundary,
} from "../storage/delivery-receipt.js";
import { assertExtensionIntegrity } from "./extension-integrity.js";
import { PiRpcClient, type PiEvent } from "./pi-rpc.js";
import { planPiSpawn, type PiAdapterOptions, type PiSpawnPlan } from "./pi-spawn-plan.js";

function failure(
  code:
    | "SESSION_BOUNDARY_UNCONFIRMED"
    | "PROVIDER_FAILED"
    | "UNSUPPORTED_PROFILE",
  message: string,
  cause?: unknown,
): StoreError {
  return new StoreError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
function deadline(
  milliseconds: number,
  error: StoreError,
): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error), Math.min(0x7fffffff, milliseconds));
  });
  return {
    promise,
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
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
        throw failure(
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
    const child = spawnOwnedRpc(spawn.command, spawn.args, spawn.cwd, spawn.env);
    const rpc = new PiRpcClient(child, this.options.limits);
    let accepted = false;
    let settled = false;
    let providerFailed = false;
    let boundary: DeliveryBoundary | null = null;
    let wake!: () => void;
    const changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const unsubscribe = rpc.onEvent((event) => {
      if (
        event.type === "response" &&
        event.id === batch.id &&
        event.command === "prompt"
      )
        accepted = event.success === true;
      if (event.type === "message_end") {
        const message = event.message;
        if (
          message &&
          typeof message === "object" &&
          !Array.isArray(message) &&
          (message as Record<string, unknown>).role === "assistant" &&
          ["error", "aborted"].includes(
            String((message as Record<string, unknown>).stopReason),
          )
        )
          providerFailed = true;
      }
      if (event.type === "agent_settled") settled = true;
      const decoded = boundaryOf(event, batch);
      if (decoded) boundary = decoded;
      if ((accepted && settled && boundary) || providerFailed) wake();
    });
    const deliveryDeadline = deadline(
      this.options.limits.idleStreamSeconds * 1000,
      failure(
        "SESSION_BOUNDARY_UNCONFIRMED",
        "Pi did not produce a trusted settled delivery boundary before the configured deadline",
      ),
    );
    let closeDeadline: ReturnType<typeof deadline> | null = null;
    try {
      await rpc.send({
        id: batch.id,
        type: "prompt",
        message: `/oma-deliver ${batch.id}`,
      });
      await Promise.race([
        changed,
        deliveryDeadline.promise,
        rpc.completion.then((result) => {
          if (result.state === "failed") throw result.error;
          throw failure(
            "SESSION_BOUNDARY_UNCONFIRMED",
            "Pi exited before confirming the delivery boundary",
          );
        }),
      ]);
      deliveryDeadline.cancel();
      if (providerFailed)
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
        this.options.limits.receiptWaitSeconds * 1000,
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
      deliveryDeadline.cancel();
      closeDeadline?.cancel();
      unsubscribe();
      rpc.close();
    }
  }
}
