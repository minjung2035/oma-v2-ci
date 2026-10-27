// Gated Pi RPC transport. This helper neither starts Runner consumption nor proves S-03.
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ProtocolLimits } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { JsonlReader } from "@oma/protocol/jsonl";
import { alarm, type Timer } from "@oma/protocol/alarm";
import type { PiInboundEvent, RpcCommand } from "./pi-compat/wire.js";
export type { PiEvent } from "@oma/protocol/jsonl";
export type { PiInboundEvent } from "./pi-compat/wire.js";
export type PiRpcLimits = Pick<
  ProtocolLimits,
  "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds"
>;
export function assertPiRpcLimits(limits: PiRpcLimits): void {
  if (!limits || [limits.frameBytes, limits.idleStreamSeconds, limits.receiptWaitSeconds]
    .some(value => !Number.isSafeInteger(value) || value <= 0))
    throw new StoreError("UNSUPPORTED_PROFILE", "Pi transport requires explicit positive channel limits");
}
/** DR15: the event a PiRpcClient's observers receive in place of an engine
 * event whose line was larger than the frame. `bytes` is the line's size. */
export const SKIPPED_EVENT = "oma_event_skipped";
/** The reader's own injected marker -- the only non-wire value observers see. */
export type OmaSkippedEvent = { readonly type: typeof SKIPPED_EVENT; readonly bytes: number };
/** What `onEvent` delivers: the engine's wire union (pi-compat/wire.ts) plus
 * the reader's own frame-overflow marker. A2's `RpcResponse |
 * JsonAgentSessionEvent` is what the engine emits; `extension_ui_request` is
 * part of that wire and OMA's boundary rides on it. */
export type PiObservedEvent = PiInboundEvent | OmaSkippedEvent;
// B5: the deadline primitive lives with the framed transport it bounds.
export { alarm, type Timer } from "@oma/protocol/alarm";
interface PendingWrite {
  callbackDone: boolean;
  drained: boolean;
  timer: Timer;
  resolve(): void;
  reject(error: unknown): void;
}
export type PiTransportEnd =
  | { readonly state: "closed" }
  | { readonly state: "failed"; readonly error: unknown };

/** D06/WP09: a command refused before any byte reached the engine. Every
 * other rejection of `send` happens after the write began and terminates the
 * transport, so whether the engine read the command is unknown. */
const UNWRITTEN = new WeakSet<object>();
function unwritten<T extends object>(error: T): T { UNWRITTEN.add(error); return error; }
export function commandWasNotWritten(error: unknown): boolean {
  return typeof error === "object" && error !== null && UNWRITTEN.has(error);
}

export interface PiRpcStreams {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
}

export class PiRpcClient {
  private readonly streams: PiRpcStreams;
  private readonly reader: JsonlReader;
  private readonly limits: Readonly<PiRpcLimits>;
  private readonly observers = new Set<(event: PiObservedEvent) => void>();
  private state: "open" | "closed" = "open";
  private partialLineTimer: Timer | null = null;
  private pending: PendingWrite | null = null;
  private stderrCount = 0;
  private endTransport!: (result: PiTransportEnd) => void;
  readonly completion: Promise<PiTransportEnd>;

  /** Caller must supply already reviewed host limits. There is no new unlimited
   * Pi budget or silent fallback profile. There is one pending stdin write and
   * zero queued parsed events; observers are synchronous and may unsubscribe.
   */
  constructor(
    readonly child: ChildProcess,
    limits: PiRpcLimits,
    streams?: PiRpcStreams,
    private readonly stopChild?: () => void,
  ) {
    if (!streams && (!child.stdin || !child.stdout || !child.stderr))
      throw new StoreError("UNSUPPORTED_PROFILE", "Pi transport requires explicit streams");
    this.streams = streams ?? child as ChildProcessWithoutNullStreams;
    assertPiRpcLimits(limits);
    this.limits = Object.freeze({ ...limits });
    // DR15: an engine event larger than the frame is skipped whole and
    // reported, as one event, to everyone who reads this engine's events.
    this.reader = new JsonlReader(limits.frameBytes, bytes => { this.dispatch({ type: SKIPPED_EVENT, bytes }); });
    this.completion = new Promise((resolve) => {
      this.endTransport = resolve;
    });
    // P0V-27, P0-4: first, so a child that could not be started cannot end
    // this process with an unhandled `error` while the rest is attached.
    try {
      child.once("error", this.onError);
      this.streams.stdout.on("data", this.onData);
      this.streams.stdout.once("end", this.onEnd);
      this.streams.stdout.on("error", this.onError);
      this.streams.stderr.on("data", this.onStderr);
      this.streams.stderr.on("error", this.onError);
      this.streams.stdin.on("error", this.onError);
      this.streams.stdin.on("drain", this.onDrain);
      child.once("close", this.onChildClose);
    } catch (error) {
      try { this.terminate(error); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Pi transport setup and cleanup failed"); }
      throw error;
    }
  }
  get diagnosticMetadata(): Readonly<{ stderrBytes: number }> {
    return { stderrBytes: this.stderrCount };
  }
  onEvent(observer: (event: PiObservedEvent) => void): () => void {
    if (this.state !== "open")
      throw new StoreError("BROKER_UNAVAILABLE", "Pi transport is closed");
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }
  private readonly dispatch = (event: PiObservedEvent): void => {
    for (const observer of [...this.observers]) {
      if (this.state !== "open") break;
      if (this.observers.has(observer)) observer(event);
    }
  };
  private readonly onData = (data: Buffer | string): void => {
    if (this.state !== "open") return;
    if (!Buffer.isBuffer(data)) {
      this.terminate(
        new StoreError("INVALID_REQUEST", "Pi stdout must remain in byte mode"),
      );
      return;
    }
    try {
      const ended = this.reader.endedLines;
      // The reader's shape check is protocol-only; the wire union is what Pi
      // promises on this channel and each decoder still validates its own
      // fields, so an event that is not what it claims fails at its decoder.
      this.reader.feed(data, event => this.dispatch(event as PiInboundEvent));
      if (this.state !== "open") return;
      // P0V-48, P0-5: the deadline is the partial line's own. A chunk that
      // ended a line ended that line's deadline, even when it went on to start
      // the next; the bytes left over are a new line with a deadline of its own.
      if (this.reader.endedLines !== ended || !this.reader.midLine) {
        this.partialLineTimer?.cancel();
        this.partialLineTimer = null;
      }
      if (this.reader.midLine && this.partialLineTimer === null) {
        // Absolute lifetime of a partial line: dribbling bytes cannot renew it forever.
        this.partialLineTimer = alarm(this.limits.idleStreamSeconds, () =>
          this.terminate(
            new StoreError(
              "DEADLINE_EXCEEDED",
              "Pi JSONL line deadline exceeded",
            ),
          ),
        );
      }
    } catch (error) {
      this.terminate(error);
    }
  };
  private readonly onStderr = (data: Buffer | string): void => {
    // Drain without retaining or copying prompt/provider bytes to public logs.
    const length =
      typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
    this.stderrCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.stderrCount + length,
    );
  };
  private readonly onError = (error: Error): void => this.terminate(error);
  private readonly onEnd = (): void => {
    if (this.state !== "open") return;
    try {
      this.reader.finish();
      this.terminate();
    } catch (error) {
      this.terminate(error);
    }
  };
  private readonly onChildClose = (): void => this.onEnd();
  private readonly onDrain = (): void => {
    if (!this.pending) return;
    this.pending.drained = true;
    this.finishWrite();
  };
  private finishWrite(): void {
    const pending = this.pending;
    if (!pending || !pending.callbackDone || !pending.drained) return;
    this.pending = null;
    pending.timer.cancel();
    pending.resolve();
  }
  send(command: RpcCommand): Promise<void> {
    if (this.state !== "open")
      return Promise.reject(unwritten(
        new StoreError("BROKER_UNAVAILABLE", "Pi transport is closed"),
      ));
    if (this.pending)
      return Promise.reject(unwritten(
        new StoreError("LIMIT_EXCEEDED", "one Pi command may be pending"),
      ));
    let text: string;
    try {
      const value = JSON.stringify(command);
      if (value === undefined) throw new Error("not serializable");
      text = value;
      if (Buffer.byteLength(text) > this.limits.frameBytes)
        return Promise.reject(unwritten(
          new StoreError(
            "FRAME_TOO_LARGE",
            "Pi command exceeds the configured frame bound",
          ),
        ));
    } catch {
      return Promise.reject(unwritten(
        new StoreError(
          "INVALID_REQUEST",
          "Pi command is not serializable JSON",
        ),
      ));
    }
    return new Promise((resolve, reject) => {
      const pending: PendingWrite = {
        callbackDone: false,
        drained: false,
        resolve,
        reject,
        timer: alarm(this.limits.receiptWaitSeconds, () =>
          this.terminate(
            new StoreError(
              "DEADLINE_EXCEEDED",
              "Pi stdin write deadline exceeded",
            ),
          ),
        ),
      };
      this.pending = pending;
      try {
        const accepted = this.streams.stdin.write(`${text}\n`, (error) => {
          if (this.pending !== pending) return;
          if (error) {
            this.terminate(error);
            return;
          }
          pending.callbackDone = true;
          this.finishWrite();
        });
        if (accepted) pending.drained = true;
        this.finishWrite();
      } catch (error) {
        this.terminate(error);
      }
    });
  }
  close(): void {
    this.terminate();
  }
  private terminate(error?: unknown): void {
    if (this.state === "closed") return;
    this.state = "closed";
    this.reader.close();
    this.observers.clear();
    this.partialLineTimer?.cancel();
    this.partialLineTimer = null;
    const pending = this.pending;
    this.pending = null;
    pending?.timer.cancel();
    pending?.reject(
      error ??
        new StoreError(
          "BROKER_UNAVAILABLE",
          "Pi transport closed during write",
        ),
    );
    const child = this.child;
    this.streams.stdout.off("data", this.onData);
    this.streams.stdout.off("end", this.onEnd);
    this.streams.stdout.off("error", this.onError);
    this.streams.stderr.off("data", this.onStderr);
    this.streams.stderr.off("error", this.onError);
    this.streams.stdin.off("error", this.onError);
    this.streams.stdin.off("drain", this.onDrain);
    child.off("error", this.onError);
    child.off("close", this.onChildClose);
    // Late OS stream errors are absorbed after ownership is released, not emitted
    // as unhandled EventEmitter errors or delivered to stale observers.
    const ignore = (): void => {};
    child.on("error", ignore);
    for (const stream of [this.streams.stdin, this.streams.stdout, this.streams.stderr]) {
      stream.on("error", ignore);
      stream.destroy();
    }
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (this.stopChild) this.stopChild();
        else child.kill("SIGKILL");
      } catch {
        /* only this owned child */
      }
    }
    this.endTransport(
      error === undefined ? { state: "closed" } : { state: "failed", error },
    );
  }
}
