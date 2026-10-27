// IPC-002/003/005: one in-flight request; accepted workflow artifacts never
// belong to socket cleanup. EOF, close, error and timeout are distinct events.
import { ConnectionDecoder, FrameError, encodeFrame, type DecoderEvent } from "@oma/protocol/frame";
import { AcceptedFailure, StoreError, publicFailure } from "@oma/domain/errors";
import { deadline } from "@oma/process/deadline";
import { type ConnectionSpool, type ExecutionBody, type RawDescriptor } from "@oma/contracts/files";
import type { ConnectionPeerPin } from "./peer-pin.js";
export interface SocketEvents { data: [Buffer]; end: []; close: [boolean]; error: [Error]; drain: [] }
export interface RpcSocket {
  readonly destroyed: boolean;
  on(event: "data", listener: (bytes: Buffer) => void): unknown;
  on(event: "end" | "drain", listener: () => void): unknown;
  on(event: "close", listener: (hadError: boolean) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (bytes: Buffer) => void): unknown;
  off(event: "end" | "drain", listener: () => void): unknown;
  off(event: "close", listener: (hadError: boolean) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  pause(): unknown; resume(): unknown; write(bytes: Uint8Array): boolean;
  end(): unknown;
  end(bytes: Uint8Array): unknown;
  destroy(error?: Error): unknown;
}
export interface Alarm { cancel(): void }
export interface AlarmFactory { after(seconds: number, callback: () => void): Alarm }
/** Rearm long configured deadlines instead of truncating them to Node's timer range. */
export const NODE_ALARMS: AlarmFactory = {
  after(seconds, callback) {
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError("invalid RPC deadline");
    return { cancel: deadline(seconds * 1000, callback) };
  },
};
export interface ConnectionLimits { frameBytes: number; idleStreamSeconds: number; receiptWaitSeconds: number }
export interface RpcConnectionOptions {
  socket: RpcSocket; peer: ConnectionPeerPin; limits: ConnectionLimits;
  handle(raw: Record<string, unknown>, body: AsyncIterable<Uint8Array> | null): Promise<object>;
  /** Synchronous envelope/channel/capability/descriptor checks, before any spool. */
  preflight(raw: Record<string, unknown>): void;
  alarms?: AlarmFactory; makeSpool: (descriptor: RawDescriptor) => ConnectionSpool;
  /** A directly inherited, owner-bounded control channel can stay idle. A
   * partial frame/body and every executing request retain their deadlines. */
  inheritedControl?: boolean;
  onClosed?: () => void; onTask?: (task: Promise<void>) => void; onCleanupError?: (error: unknown) => void;
}
interface ReceiveTimers { idle: Alarm; receipt: Alarm | null }
interface Task { readonly id: string; readonly body: ExecutionBody | null; readonly releasePeer: () => void }
type State =
  | { kind: "idle"; timers: ReceiveTimers; endSeen: boolean }
  | { kind: "receivingStream"; timers: ReceiveTimers; endSeen: boolean; raw: Record<string, unknown>; spool: ConnectionSpool }
  | { kind: "awaitingExcessDecision"; timers: ReceiveTimers; endSeen: boolean; raw: Record<string, unknown>; spool: ConnectionSpool }
  | { kind: "executing"; deadline: Alarm; endSeen: boolean; task: Task; phase: "handling" | "backpressure" }
  | { kind: "closing"; deadline: Alarm }
  | { kind: "closed" };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function requestId(raw: Record<string, unknown>): string { return typeof raw.id === "string" ? raw.id : "x"; }

export class RpcConnection {
  private readonly decoder: ConnectionDecoder;
  private readonly alarms: AlarmFactory;
  private state: State = { kind: "closed" };
  constructor(private readonly options: RpcConnectionOptions) {
    this.alarms = options.alarms ?? NODE_ALARMS;
    this.decoder = new ConnectionDecoder(options.limits.frameBytes, bytes => {
      const state = this.state;
      if (state.kind !== "receivingStream") throw new StoreError("INTERNAL_ERROR", "raw bytes have no receiving owner");
      state.spool.append(bytes);
    });
    this.state = this.idle(false);
    try {
      options.socket.on("data", this.onData); options.socket.on("end", this.onEnd);
      options.socket.on("error", this.onError); options.socket.on("close", this.onClose); options.socket.on("drain", this.onDrain);
    } catch (error) { this.close(); throw error; }
  }
  snapshot(): Readonly<{ phase: State["kind"]; bufferedBytes: number }> { return Object.freeze({ phase: this.state.kind, bufferedBytes: this.decoder.bufferedBytes }); }
  private alarm(seconds: number, error: StoreError): Alarm { return this.alarms.after(seconds, () => this.fatal(error)); }
  private idle(endSeen: boolean): Extract<State, { kind: "idle" }> {
    return { kind: "idle", endSeen, timers: {
      idle: this.options.inheritedControl && this.decoder.bufferedBytes === 0 ? { cancel() {} } :
        this.alarm(this.options.limits.idleStreamSeconds, new StoreError("DEADLINE_EXCEEDED", "idle RPC connection")),
      receipt: this.decoder.bufferedBytes ? this.receiptAlarm() : null,
    } };
  }
  private receiptAlarm(): Alarm { return this.alarm(this.options.limits.receiptWaitSeconds, new StoreError("DEADLINE_EXCEEDED", "RPC receipt deadline exceeded")); }
  private refreshInputTimer(timers: ReceiveTimers): void {
    timers.idle.cancel();
    timers.idle = this.alarm(this.options.limits.idleStreamSeconds, new StoreError("STREAM_INVALID", "incomplete input timed out"));
    timers.receipt ??= this.receiptAlarm();
  }
  private report(error: unknown): void { try { this.options.onCleanupError?.(error); } catch { /* diagnostics cannot prevent cleanup */ } }
  private cleanup(action: () => void): void { try { action(); } catch (error) { this.report(error); } }
  private cancelTimers(state: State): void {
    switch (state.kind) {
      case "idle": case "receivingStream": case "awaitingExcessDecision":
        this.cleanup(() => state.timers.idle.cancel()); this.cleanup(() => state.timers.receipt?.cancel()); return;
      case "executing": case "closing": this.cleanup(() => state.deadline.cancel()); return;
      case "closed": return;
    }
  }
  private disposeConnectionState(state: State): void {
    this.cancelTimers(state);
    if (state.kind === "receivingStream" || state.kind === "awaitingExcessDecision") this.cleanup(() => state.spool.releaseConnection());
    // Executing tasks, not this connection, own their body and peer references.
  }
  close(): void {
    const previous = this.state;
    if (previous.kind === "closed") return;
    this.state = { kind: "closed" };
    this.disposeConnectionState(previous); this.decoder.poison();
    const socket = this.options.socket;
    this.cleanup(() => { socket.off("data", this.onData); socket.off("end", this.onEnd); socket.off("error", this.onError); socket.off("close", this.onClose); socket.off("drain", this.onDrain); });
    this.cleanup(() => this.options.peer.releaseConnection());
    this.cleanup(() => { if (!socket.destroyed) socket.destroy(); });
    this.cleanup(() => this.options.onClosed?.());
  }
  /** Lease revocation uses the same response and ownership rules as transport faults. */
  reject(error: unknown): void { this.fatal(error); }
  private id(): string {
    const state = this.state;
    if (state.kind === "executing") return state.task.id;
    if (state.kind === "receivingStream" || state.kind === "awaitingExcessDecision") return requestId(state.raw);
    return "x";
  }
  private errorFrame(error: unknown, id: string): Buffer {
    const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
    const mapped = code === "ENOSPC" || code === "EDQUOT" ? new StoreError("STORAGE_FULL", "raw transport storage is full") : error;
    const failure = mapped instanceof FrameError ? { code: mapped.code, message: mapped.message, retry: "never" as const } : publicFailure(mapped);
    return encodeFrame({ v: 1, id, ok: false, error: failure });
  }
  private fatal(error: unknown, id = this.id()): void {
    const previous = this.state;
    if (previous.kind === "closed" || previous.kind === "closing") return;
    if (previous.kind === "executing" && previous.phase === "backpressure") { this.close(); return; }
    this.disposeConnectionState(previous); this.decoder.poison();
    try {
      this.state = { kind: "closing", deadline: this.alarms.after(this.options.limits.idleStreamSeconds, () => this.close()) };
      this.options.socket.pause();
      const frame = this.errorFrame(error, id);
      if (frame.length > Math.min(this.options.limits.frameBytes, 0xffffffff) + 4) { this.close(); return; }
      this.options.socket.end(frame);
    } catch { this.close(); }
  }
  private gracefulEnd(): void {
    const previous = this.state;
    if (previous.kind === "closed" || previous.kind === "closing") return;
    this.disposeConnectionState(previous); this.decoder.poison();
    try {
      this.state = { kind: "closing", deadline: this.alarms.after(this.options.limits.idleStreamSeconds, () => this.close()) };
      this.options.socket.end();
    } catch { this.close(); }
  }
  private readonly onData = (chunk: Buffer): void => {
    const state = this.state;
    if (state.kind === "closed" || state.kind === "closing") return;
    try {
      if (!Buffer.isBuffer(chunk)) throw new FrameError("INVALID_REQUEST", "RPC input must be bytes");
      if (state.kind === "executing") { this.events(this.decoder.bufferControl(chunk)); return; }
      this.refreshInputTimer(state.timers);
      if (state.kind === "awaitingExcessDecision") { this.events(this.decoder.bufferControl(chunk)); this.decideExcess(); }
      else this.events(this.decoder.push(chunk));
    } catch (error) { this.fatal(error); }
  };
  private readonly onEnd = (): void => {
    const state = this.state;
    switch (state.kind) {
      case "closed": case "closing": return;
      case "executing": state.endSeen = true; return;
      case "receivingStream": this.fatal(new StoreError("STREAM_INVALID", "EOF before declared raw bytes")); return;
      case "awaitingExcessDecision": this.fatal(new StoreError("STREAM_INVALID", "EOF during excess-byte decision")); return;
      case "idle":
        state.endSeen = true;
        if (this.decoder.bufferedBytes) this.fatal(new FrameError("INVALID_REQUEST", "EOF inside frame header or body"));
        else this.gracefulEnd();
    }
  };
  private readonly onError = (_error: Error): void => { this.close(); };
  private readonly onClose = (_hadError: boolean): void => { this.close(); };
  private readonly onDrain = (): void => {
    try { const state = this.state; if (state.kind === "executing" && state.phase === "backpressure") this.finishWrite(state.task); }
    catch (error) { this.fatal(error); }
  };
  private descriptor(raw: Record<string, unknown>): RawDescriptor | null {
    const params = record(raw.params) ? raw.params : null;
    const value = params?.bundle ?? params?.content;
    if (value === undefined || value === null) return null;
    this.options.preflight(raw);
    if (!record(value) || typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new StoreError("STREAM_INVALID", "invalid raw stream descriptor");
    return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
  }
  private events(events: readonly DecoderEvent[]): void {
    for (const event of events) {
      const state = this.state;
      if (state.kind === "closed" || state.kind === "closing") return;
      if (event.kind === "invalid") { this.fatal(new FrameError(event.code, event.message)); return; }
      if (event.kind === "frame") {
        if (state.kind !== "idle" || !record(event.frame.raw)) throw new FrameError("INVALID_REQUEST", "unexpected control frame state");
        const raw = event.frame.raw;
        let descriptor: RawDescriptor | null;
        try { descriptor = this.descriptor(raw); } catch (error) { this.fatal(error, requestId(raw)); return; }
        if (descriptor === null) { this.decoder.requireControlBudget(); this.dispatch(raw, null, state); return; }
        this.receiveStream(raw, descriptor, state);
        return;
      }
      if (state.kind !== "receivingStream") throw new FrameError("INVALID_REQUEST", "raw completion has no spool owner");
      state.spool.seal();
      this.state = { kind: "awaitingExcessDecision", raw: state.raw, spool: state.spool, timers: state.timers, endSeen: state.endSeen };
      this.decideExcess();
    }
  }
  private receiveStream(raw: Record<string, unknown>, descriptor: RawDescriptor,
    previous: Extract<State, { kind: "idle" }>): void {
    const spool = this.options.makeSpool(descriptor);
    this.state = { kind: "receivingStream", raw, spool, timers: previous.timers, endSeen: previous.endSeen };
    this.events(this.decoder.beginStream(descriptor.bytes));
    if (previous.endSeen && this.state.kind === "receivingStream")
      this.fatal(new StoreError("STREAM_INVALID", "EOF before declared raw bytes"));
  }
  private decideExcess(): void {
    const state = this.state;
    if (state.kind !== "awaitingExcessDecision") return;
    const status = this.decoder.excessStatus();
    if (status === "pending") { this.decoder.requireControlBudget(); return; }
    if (status === "excess") { this.fatal(new StoreError("STREAM_INVALID", "raw stream has invalid trailing bytes")); return; }
    this.decoder.requireControlBudget(); this.dispatch(state.raw, state.spool, state);
  }
  private dispatch(raw: Record<string, unknown>, spool: ConnectionSpool | null, previous: Extract<State, { kind: "idle" | "awaitingExcessDecision" }>): void {
    // All fallible transport setup precedes ownership transfer. The receive
    // state retains both timers if pause/retain/handoff fails.
    previous.timers.receipt ??= this.receiptAlarm();
    previous.timers.idle.cancel(); this.options.socket.pause();
    const releasePeer = this.options.peer.retainForExecution();
    let body: ExecutionBody | null = null;
    try { body = spool?.handoff() ?? null; } catch (error) { this.cleanup(releasePeer); throw error; }
    const task: Task = { id: requestId(raw), body, releasePeer };
    this.state = { kind: "executing", task, deadline: previous.timers.receipt, endSeen: previous.endSeen, phase: "handling" };
    let result: Promise<object>;
    try { result = Promise.resolve(this.options.handle(raw, body?.chunks ?? null)); } catch (error) { result = Promise.reject(error); }
    const promise = result.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error: error as unknown })).then(outcome => {
      this.cleanup(() => body?.release()); this.cleanup(releasePeer);
      const current = this.state;
      if (current.kind !== "executing" || current.task !== task) return;
      if (!outcome.ok) { this.fatal(outcome.error, task.id); return; }
      try {
        const frame = encodeFrame(outcome.value);
        // P0V-123 (G03-broker-01, r2-02), P0-5: the request was handled before
        // its answer was found too large to send, and this connection cannot
        // know whether that committed an effect. It is not refused as input
        // ("never"): its outcome is unknown, asked again under the same key.
        if (frame.length > Math.min(this.options.limits.frameBytes, 0xffffffff) + 4)
          throw new AcceptedFailure("FRAME_TOO_LARGE", "the RPC response exceeds the configured frame budget; the request was handled", "possible");
        if (this.options.socket.destroyed) { this.close(); return; }
        if (this.options.socket.write(frame)) this.finishWrite(task); else current.phase = "backpressure";
      } catch (error) { this.fatal(error, task.id); }
    }).catch(error => { this.cleanup(() => body?.release()); this.cleanup(releasePeer); this.fatal(error, task.id); });
    try { this.options.onTask?.(promise); } catch (error) { this.report(error); }
  }
  private finishWrite(task: Task): void {
    const state = this.state;
    if (state.kind !== "executing" || state.task !== task) return;
    state.deadline.cancel(); this.state = this.idle(state.endSeen);
    try {
      this.events(this.decoder.resumeParsing());
      const current = this.state;
      if (current.kind === "idle") {
        if (current.endSeen) {
          if (this.decoder.bufferedBytes) this.fatal(new FrameError("INVALID_REQUEST", "EOF inside queued frame")); else this.gracefulEnd();
        } else this.options.socket.resume();
      } else if (current.kind === "receivingStream" || current.kind === "awaitingExcessDecision") {
        if (current.endSeen) this.onEnd(); else this.options.socket.resume();
      }
    } catch (error) { this.fatal(error); }
  }
}
