// RUN-001/BATCH-001: runner policy is separate from transport mechanics.
// A prepared batch remains durable until a pinned Pi boundary receipt completes it.
import { join } from "node:path";
import type {
  ModelProfile,
  PreparedBatch,
  ProtocolLimits,
} from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { BrokerChannel, type ChannelLimits } from "./protocol/channel.js";
import {
  observeDeliveryReceipt,
  PI_ADAPTER_REVISION,
  publishDeliveryReceipt,
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
} from "./storage/paths.js";
export { BrokerChannel } from "./protocol/channel.js";
import type { RoleSettings } from "./config/operations.js";
export interface RunnerProfile {
  readonly name: string;
  readonly model: Readonly<ModelProfile>;
  readonly settings?: RoleSettings;
  readonly workspaceBytes?: number;
}
export interface RunnerPaths {
  readonly runRoot: string;
  readonly stateRoot?: string;
  readonly society?: string;
  readonly piCommand?: string;
  readonly coreExtension?: string;
  readonly cli?: string;
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
  private async open(): Promise<void> {
    if (this.stopped)
      throw new StoreError("BROKER_UNAVAILABLE", "runner has been stopped");
    await this.channel.connect(join(this.paths.runRoot, "admin.sock"));
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
  private adapter(batch: PreparedBatch): PiAdapter {
    const { stateRoot, society, piCommand, coreExtension, cli } = this.paths;
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
    return new PiAdapter({
      actor: this.agent,
      society,
      limits: this.limits,
      profile: {
        provider: this.profile.model.provider,
        model: this.profile.model.model,
        prompt: this.profile.settings?.prompt ?? "",
        workspaceBytes: this.profile.workspaceBytes!,
        extensions: (this.profile.settings?.extensions ?? [])
          .map((extension) => extension.path)
          .filter((extension) => extension !== coreExtension),
      },
      paths: {
        piCommand,
        coreExtension,
        cli,
        workspace: workspacePathAt(stateRoot, this.agent),
        sessionDir,
        agentHome: join(root, "home"),
        mailArchive: join(stateRoot, "mail", "archive", "cur"),
        batchView: runnerViewPathAt(stateRoot, this.agent),
        socket: this.lease.socketHostPath,
      },
    });
  }
  private async consume(batch: PreparedBatch): Promise<void> {
    const stateRoot = this.paths.stateRoot;
    if (!stateRoot || !this.limits)
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "runner receipt configuration is incomplete",
      );
    let receipt = observeDeliveryReceipt(
      stateRoot,
      batch,
      this.limits.frameBytes,
    );
    if (!receipt) {
      const boundary = await this.adapter(batch).deliver(batch);
      receipt = publishDeliveryReceipt(
        stateRoot,
        batch,
        boundary,
        this.limits.frameBytes,
      );
    }
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
