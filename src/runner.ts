// MUST [RUN-001]/[BATCH-001]/[ORDER-003]: trusted runner opens a fenced run and
// persists the batch handoff. S-03 is OPEN, so production does not invoke Pi or
// claim a trusted session boundary yet.
import { join } from "node:path";
import { connect } from "node:net";
import type { PreparedBatch } from "../implementation/contracts.js";
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

export class BrokerChannel {
  private parser = new FrameParser(256 * 1024);
  private buf = Buffer.alloc(0);
  private pending = new Map<
    string,
    { resolve: (r: RpcReply) => void; reject: (e: unknown) => void }
  >();
  private sock: ReturnType<typeof connect> | null = null;

  connect(adminPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect(adminPath, () => resolve());
      sock.on("error", reject);
      sock.on("data", (d) => this.onData(Buffer.from(d)));
      this.sock = sock;
    });
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let frames: { raw: unknown }[];
    try {
      frames = this.parser.feed(this.buf);
      this.buf = this.buf.subarray(0, 0);
    } catch {
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
    const id = `${method}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock!.write(encodeFrame({ v: 1, id, method, params }));
    });
  }

  close(): void {
    this.sock?.destroy();
  }
}

export class RunnerModule {
  private channel = new BrokerChannel();

  constructor(
    private readonly paths: RunnerPaths,
    private readonly agent: string,
  ) {}

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
    await this.open();
    try {
      await this.prepareBatch();
      return 0;
    } finally {
      this.channel.close();
    }
  }
}
