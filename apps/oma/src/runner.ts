import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { residentEngineEffects } from "./engine/resident-effects.js";
import type { ResidentEngineEffects } from "@oma/engine/ports";
// RUN-001/BATCH-001: runner policy is separate from transport mechanics.
// A prepared batch remains durable until a pinned Pi boundary receipt completes it.
import { join } from "node:path";
import type { Socket } from "node:net";
import type {
  ModelProfile,
  PreparedBatch,
  ProtocolLimits,
} from "@oma/contracts";
import { dirname } from "node:path";
import { RESIDENT_ENVIRONMENT } from "@oma/domain/resident-paths";
import { type SandboxDirectories as ResidentDirectories } from "@oma/contracts/runtime";
import type { PiConfinement, PiEgress, PiInference } from "@oma/engine/pi-spawn-plan";
import { InferenceRelay } from "./runtime/inference-relay.js";
import { ConnectProxy, makePublicDial, type ConnectDial, type EgressAudit } from "./runtime/connect-proxy.js";
import { placeholderFor, resolveEngineAuth } from "@oma/engine/engine-auth";
import { productSurfaceMasks } from "@oma/storage/installation-surface";
import { packageResourcePaths } from "./runtime/packages/index.js";
import { BrokerChannel, type ChannelLimits } from "@oma/client/channel";
import { createBrokerChannel } from "./runtime/broker-channel.js";
import { deliveryDecision, observeDeliveryReceipt, publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import type { DeliveryReceipt } from "@oma/contracts/runtime";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import {
  decodeRunLease,
  type ValidatedRunLease,
} from "@oma/protocol/run-lease";
import { PiAdapter, type EngineObservation } from "@oma/engine/pi-adapter";
import { ensureOwnedDurableDirectory } from "@oma/storage/durable-fs";
import {
  agentRootPathAt,
  runnerReceiptPathAt,
  runnerSessionDirPathAt,
  runnerViewPathAt,
  workspacePathAt,
  projectGitPathAt, projectMirrorPathAt,
} from "@oma/domain/paths";
export { BrokerChannel } from "@oma/client/channel";
import type { RoleSettings } from "@oma/config/operations";
export interface RunnerProfile {
  readonly name: string;
  /** The model profile's name, as a placeholder request names it (DR18). */
  readonly modelProfile: string;
  readonly model: Readonly<ModelProfile>;
  readonly settings?: RoleSettings;
  /** D23/TSP-005: the deployment's encoded surface plan for this run's
   * engines. Internal OMA policy, never authored configuration: the
   * deployment renders it into this runner's explicit launch environment, the runner
   * entry reads it once at its boundary, and the adapter hands it to the
   * spawn plan -- `--clearenv` makes it the only channel, so nothing ambient
   * or inherited can carry it. */
  readonly toolSurface?: string;

}
/** Common installation supplied to the selected Worker sandbox. Platform
 * composition owns its roots and mechanism; every engine requires confinement.
 * Receipt-only recovery constructs no engine or execution recipe. */
export interface RunnerConfinement {
  /** Host path of the OMA installation, mounted read-only inside. */
  readonly libdir: string;
  /** DR25: host path of the installed packages, mounted read-only inside. */
  readonly packages?: string | undefined;
  /** Host path of the pinned Node, bound read-only into the sandbox. */
  readonly node: string;
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
  /** DR25/C18: the installed-package store's real host root. Confined engines
   * reach it through the mount. Absent means no packages are installed. */
  readonly packages?: string;
  /** Required for engine execution; receipt-only recovery needs no engine. */
  readonly confinement?: RunnerConfinement;
}
export class RunnerModule {
  private readonly channel: BrokerChannel;
  private lease: ValidatedRunLease | null = null;
  private stopped = false;
  /** runner.observe: the latest engine observation not yet acknowledged by
   * the broker. Diagnostics are memory-only on both ends, never authority:
   * a newer one replaces a queued one, one send is ever in flight on the one
   * channel, and a refused or unreachable observation is dropped rather
   * than delivered as a delivery failure. */
  private queuedObservation: EngineObservation | null = null;
  private observationInFlight = false;
  /** DR34: the native CONNECT dial resolves, screens and pins the address. */
  private readonly publicDial = makePublicDial();
  /** The send loop's handle: delivery completion joins it so the last thing
   * the broker hears is the engine's settled state, before batch.complete. */
  private observationFlush: Promise<void> | null = null;
  constructor(
    private readonly paths: RunnerPaths,
    private readonly agent: string,
    private readonly invocationId: string,
    private readonly limits?: ProtocolLimits,
    readonly profile?: RunnerProfile,
    private readonly control?: Socket,
    private readonly engineEffects: ResidentEngineEffects = residentEngineEffects,
  ) {
    if (!/^[0-9a-f]{32}$/.test(invocationId)) throw new TypeError("runner requires an explicit execution identity");
    this.channel = createBrokerChannel(limits as ChannelLimits | undefined);
  }
  stop(): Promise<void> {
    this.stopped = true;
    this.channel.close();
    this.lease = null;
    return Promise.resolve();
  }
  /** A connection serves the calls made together, not the run: the broker
   * closes one nothing speaks on for idleStreamSeconds, and a delivery takes
   * as long as the model does. What a call may do is the calling execution scope's
   * (requireRunnerPeer), never the connection's, so a later call dials again. */
  private async connect(): Promise<void> {
    if (this.stopped)
      throw new StoreError("BROKER_UNAVAILABLE", "runner has been stopped");
    if (this.channel.connected) return;
    if (this.control === undefined || this.control.destroyed)
      throw new StoreError("BROKER_UNAVAILABLE", "runner has no live inherited control channel");
    await this.channel.attach(this.control);
  }
  private async open(): Promise<void> {
    await this.connect();
    const response = await this.channel.call("runner.open", {
      agent: this.agent,
      invocationId: this.invocationId,
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
   * Every Resident reaches its provider through this channel; host credentials
   * never enter a Resident's environment or mounts. */
  private async openRelay(): Promise<{ inference: PiInference; relay: { close(): Promise<void> }; connectDial: ConnectDial }> {
    const { piAgentDir } = this.paths;
    if (!this.lease || !this.limits || !this.profile || !piAgentDir)
      throw new StoreError("UNSUPPORTED_PROFILE", "confined inference configuration is incomplete");
    // Beside the lease socket: the same per-incarnation directory, so a stale
    // run's relay cannot be reached by the next incarnation.
    const socketHostPath = join(dirname(this.lease.socketHostPath), "inference.sock");
    if (Buffer.byteLength(socketHostPath) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "relay socket path exceeds Linux sun_path");
    const auth = await resolveEngineAuth(piAgentDir, this.profile.model.provider, this.profile.model.model);
    const placeholder = placeholderFor(auth.apiKey);
    const relay = await InferenceRelay.open(socketHostPath,
      { origin: auth.origin, headers: auth.headers, substitute: { placeholder, secret: auth.apiKey } },
      { concurrent: 4, timeoutMs: this.profile.model.inferenceTimeoutSeconds * 1000 });
    return { relay, connectDial: this.publicDial, inference: { socketHostPath, provider: auth.provider, model: auth.model, placeholder, thinking: auth.thinking } };
  }

  /** The per-delivery CONNECT proxy opens beside the relay and uses the
   * shared resolved-address screening. Each audit line goes to this runner's
   * stderr, owned by the native diagnostic spool. */
  private async openConnectProxy(connectDial: ConnectDial): Promise<ConnectProxy | null> {
    if (!this.lease) return null;
    const socketHostPath = join(dirname(this.lease.socketHostPath), "egress.sock");
    if (Buffer.byteLength(socketHostPath) > 107)
      throw new StoreError("UNSUPPORTED_PROFILE", "egress proxy socket path exceeds Linux sun_path");
    return ConnectProxy.open({
      socketPath: socketHostPath, actor: this.agent, dial: connectDial,
      audit: (entry: EgressAudit) => {
        console.error(`egress ${entry.actor} CONNECT ${entry.target} ${entry.decision} ${entry.reason}`);
      },
    });
  }
  private adapter(batch: PreparedBatch, inference?: PiInference, egress?: PiEgress): PiAdapter {
    const { stateRoot, society, piCommand, piArgs, piAgentDir, coreExtension, cli } = this.paths;
    if (
      !this.lease ||
      !this.limits ||
      !this.profile ||
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
    // P0-8: the session directory, the Resident's home tails and the mail
    // tree are oma's own under the state root -- each is repaired as it is
    // ensured, so a stray's mode-000 cannot wedge the runner's directories.
    ensureOwnedDurableDirectory(sessionDir, stateRoot, 0o700);
    for (const inside of [RESIDENT_ENVIRONMENT.XDG_DATA_HOME, RESIDENT_ENVIRONMENT.XDG_RUNTIME_DIR, `${RESIDENT_ENVIRONMENT.HOME}/.local/bin`])
      ensureOwnedDurableDirectory(join(root, "home", inside.slice(RESIDENT_ENVIRONMENT.HOME.length + 1)), stateRoot, 0o700);
    // mail-v1: the worker archive is a Resident mount; a society provisioned
    // before it existed gets the directory before any bind can name it.
    ensureOwnedDurableDirectory(join(stateRoot, "mail", "workers"), stateRoot, 0o700);
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
    const confinement = this.confinement(directories, piArgs, inference, egress);
    return new PiAdapter(this.engineEffects, {
      actor: this.agent,
      society,
      limits: this.limits,
      profile: {
        provider: this.profile.model.provider,
        model: this.profile.model.model,
        inferenceSeconds: this.profile.model.inferenceTimeoutSeconds,
        prompt: this.profile.settings?.prompt ?? "",
        thinking: this.profile.model.thinking ?? inference?.thinking,
        // The recorded {path, sha256} pairs travel intact to the spawn site,
        // including the core extension so its digest is re-checked too.
        extensions: (this.profile.settings?.extensions ?? [])
          .map((extension) => ({ path: extension.path, sha256: extension.sha256 })),
        // C18: skills, prompt templates and themes the installed packages
        // provide, as host paths under the store root the plan translates.
        ...(packageResourcePaths(this.paths.packages) === undefined ? {} : { packageResources: packageResourcePaths(this.paths.packages) }),
        // D23/TSP-005: the surface plan is declared profile data, read once
        // from this runner's own unit environment by the entry and carried
        // here -- never through authored configuration, and never re-read
        // from ambient environment at spawn time.
        ...(this.profile.toolSurface === undefined ? {} : { toolSurface: this.profile.toolSurface }),
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
      confinement,
    });
  }
  /** Builds the required mount plan input, refusing an incomplete deployment.
   * The engine entry is translated here because composition owns where files
   * are; the adapter only decides how the engine is started.
   */
  private confinement(
    directories: ResidentDirectories,
    piArgs: readonly string[] | undefined,
    inference: PiInference | undefined,
    egress: PiEgress | undefined,
  ): PiConfinement {
    const declared = this.paths.confinement;
    if (declared === undefined || !this.lease || !this.limits)
      throw new StoreError("UNSUPPORTED_PROFILE", "Resident execution requires confinement and a validated lease");
    const entry = piArgs?.[0];
    if (entry === undefined)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "a confined Resident runs the shipped engine entry, and this profile declared none",
      );
    const host = {
      libdir: declared.libdir,
      ...(declared.packages === undefined ? {} : { packages: declared.packages }),
      node: declared.node,
      hidden: productSurfaceMasks(declared.libdir),
      pi: entry,
      // The adapter replaces this with the engine flags it composes.
      piModeArgs: [],
      stateRoot: this.paths.stateRoot!,
      runRoot: this.paths.runRoot,
      limits: this.limits,
    };
    host.pi = this.engineEffects.sandbox.pathView(host, this.lease, directories, {
      ...(inference === undefined ? {} : { inference: inference.socketHostPath }),
      ...(egress === undefined ? {} : { egress: egress.socketHostPath }),
    }).map(entry);
    return {
      host,
      lease: this.lease,
      directories,
      ...(inference === undefined ? {} : { inference }),
      ...(egress === undefined ? {} : { egress }),
    };
  }
  /** Queues the engine's latest self-report for `runner.observe`. The send
   * loop is serialized on the one channel: while a call is in flight a newer
   * observation replaces the queued one, so the broker's memory-only record
   * converges on the newest report without ever stacking calls. */
  private noteObservation(observation: EngineObservation): void {
    this.queuedObservation = observation;
    if (this.observationInFlight) return;
    this.observationInFlight = true;
    this.observationFlush = (async () => {
      try {
        for (;;) {
          const next = this.queuedObservation;
          if (next === null) return;
          this.queuedObservation = null;
          const params = {
            reason: next.reason,
            ...(next.toolName === undefined ? {} : { toolName: next.toolName }),
            observedAtMs: Date.now(),
          };
          let response;
          try { response = await this.channel.call("runner.observe", params); }
          catch (error) {
            // A channel idle for the delivery's length may have closed; the
            // call's own error is the only signal to dial again, and only an
            // unavailable channel earns a reconnect -- a refused observation
            // is dropped like any other.
            if (errorCodeOf(error) !== "BROKER_UNAVAILABLE") throw error;
            await this.connect();
            response = await this.channel.call("runner.observe", params);
          }
          if (!response.ok)
            throw new StoreError(response.error.code, response.error.message);
        }
      } catch {
        // Diagnostics are not the delivery's authority. A refused or
        // unreachable observation is dropped, and the queue is abandoned
        // rather than replayed on a channel that refused it.
        this.queuedObservation = null;
      } finally {
        this.observationInFlight = false;
      }
    })();
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
        // DR34/UX-08: the CONNECT proxy is the delivery's too -- it opens once
        // the relay path stands, and it closes with it, so a Resident's proxy
        // variables never outlive the run's sockets. A proxy that cannot open
        // returns the relay first; the delivery gets no half-opened provider
        // path it was never told about.
        let proxy: ConnectProxy | null;
        try { proxy = await this.openConnectProxy(opened.connectDial); }
        catch (error) { await opened.relay.close(); throw error; }
        let boundary;
        try {
          boundary = await this.adapter(batch, opened.inference,
            proxy === null ? undefined : { socketHostPath: proxy.socketPath }).deliver(batch, {
            observe: observation => this.noteObservation(observation),
          });
        }
        finally {
          if (proxy !== null) await proxy.close();
          await opened.relay.close();
        }
        // RUN-003: graceful yield leaves the prepared batch and mail untouched.
        // The "waiting" report is the last word the broker should keep.
        if (boundary === null) { await this.observationFlush; return; }
        receipt = publishDeliveryReceipt(
          stateRoot,
          batch,
          boundary,
          this.limits.frameBytes,
        );
      }
    }
    // The delivery's last observation is part of the same picture
    // batch.complete seals; send it first, on its own budget.
    await this.observationFlush;
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
