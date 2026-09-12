// RUN-001/BATCH-001: runner policy is separate from transport mechanics.
// S-03 remains OPEN: a prepared batch is retained, never claimed consumed.
import { join } from "node:path";
import type { PreparedBatch, RunLease } from "../implementation/contracts.js";
import { StoreError } from "./domain/errors.js";
import { BrokerChannel, type ChannelLimits } from "./protocol/channel.js";
// Compatibility export for existing callers. Host imports the neutral owner directly.
export { BrokerChannel } from "./protocol/channel.js";
export interface RunnerPaths { runRoot: string }

export class RunnerModule {
  private readonly channel: BrokerChannel;
  private lease: RunLease | null = null;
  constructor(private readonly paths: RunnerPaths, private readonly agent: string, limits?: ChannelLimits) {
    this.channel = new BrokerChannel(limits);
  }
  stop(): Promise<void> {
    this.channel.close(); this.lease = null;
    return Promise.resolve();
  }
  private async open(): Promise<void> {
    await this.channel.connect(join(this.paths.runRoot, "admin.sock"));
    const response = await this.channel.call("runner.open", { agent: this.agent, invocationId: process.env.INVOCATION_ID ?? "" });
    if (!response.ok) throw new StoreError(response.error.code, response.error.message);
    if (response.result.actor !== this.agent) throw new StoreError("AUTH_FAILED", "runner lease is for another actor");
    this.lease = response.result;
  }
  private async prepareBatch(): Promise<PreparedBatch | null> {
    const response = await this.channel.call("batch.prepare", {});
    if (!response.ok) throw new StoreError(response.error.code, response.error.message);
    const batch = response.result;
    if (batch && (!this.lease || batch.agent !== this.lease.actor || batch.incarnation !== this.lease.incarnation))
      throw new StoreError("STALE_RUN", "prepared batch is not owned by the current runner lease");
    return batch;
  }
  async run(): Promise<0> {
    try {
      await this.open();
      const batch = await this.prepareBatch();
      if (batch) throw new StoreError("SPIKE_UNRESOLVED", "S-03 consumption adapter is unverified; prepared batch retained");
      return 0;
    } finally { this.channel.close(); this.lease = null; }
  }
}
