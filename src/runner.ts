// MUST [RUN-001..003]/[PI-001..002]/[BATCH-004..005]: trusted runner — one
// sandboxed Pi RPC session connected to the durable mail boundary of a single
// agent. It is NOT a replacement agent runtime: activation, fencing, batch
// recovery, delivery and boundary receipts are all it owns.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";
import type { PreparedBatch, RunLease } from "../implementation/contracts.js";
import { StoreError } from "./store.js";
import { FrameParser, encodeFrame } from "./frame.js";
import { PiRpcClient, spawnSandboxed } from "./rpc-client.js";
import { SandboxModule } from "./sandbox.js";

export interface RunnerPaths {
  runRoot: string; // R (admin.sock lives here)
  stateRoot: string; // S
  society: string;
  extensionArtifact: string; // host path of the trusted pi-extension.js
}

interface RpcReply {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** Minimal trusted channel client to the broker admin socket. */
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
  private lease: RunLease | null = null;

  constructor(
    private readonly paths: RunnerPaths,
    private readonly sandbox: SandboxModule,
    private readonly agent: string,
    private readonly homeDir: string, // S/agents/<a>/home
    private readonly workspaceDir: string, // S/agents/<a>/workspace
  ) {}

  stop(): Promise<void> {
    this.channel.close();
    return Promise.resolve();
  }

  private async open(): Promise<void> {
    await this.channel.connect(join(this.paths.runRoot, "admin.sock"));
    const r = await this.channel.call("runner.open", { agent: this.agent });
    if (!r.ok || !r.result)
      throw new StoreError(
        (r.error?.code as never) ?? "BROKER_UNAVAILABLE",
        r.error?.message ?? "runner.open failed",
      );
    this.lease = r.result as RunLease;
  }

  private async prepareBatch(): Promise<PreparedBatch | null> {
    const r = await this.channel.call("batch.prepare", {
      agent: this.agent,
      incarnation: this.lease!.incarnation,
    });
    if (!r.ok)
      throw new StoreError(
        (r.error?.code as never) ?? "BROKER_UNAVAILABLE",
        r.error?.message ?? "batch.prepare failed",
      );
    return (r.result ?? null) as PreparedBatch | null;
  }

  private async stageBatch(batchId: string): Promise<void> {
    const r = await this.channel.call("batch.stage", {
      agent: this.agent,
      batchId,
    });
    if (!r.ok)
      throw new StoreError(
        (r.error?.code as never) ?? "BROKER_UNAVAILABLE",
        r.error?.message ?? "batch.stage failed",
      );
  }

  private async completeBatch(
    batch: PreparedBatch,
    receipt: Record<string, unknown>,
  ): Promise<void> {
    const receiptPath = this.writeReceipt(batch.id, receipt);
    const r = await this.channel.call("batch.complete", {
      batchId: batch.id,
      incarnation: batch.incarnation,
      sessionPath: this.sessionPath(),
      adapterRevision: "pi-0.85.1-oma-batch-v1",
      receiptPath,
    });
    if (!r.ok)
      throw new StoreError(
        (r.error?.code as never) ?? "BROKER_UNAVAILABLE",
        r.error?.message ?? "batch.complete failed",
      );
  }

  private sessionPath(): string {
    return join(this.homeDir, "pi-session");
  }

  private writeReceipt(
    batchId: string,
    receipt: Record<string, unknown>,
  ): string {
    const dir = join(
      this.paths.stateRoot,
      "agents",
      this.agent,
      "runner",
      "receipts",
    );
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `${batchId}.json`);
    const fd = openFdSync(p);
    writeFileSync(fd, JSON.stringify(receipt), "utf8");
    fsyncSyncFd(fd);
    return p;
  }

  /**
   * MUST [RUN-001]: activation loop. Returns exit code 0 when drained.
   * Batch completion needs trusted session-boundary evidence (S-03); a Pi turn
   * that ends with provider errors keeps the batch prepared for re-delivery.
   */
  async run(): Promise<0> {
    await this.open();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await this.prepareBatch();
        if (!batch) return 0;
        await this.stageBatch(batch.id);
        const evidence = await this.deliver(batch);
        if (evidence) {
          await this.completeBatch(batch, evidence);
        } else {
          // MUST [BATCH-005]: unconfirmed batch stays prepared under its id;
          // the reconcile timer / path reactor retries later — exiting now
          // avoids a tight re-delivery loop on the same snapshots.
          return 0;
        }
      }
    } finally {
      this.channel.close();
    }
  }

  /** MUST [BATCH-004..005]/[PI-003]: deliver via the trusted extension; never
   * complete on error/abort/timeout or the model's own claims. */
  private async deliver(
    batch: PreparedBatch,
  ): Promise<Record<string, unknown> | null> {
    const argv = this.sandbox.resident(this.lease!, {
      workspace: this.workspaceDir,
      home: this.homeDir,
      archive: join(this.paths.stateRoot, "mail", "archive"),
      selfMail: join(this.paths.stateRoot, "mail", "inboxes", this.agent),
      view: join(this.paths.stateRoot, "agents", this.agent, "runner", "view"),
      world: join(this.paths.stateRoot, "world"),
      projectGit: join(this.paths.stateRoot, "repos", "project.git"),
    }).argv;
    const child = spawnSandboxed(argv, {});
    const pi = new PiRpcClient(child);
    const events: Array<{
      type: string;
      stopReason?: string;
      errorMessage?: string;
      role?: string;
    }> = [];
    pi.onEvent((e) => {
      events.push(
        e as {
          type: string;
          stopReason?: string;
          errorMessage?: string;
          role?: string;
        },
      );
    });
    try {
      pi.send({
        id: "oma-deliver",
        type: "prompt",
        message: `/oma-deliver ${batch.id}`,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new StoreError("DEADLINE_EXCEEDED", "delivery timed out")),
          300000,
        );
        pi.onEvent((e) => {
          if (e.type === "agent_settled") {
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("error", reject);
      });
      pi.close();
      await new Promise<void>((resolve) => child.on("exit", () => resolve()));
    } catch (e) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
      throw e;
    }
    // boundary evidence: turns after our custom message must not have failed
    const lastEnd = [...events].reverse().find((e) => e.type === "message_end");
    const failed = events.some(
      (e) => e.type === "message_end" && e.stopReason === "error",
    );
    if (!lastEnd || failed) {
      return null; // unconfirmed: same batch id will be re-delivered
    }
    return {
      batchId: batch.id,
      agent: this.agent,
      incarnation: batch.incarnation,
      sessionPath: this.sessionPath(),
      adapterRevision: "pi-0.85.1-oma-batch-v1",
      deliveredCustom: events.filter(
        (e) => e.type === "message_start" && e.role === "custom",
      ).length,
      observedEvents: events.map((e) => e.type),
    };
  }
}

function openFdSync(p: string): number {
  const { openSync } = require("node:fs") as typeof import("node:fs");
  return openSync(p, "w", 0o600);
}

function fsyncSyncFd(fd: number): void {
  const { fsyncSync, closeSync } =
    require("node:fs") as typeof import("node:fs");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
