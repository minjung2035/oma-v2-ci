import { spawnOwnedRpc } from "../process/async.js";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type {
  Actor,
  PreparedBatch,
  ProtocolLimits,
} from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import {
  PI_ADAPTER_REVISION,
  PI_BOUNDARY_PREFIX,
  type DeliveryBoundary,
} from "../storage/delivery-receipt.js";
import { PiRpcClient, type PiEvent } from "./pi-rpc.js";

export interface PiAdapterProfile {
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly workspaceBytes: number;
  readonly extensions: readonly string[];
}
export interface PiAdapterPaths {
  readonly piCommand: string;
  readonly coreExtension: string;
  readonly cli: string;
  readonly workspace: string;
  readonly sessionDir: string;
  readonly agentHome: string;
  readonly mailArchive: string;
  readonly batchView: string;
  readonly socket: string;
}
export interface PiAdapterOptions {
  readonly actor: Actor;
  readonly society: string;
  readonly paths: PiAdapterPaths;
  readonly profile: PiAdapterProfile;
  readonly limits: Pick<
    ProtocolLimits,
    | "frameBytes"
    | "idleStreamSeconds"
    | "receiptWaitSeconds"
    | "batchMaxMessages"
    | "mailBodyBytes"
  >;
}
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
function boundaryOf(
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
function childEnvironment(options: PiAdapterOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) env[key] = value;
  for (const key of [
    "PI_SESSION_ID",
    "PI_SESSION_FILE",
    "PI_SESSION_CWD",
    "PI_SESSION_REASON",
  ] as const)
    delete env[key];
  return Object.assign(env, {
    OMA_ACTOR: options.actor,
    OMA_SOCIETY: options.society,
    OMA_SOCKET: options.paths.socket,
    OMA_BATCH_VIEW: options.paths.batchView,
    OMA_FRAME_BYTES: String(options.limits.frameBytes),
    OMA_BATCH_MAX_MESSAGES: String(options.limits.batchMaxMessages),
    OMA_MAIL_BYTES: String(options.limits.mailBodyBytes),
    OMA_WORKSPACE_BYTES: String(options.profile.workspaceBytes),
    OMA_MAIL_ARCHIVE: options.paths.mailArchive,
    OMA_AGENT_HOME: options.paths.agentHome,
    OMA_CLI_PATH: options.paths.cli,
  });
}
function argv(options: PiAdapterOptions): string[] {
  const args = [
    "--mode",
    "rpc",
    "--no-approve",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--no-extensions",
    "--exclude-tools",
    "bash,powershell",
    "--session-dir",
    options.paths.sessionDir,
    "--name",
    `oma-${options.society}-${options.actor}`,
    "-e",
    options.paths.coreExtension,
  ];
  for (const extension of options.profile.extensions)
    args.push("-e", extension);
  if (
    !(options.profile.provider === "pi" && options.profile.model === "current")
  )
    args.push(
      "--model",
      `${options.profile.provider}/${options.profile.model}`,
    );
  if (options.profile.prompt.length > 0)
    args.push("--append-system-prompt", options.profile.prompt);
  return args;
}
export class PiAdapter {
  constructor(private readonly options: PiAdapterOptions) {
    if (!Number.isSafeInteger(options.profile.workspaceBytes) || options.profile.workspaceBytes <= 0)
      throw failure("UNSUPPORTED_PROFILE", "Pi workspace quota is unavailable");
    for (const path of [
      options.paths.piCommand,
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
  async deliver(batch: PreparedBatch): Promise<DeliveryBoundary> {
    if (batch.agent !== this.options.actor)
      throw failure(
        "SESSION_BOUNDARY_UNCONFIRMED",
        "prepared batch belongs to another actor",
      );
    const child = spawnOwnedRpc(
      this.options.paths.piCommand,
      argv(this.options),
      this.options.paths.workspace,
      childEnvironment(this.options),
    );
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
