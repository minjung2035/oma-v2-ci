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
import { assertExtensionIntegrity, verifiedPaths, type VerifiedExtension } from "./extension-integrity.js";
import { PI_AGENT_DIR_ENV } from "./pi-runtime.js";
import { PiRpcClient, type PiEvent } from "./pi-rpc.js";
import { RESIDENT_INFERENCE_PORT, RESIDENT_PATHS, confinedPath, residentArgv, type ResidentDirectories, type SandboxHost } from "../sandbox.js";
import type { ValidatedRunLease } from "../protocol/run-lease.js";

/** Everything the adapter needs to run the engine inside the Resident sandbox.
 * Its absence is the unconfined profile, which the runner states explicitly. */
export interface PiConfinement {
  /** `libdir` is a host path; `node` and `pi` are paths inside the sandbox. */
  readonly host: SandboxHost;
  readonly lease: ValidatedRunLease;
  /** Host mount roots, checked against the actor's trusted roots by the builder. */
  readonly directories: ResidentDirectories;
  /** INF-005/006: the relay's host socket and the provider it stands in for.
   * Absent means the confined engine has no provider path at all, which is a
   * runnable state — the Resident simply cannot infer — and not a silent one. */
  readonly inference?: { readonly socketHostPath: string; readonly provider: string } | undefined;
}

export interface PiAdapterProfile {
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly workspaceBytes: number;
  /** Recorded at configuration load and re-verified immediately before spawn.
   * The digest travels with the path so the check cannot be skipped here. */
  readonly extensions: readonly VerifiedExtension[];
  /** TSP-005: the validated projection for this role, or null to show every
   * registered tool. The adapter forwards it; it never computes one. */
  readonly toolSurface?: string | undefined;
}
export interface PiAdapterPaths {
  readonly piCommand: string;
  /** Arguments preceding Pi's own flags, e.g. the vendored bundle entry when
   * the engine is run through Node. Empty for a host-pinned executable. */
  readonly piArgs?: readonly string[] | undefined;
  /** OMA-owned agent directory. Keeps this engine's configuration, extensions
   * and sessions separate from any Pi the user installed. */
  readonly piAgentDir?: string | undefined;
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
  /** When present the engine runs confined. `paths` stays host-side so the file
   * checks and digest verification below still read the real files; the argv
   * and environment handed to the engine are translated through the mount
   * table, so there is one authority for where a file is and one for what the
   * engine is told. */
  readonly confinement?: PiConfinement | undefined;
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
/** Maps a host path to the path the engine is told. Identity when the engine
 * runs on the host; the mount translation when it runs confined. */
type PathView = (hostPath: string) => string;

function pathView(options: PiAdapterOptions): PathView {
  const confinement = options.confinement;
  if (confinement === undefined) return path => path;
  return path =>
    // The lease socket is bind-mounted at a fixed path rather than under one of
    // the directory roots, so it is the one entry the table cannot resolve.
    path === confinement.lease.socketHostPath
      ? RESIDENT_PATHS.socket
      : confinedPath(confinement.host.libdir, confinement.directories, path);
}

/** The entries the trusted core extension reads. Nothing else is OMA's to set. */
function omaEnvironment(options: PiAdapterOptions, inside: PathView): Record<string, string> {
  return {
    OMA_ACTOR: options.actor,
    OMA_SOCIETY: options.society,
    OMA_SOCKET: inside(options.paths.socket),
    OMA_BATCH_VIEW: inside(options.paths.batchView),
    OMA_FRAME_BYTES: String(options.limits.frameBytes),
    OMA_BATCH_MAX_MESSAGES: String(options.limits.batchMaxMessages),
    OMA_MAIL_BYTES: String(options.limits.mailBodyBytes),
    OMA_WORKSPACE_BYTES: String(options.profile.workspaceBytes),
    OMA_MAIL_ARCHIVE: inside(options.paths.mailArchive),
    OMA_AGENT_HOME: inside(options.paths.agentHome),
    OMA_CLI_PATH: inside(options.paths.cli),
    ...(options.profile.toolSurface === undefined
      ? {}
      : { OMA_TOOL_SURFACE: options.profile.toolSurface }),
  };
}

/** Environment for an engine spawned directly on the host. The confined spawn
 * does not use this: `--clearenv` means its environment is its argv. */
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
  return Object.assign(env, omaEnvironment(options, path => path), {
    ...(options.paths.piAgentDir === undefined ? {} : { [PI_AGENT_DIR_ENV]: options.paths.piAgentDir }),
  });
}
function argv(options: PiAdapterOptions, inside: PathView = path => path): string[] {
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
    inside(options.paths.sessionDir),
    "--name",
    `oma-${options.society}-${options.actor}`,
    "-e",
    inside(options.paths.coreExtension),
  ];
  // The core extension is already first; the recorded list may also contain it
  // so that its digest is verified, but it is never passed twice. Comparison is
  // on the host path, before translation, because that is what was verified.
  for (const extension of verifiedPaths(options.profile.extensions))
    if (extension !== options.paths.coreExtension) args.push("-e", inside(extension));
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
  spawnPlan(): { command: string; args: string[]; cwd: string; env: Record<string, string> } {
    const confinement = this.options.confinement;
    if (confinement === undefined)
      return {
        command: this.options.paths.piCommand,
        args: [...(this.options.paths.piArgs ?? []), ...argv(this.options)],
        cwd: this.options.paths.workspace,
        env: childEnvironment(this.options),
      };
    const inside = pathView(this.options);
    // `residentArgv` appends `node pi <piModeArgs>` itself, so the engine flags
    // travel as the host's Pi arguments and the entry is `host.pi`.
    const host = { ...confinement.host, piModeArgs: argv(this.options, inside) };
    // The engine's own agent directory holds provider credentials, so PR-004
    // keeps it out of this mount plan (INF-007). The engine reaches a provider
    // through the relay socket instead, and the credential stays on the host.
    const relay = confinement.inference;
    const environment = {
      ...omaEnvironment(this.options, inside),
      ...(relay === undefined ? {} : {
        OMA_INFERENCE_SOCKET: RESIDENT_PATHS.inference,
        OMA_INFERENCE_PROVIDER: relay.provider,
        OMA_INFERENCE_PORT: String(RESIDENT_INFERENCE_PORT),
      }),
    };
    const plan = residentArgv(host, confinement.lease, confinement.directories,
      environment, relay?.socketHostPath);
    return { command: plan[0]!, args: plan.slice(1), cwd: this.options.paths.workspace, env: {} };
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
