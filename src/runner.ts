// RUN-001/BATCH-001: runner policy is separate from transport mechanics.
// A prepared batch remains durable until a pinned Pi boundary receipt completes it.
import { join } from "node:path";
import type {
  ModelProfile,
  PreparedBatch,
  ProtocolLimits,
} from "../implementation/contracts.js";
import { dirname } from "node:path";
import { confinedPath, type ResidentDirectories } from "./sandbox.js";
import type { PiConfinement, PiInference } from "./runtime/pi-spawn-plan.js";
import { InferenceRelay } from "./runtime/inference-relay.js";
import { EGRESS_SOCKET_ENV, EgressForwarder, requestEgressPlaceholder } from "./runtime/egress-forwarder.js";
import { placeholderFor, resolveEngineAuth } from "./runtime/engine-auth.js";
import { productSurfaceMasks } from "./runtime/resident-rootfs.js";
import { StoreError } from "./domain/errors.js";
import { encodeToolSurfacePlan } from "./domain/tool-surface.js";
import { BrokerChannel, type ChannelLimits } from "./protocol/channel.js";
import {
  deliveryDecision,
  observeDeliveryReceipt,
  PI_ADAPTER_REVISION,
  publishDeliveryReceipt,
  type DeliveryReceipt,
} from "./storage/delivery-receipt.js";
import {
  decodeRunLease,
  type ValidatedRunLease,
} from "./protocol/run-lease.js";
import { PiAdapter } from "./runtime/pi-adapter.js";
import { ensureDurableDirectory } from "./storage/durable-fs.js";
import {
  agentRootPathAt,
  runnerReceiptPathAt,
  runnerSessionDirPathAt,
  runnerViewPathAt,
  workspacePathAt,
  projectGitPathAt, projectMirrorPathAt,
} from "./storage/paths.js";
export { BrokerChannel } from "./protocol/channel.js";
import type { RoleSettings } from "./config/operations.js";
export interface RunnerProfile {
  readonly name: string;
  /** The model profile's name, as a placeholder request names it (DR18). */
  readonly modelProfile?: string;
  readonly model: Readonly<ModelProfile>;
  readonly settings?: RoleSettings;
  readonly workspaceBytes?: number;
}
/** What the deployment declared about confining Residents.
 *
 * Its absence is a decision, not a default: SB-001 wants a trusted rootfs
 * holding pinned tools and empty mount targets, and an installation that has
 * none cannot confine. The runner reports that state rather than letting the
 * engine start on the host unremarked.
 */
export interface RunnerConfinement {
  /** Host path of the trusted rootfs, mounted read-only at `/`. */
  readonly rootfs: string;
  /** Host path of the OMA installation, mounted read-only inside. */
  readonly libdir: string;
  /** DR25: host path of the installed packages, mounted read-only inside. */
  readonly packages?: string | undefined;
  /** Host path of the pinned Node, bound read-only into the sandbox. */
  readonly node: string;
  /** Operating-system paths bound read-only over the rootfs (SB-001). */
  readonly systemBinds: readonly string[];
  readonly tmpBytes: number;
}
export interface RunnerPaths {
  readonly runRoot: string;
  readonly stateRoot?: string;
  readonly society?: string;
  readonly piCommand?: string;
  /** Arguments preceding Pi's own flags, e.g. the vendored bundle entry. */
  readonly piArgs?: readonly string[];
  /** OMA-owned Pi agent directory; keeps the engine off the user's ~/.pi. */
  readonly piAgentDir?: string;
  readonly coreExtension?: string;
  readonly cli?: string;
  /** Absent means Residents run unconfined; see RunnerConfinement. */
  readonly confinement?: RunnerConfinement;
}
export class RunnerModule {
  private readonly channel: BrokerChannel;
  private lease: ValidatedRunLease | null = null;
  private stopped = false;
  constructor(
    private readonly paths: RunnerPaths,
    private readonly agent: string,
    private readonly limits?: ProtocolLimits,
    readonly profile?: RunnerProfile,
  ) {
    this.channel = new BrokerChannel(limits as ChannelLimits | undefined);
  }
  stop(): Promise<void> {
    this.stopped = true;
    this.channel.close();
    this.lease = null;
    return Promise.resolve();
  }
  /** A connection serves the calls made together, not the run: the broker
   * closes one nothing speaks on for idleStreamSeconds, and a delivery takes
   * as long as the model does. What a call may do is the calling unit's
   * (requireRunnerUnit), never the connection's, so a later call dials again. */
  private async connect(): Promise<void> {
    if (this.stopped)
      throw new StoreError("BROKER_UNAVAILABLE", "runner has been stopped");
    await this.channel.connect(join(this.paths.runRoot, "admin.sock"));
  }
  private async open(): Promise<void> {
    await this.connect();
    const response = await this.channel.call("runner.open", {
      agent: this.agent,
      invocationId: process.env.INVOCATION_ID ?? "",
    });
    if (!response.ok)
      throw new StoreError(response.error.code, response.error.message);
    if (this.stopped)
      throw new StoreError(
        "BROKER_UNAVAILABLE",
        "runner stopped before lease delivery",
      );
    this.lease = decodeRunLease(response.result, {
      actor: this.agent,
      runRoot: this.paths.runRoot,
    });
  }
  private async prepareBatch(): Promise<PreparedBatch | null> {
    const response = await this.channel.call("batch.prepare", {});
    if (!response.ok)
      throw new StoreError(response.error.code, response.error.message);
    const batch = response.result;
    if (
      batch &&
      (!this.lease ||
        batch.agent !== this.lease.actor ||
        batch.incarnation !== this.lease.incarnation)
    )
      throw new StoreError(
        "STALE_RUN",
        "prepared batch is not owned by the current runner lease",
      );
    return batch;
  }
  /** INF-005/008: a confined delivery's provider path. The engine resolves the
   * credential from its own agent directory, the relay holds it for this one
   * delivery, and the sandbox is given only a placeholder of the same shape.
   * Unconfined runs need none of this: the engine reads its agent directory
   * directly. */
  private async openRelay(): Promise<{ inference: PiInference; relay: { close(): Promise<void> } } | undefined> {
    if (this.paths.confinement === undefined) return undefined;
    const { piAgentDir } = this.paths;
    if (!this.lease || !this.limits || !this.profile || !piAgentDir)
      throw new StoreError("UNSUPPORTED_PROFILE", "confined inference configuration is incomplete");
    // Beside the lease socket: the same per-incarnation directory, so a stale
    // run's relay cannot be reached by the next incarnation.
    const socketHostPath = join(dirname(this.lease.socketHostPath), "inference.sock");
    if (Buffer.byteLength(socketHostPath) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path exceeds Linux sun_path");
    // DR18 (D-10): in the macOS guest the credential stays on the host; the
    // run asks the guest's egress service for its placeholder and forwards the
    // engine's connections there.
    const egress = process.env[EGRESS_SOCKET_ENV];
    if (egress !== undefined && egress.length > 0) {
      if (!this.paths.society) throw new StoreError("UNSUPPORTED_PROFILE", "confined inference configuration is incomplete");
      const run = { society: this.paths.society, actor: this.lease.actor, incarnation: this.lease.incarnation };
      const issued = await requestEgressPlaceholder({ socket: egress, frameBytes: this.limits.frameBytes, deadlineMs: this.limits.receiptWaitSeconds * 1000 },
        run, this.profile.model.provider, this.profile.model.model, this.profile.model.inferenceTimeoutSeconds);
      const forwarder = await EgressForwarder.listen(socketHostPath, egress,
        { placeholderId: issued.placeholderId, ...run, modelProfile: this.profile.modelProfile ?? this.profile.name }, 4);
      return { relay: forwarder, inference: { socketHostPath, provider: issued.provider, model: issued.model, placeholder: issued.placeholder } };
    }
    const auth = await resolveEngineAuth(piAgentDir, this.profile.model.provider, this.profile.model.model);
    const placeholder = placeholderFor(auth.apiKey);
    const relay = await InferenceRelay.open(socketHostPath,
      { origin: auth.origin, headers: auth.headers, substitute: { placeholder, secret: auth.apiKey } },
      { concurrent: 4, timeoutMs: this.profile.model.inferenceTimeoutSeconds * 1000 });
    return { relay, inference: { socketHostPath, provider: auth.provider, model: auth.model, placeholder, thinking: auth.thinking } };
  }
  private adapter(batch: PreparedBatch, inference?: PiInference): PiAdapter {
    const { stateRoot, society, piCommand, piArgs, piAgentDir, coreExtension, cli } = this.paths;
    if (
      !this.lease ||
      !this.limits ||
      !this.profile ||
      !Number.isSafeInteger(this.profile?.workspaceBytes) ||
      (this.profile?.workspaceBytes ?? 0) <= 0 ||
      !stateRoot ||
      !society ||
      !piCommand ||
      !coreExtension ||
      !cli
    )
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "runner Pi adapter configuration is incomplete",
      );
    const root = agentRootPathAt(stateRoot, this.agent);
    const sessionDir = runnerSessionDirPathAt(stateRoot, this.agent);
    ensureDurableDirectory(sessionDir, 0o700);
    // Host mount roots. The builder checks each one against this actor's
    // trusted root, so a mistake here is refused rather than mounted.
    const directories: ResidentDirectories = {
      workspace: workspacePathAt(stateRoot, this.agent),
      home: join(root, "home"),
      archive: join(stateRoot, "mail", "archive"),
      workerArchive: join(stateRoot, "mail", "workers"),
      selfMail: join(stateRoot, "mail", "inboxes", this.agent),
      view: runnerViewPathAt(stateRoot, this.agent),
      world: join(stateRoot, "world"),
      projectGit: projectGitPathAt(stateRoot),
      projectMirror: projectMirrorPathAt(stateRoot),
      sessions: sessionDir,
    };
    const confinement = this.confinement(directories, piArgs, inference);
    return new PiAdapter({
      actor: this.agent,
      society,
      limits: this.limits,
      profile: {
        provider: this.profile.model.provider,
        model: this.profile.model.model,
        inferenceSeconds: this.profile.model.inferenceTimeoutSeconds,
        prompt: this.profile.settings?.prompt ?? "",
        thinking: this.profile.model.thinking ?? inference?.thinking,
        workspaceBytes: this.profile.workspaceBytes!,
        // The recorded {path, sha256} pairs travel intact to the spawn site,
        // including the core extension so its digest is re-checked too.
        extensions: (this.profile.settings?.extensions ?? [])
          .map((extension) => ({ path: extension.path, sha256: extension.sha256 })),
        ...(this.profile.settings?.toolSurface
          ? { toolSurface: encodeToolSurfacePlan(this.profile.settings.toolSurface) }
          : {}),
      },
      paths: {
        piCommand,
        ...(piArgs === undefined ? {} : { piArgs }),
        ...(piAgentDir === undefined ? {} : { piAgentDir }),
        coreExtension,
        cli,
        workspace: workspacePathAt(stateRoot, this.agent),
        sessionDir,
        agentHome: join(root, "home"),
        mailArchive: join(stateRoot, "mail", "archive", "cur"),
        workerArchive: join(stateRoot, "mail", "workers", "cur"),
        projectGit: projectGitPathAt(stateRoot),
        batchView: directories.view,
        socket: this.lease.socketHostPath,
      },
      ...(confinement === undefined ? {} : { confinement }),
    });
  }
  /** Builds the mount plan input, or reports that the deployment declared none.
   * The engine entry is translated here because composition owns where files
   * are; the adapter only decides how the engine is started.
   */
  private confinement(
    directories: ResidentDirectories,
    piArgs: readonly string[] | undefined,
    inference: PiInference | undefined,
  ): PiConfinement | undefined {
    const declared = this.paths.confinement;
    if (declared === undefined || !this.lease || !this.limits) return undefined;
    const entry = piArgs?.[0];
    if (entry === undefined)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "a confined Resident runs the shipped engine entry, and this profile declared none",
      );
    return {
      host: {
        rootfs: declared.rootfs,
        libdir: declared.libdir,
        ...(declared.packages === undefined ? {} : { packages: declared.packages }),
        node: declared.node,
        systemBinds: declared.systemBinds,
        hidden: productSurfaceMasks(declared.libdir),
        pi: confinedPath(declared, directories, entry),
        // The adapter replaces this with the engine flags it composes.
        piModeArgs: [],
        tmpBytes: declared.tmpBytes,
        stateRoot: this.paths.stateRoot!,
        runRoot: this.paths.runRoot,
        limits: this.limits,
      },
      lease: this.lease,
      directories,
      ...(inference === undefined ? {} : { inference }),
    };
  }
  private async consume(batch: PreparedBatch): Promise<void> {
    const stateRoot = this.paths.stateRoot;
    if (!stateRoot || !this.limits)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "runner receipt configuration is incomplete",
      );
    // What the receipt means is the receipt decision's (D01, P0-2); what a
    // runner does with it is its own: present in a fresh engine, or complete.
    const decision = deliveryDecision(observeDeliveryReceipt(
      stateRoot,
      batch,
      this.limits.frameBytes,
    ));
    let receipt: DeliveryReceipt;
    switch (decision.action) {
      case "hold": throw decision.error;
      case "settle": receipt = decision.receipt; break;
      case "present": {
        const opened = await this.openRelay();
        let boundary;
        try { boundary = await this.adapter(batch, opened?.inference).deliver(batch); }
        finally { await opened?.relay.close(); }
        // RUN-003: graceful yield leaves the prepared batch and mail untouched.
        if (boundary === null) return;
        receipt = publishDeliveryReceipt(
          stateRoot,
          batch,
          boundary,
          this.limits.frameBytes,
        );
      }
    }
    await this.connect();
    const response = await this.channel.call("batch.complete", {
      batchId: batch.id,
      incarnation: batch.incarnation,
      sessionPath: receipt.sessionPath,
      adapterRevision: PI_ADAPTER_REVISION,
      receiptPath: runnerReceiptPathAt(stateRoot, this.agent, batch.id),
    });
    if (!response.ok)
      throw new StoreError(response.error.code, response.error.message);
  }
  async run(): Promise<0> {
    try {
      await this.open();
      const batch = await this.prepareBatch();
      if (batch) await this.consume(batch);
      return 0;
    } finally {
      this.channel.close();
      this.lease = null;
    }
  }
}
