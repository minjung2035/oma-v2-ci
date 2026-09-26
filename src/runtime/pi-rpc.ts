// Gated Pi RPC transport. This helper neither starts Runner consumption nor proves S-03.
import type { ChildProcessWithoutNullStreams } from "../process/async.js";
import { performance } from "node:perf_hooks";
import type { ProtocolLimits } from "../../implementation/contracts.js";
import { StoreError } from "../domain/errors.js";
import { JsonlReader, type PiEvent } from "../protocol/jsonl.js";
export type { PiEvent } from "../protocol/jsonl.js";
export type PiRpcLimits = Pick<
  ProtocolLimits,
  "frameBytes" | "idleStreamSeconds" | "receiptWaitSeconds"
>;
export interface Timer {
  cancel(): void;
}
/** WP10.02: the one deadline primitive. Measured on the monotonic clock and
 * re-armed in native-sized steps, so a budget longer than the platform timer
 * limit neither fires early nor overflows. Cancel is final. */
export function alarm(seconds: number, action: () => void): Timer {
  const deadline = performance.now() + seconds * 1000;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (): void => {
    if (!active) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      active = false;
      action();
      return;
    }
    timer = setTimeout(tick, Math.max(1, Math.min(0x7fffffff, remaining)));
  };
  tick();
  return {
    cancel() {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
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

export class PiRpcClient {
  private readonly reader: JsonlReader;
  private readonly limits: Readonly<PiRpcLimits>;
  private readonly observers = new Set<(event: PiEvent) => void>();
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
    readonly child: ChildProcessWithoutNullStreams,
    limits: PiRpcLimits,
  ) {
    if (
      !limits ||
      [
        limits.frameBytes,
        limits.idleStreamSeconds,
        limits.receiptWaitSeconds,
      ].some((value) => !Number.isSafeInteger(value) || value <= 0)
    )
      throw new StoreError(
        "UNSUPPORTED_PROFILE",
        "Pi transport requires explicit positive channel limits",
      );
    this.limits = Object.freeze({ ...limits });
    this.reader = new JsonlReader(limits.frameBytes);
    this.completion = new Promise((resolve) => {
      this.endTransport = resolve;
    });
    // P0V-27, P0-4: first, so a child that could not be started cannot end
    // this process with an unhandled `error` while the rest is attached.
    child.once("error", this.onError);
    child.stdout.on("data", this.onData);
    child.stdout.once("end", this.onEnd);
    child.stdout.on("error", this.onError);
    child.stderr.on("data", this.onStderr);
    child.stderr.on("error", this.onError);
    child.stdin.on("error", this.onError);
    child.stdin.on("drain", this.onDrain);
    child.once("close", this.onChildClose);
  }
  get diagnosticMetadata(): Readonly<{ stderrBytes: number }> {
    return { stderrBytes: this.stderrCount };
  }
  onEvent(observer: (event: PiEvent) => void): () => void {
    if (this.state !== "open")
      throw new StoreError("BROKER_UNAVAILABLE", "Pi transport is closed");
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }
  private readonly onData = (data: Buffer | string): void => {
    if (this.state !== "open") return;
    if (!Buffer.isBuffer(data)) {
      this.terminate(
        new StoreError("INVALID_REQUEST", "Pi stdout must remain in byte mode"),
      );
      return;
    }
    try {
      this.reader.feed(data, (event) => {
        for (const observer of [...this.observers]) {
          if (this.state !== "open") break;
          if (this.observers.has(observer)) observer(event);
        }
      });
      if (this.state !== "open") return;
      if (this.reader.pendingBytes === 0) {
        this.partialLineTimer?.cancel();
        this.partialLineTimer = null;
      } else if (this.partialLineTimer === null) {
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
  send(object: Record<string, unknown>): Promise<void> {
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
      const value = JSON.stringify(object);
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
        const accepted = this.child.stdin.write(`${text}\n`, (error) => {
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
    child.stdout.off("data", this.onData);
    child.stdout.off("end", this.onEnd);
    child.stdout.off("error", this.onError);
    child.stderr.off("data", this.onStderr);
    child.stderr.off("error", this.onError);
    child.stdin.off("error", this.onError);
    child.stdin.off("drain", this.onDrain);
    child.off("error", this.onError);
    child.off("close", this.onChildClose);
    // Late OS stream errors are absorbed after ownership is released, not emitted
    // as unhandled EventEmitter errors or delivered to stale observers.
    const ignore = (): void => {};
    child.on("error", ignore);
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on("error", ignore);
      stream.destroy();
    }
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* only this owned child */
      }
    }
    this.endTransport(
      error === undefined ? { state: "closed" } : { state: "failed", error },
    );
  }
}
