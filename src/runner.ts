// MUST [RUN-001]/[BATCH-001]/[ORDER-003]: trusted runner opens a fenced run and
// persists the batch handoff. S-03 is OPEN, so production does not invoke Pi or
// claim a trusted session boundary yet.
import { join } from "node:path";
import { connect } from "node:net";
import type { PreparedBatch, ProtocolLimits } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { FrameParser, encodeFrame } from "./frame.js";

export interface RunnerPaths {
  runRoot: string;
}

interface RpcReply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

type ChannelLimits = Pick<ProtocolLimits, "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds">;

export class BrokerChannel {
  private parser: FrameParser;

  constructor(private readonly limits: ChannelLimits = { frameBytes: 256 * 1024, idleStreamSeconds: 30, receiptWaitSeconds: 30 }) {
    this.parser = new FrameParser(limits.frameBytes);
  }
  private pending = new Map<
    string,
    { resolve: (r: RpcReply) => void; reject: (e: unknown) => void }
  >();
  private sock: ReturnType<typeof connect> | null = null;

  connect(adminPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(adminPath, () => resolve());
      sock.on("error", (error) => { reject(error); this.fail(error); });
      sock.on("close", () => {
        const error = new StoreError("BROKER_UNAVAILABLE", "broker channel closed");
        reject(error);
        this.fail(error);
      });
      sock.setTimeout(this.limits.idleStreamSeconds * 1000, () => this.fail(new StoreError("BROKER_UNAVAILABLE", "broker channel timed out")));
      sock.on("data", (d) => this.onData(Buffer.from(d)));
      this.sock = sock;
    });
  }

  private onData(chunk: Buffer): void {
    let frames: { raw: unknown }[];
    try {
      frames = this.parser.feed(chunk);
    } catch (error) {
      this.fail(error);
      return;
    }
    for (const f of frames) {
      const raw = f.raw as Record<string, unknown>;
      const id = typeof raw.id === "string" ? raw.id : "";
      const p = this.pending.get(id);
      if (!p) continue;
      this.pending.delete(id);
      if (raw.ok === true) {
        const reply: RpcReply = { ok: true };
        if (raw.result !== undefined) reply.result = raw.result;
        p.resolve(reply);
        continue;
      }
      const reply: RpcReply = { ok: false };
      const err = raw.error as { code: string; message: string } | undefined;
      if (
        err &&
        typeof err.code === "string" &&
        typeof err.message === "string"
      ) {
        reply.error = { code: err.code, message: err.message };
      }
      p.resolve(reply);
    }
  }

  call(method: string, params: Record<string, unknown>): Promise<RpcReply> {
    if (!this.sock || this.sock.destroyed)
      return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "broker channel is not connected"));
    const id = `${method}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const frame = encodeFrame({ v: 1, id, method, params });
      if (frame.length - 4 > this.limits.frameBytes)
        throw new StoreError("FRAME_TOO_LARGE", "broker request exceeds frame limit");
      const timer = setTimeout(() => this.fail(new StoreError("BROKER_UNAVAILABLE", "broker receipt timed out")), this.limits.receiptWaitSeconds * 1000);
      this.pending.set(id, {
        resolve: (reply) => { clearTimeout(timer); resolve(reply); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.sock!.write(frame);
    });
  }

  close(): void {
    this.fail(new StoreError("BROKER_UNAVAILABLE", "broker channel closed"));
  }

  private fail(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.sock?.destroy();
    this.sock = null;
  }
}

export class RunnerModule {
  private channel: BrokerChannel;

  constructor(
    private readonly paths: RunnerPaths,
    private readonly agent: string,
    limits?: ChannelLimits,
  ) { this.channel = new BrokerChannel(limits); }

  stop(): Promise<void> {
    this.channel.close();
    return Promise.resolve();
  }

  private async open(): Promise<void> {
    await this.channel.connect(join(this.paths.runRoot, "admin.sock"));
    const response = await this.channel.call("runner.open", {
      agent: this.agent,
      invocationId: process.env.INVOCATION_ID ?? "",
    });
    if (!response.ok || !response.result)
      throw new StoreError(
        (response.error?.code as never) ?? "BROKER_UNAVAILABLE",
        response.error?.message ?? "runner.open failed",
      );
  }

  private async prepareBatch(): Promise<PreparedBatch | null> {
    const response = await this.channel.call("batch.prepare", {});
    if (!response.ok)
      throw new StoreError(
        (response.error?.code as never) ?? "BROKER_UNAVAILABLE",
        response.error?.message ?? "batch.prepare failed",
      );
    return (response.result ?? null) as PreparedBatch | null;
  }

  /** S-03 remains OPEN: persist the batch handoff, but do not invoke Pi or present it. */
  async run(): Promise<0> {
    try {
      await this.open();
      const batch = await this.prepareBatch();
      if (batch) throw new StoreError("SPIKE_UNRESOLVED", "S-03 consumption adapter is unverified; prepared batch retained");
      return 0;
    } finally {
      this.channel.close();
    }
  }
}
