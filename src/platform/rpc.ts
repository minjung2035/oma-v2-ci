/** One host-guest connection as a peer that sends and receives frames.
 *
 * Both ends of every JSON channel use this, so a request, its response and the
 * handshake mean the same thing on the host and in the guest (MAC-210). The
 * frame parser is the broker's own; a frame this peer cannot parse poisons the
 * connection, which is closed rather than resynchronised (IPC-001/002).
 *
 * A request whose answer did not arrive -- the connection closed, the guest
 * rebooted, the deadline passed -- is rejected as an unknown outcome
 * (`ENGINE_UNAVAILABLE`, retry "same-key"), never as a refusal: the caller
 * looks it up again by its key before it sends anything twice (MAC-241).
 */
import type { Socket } from "node:net";
import { connectEndpoint } from "../protocol/connection.js";
import { FrameParser, encodeFrame } from "../frame.js";
import { ERROR_METADATA, StoreError, errorCodeOf, primaryFailure } from "../domain/errors.js";
import { productText } from "./product-text.js";
import {
  helloParamsProblem, helloResultProblem, requestProblem, responseProblem,
  type HelloParams, type HelloResult, type PlatformFailure,
} from "../protocol/host-guest.js";

/** A failure the peer answered with, as the caller sees it. */
export class PlatformError extends Error {
  constructor(readonly failure: PlatformFailure, options?: ErrorOptions) { super(`${failure.code}: ${failure.message}`, options); this.name = "PlatformError"; }
}
/** The answer did not arrive, so what the request did is not known. */
export function unknownOutcome(reason: string): PlatformError {
  return new PlatformError({ code: "ENGINE_UNAVAILABLE", message: reason, retry: "same-key" });
}

/** MAC-231/241: all request channels preserve the same error/retry meaning.
 * Local unobserved/internal failures cannot become a permanent input refusal. */
export function platformFailure(error: unknown): PlatformFailure {
  const primary = primaryFailure(error);
  if (primary instanceof PlatformError) {
    const failure = primary.failure;
    return { ...failure, message: productText(failure.message) ? failure.message : failure.code };
  }
  const code = errorCodeOf(error);
  const category = ERROR_METADATA[code].category;
  const retry = code === "STORAGE_FULL" ? "after-repair" :
    category === "transient" || category === "ambiguous" || category === "internal" ? "same-key" : "never";
  const message = primary instanceof StoreError && code !== "INTERNAL_ERROR" && productText(primary.message) ? primary.message : code;
  return { code, message, retry };
}

export interface PeerOptions {
  readonly frameBytes: number;
  /** How long a request waits for its answer before it is an unknown outcome. */
  readonly requestTimeoutMs: number;
}

/** Platform phase budgets use native timers; only a pool's leading-frame
 * reader may explicitly wait for the connection's lifetime. */
function phaseBudget(milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 2_147_483_647)
    throw new RangeError("platform phase timeout must be a positive timer-safe integer");
}

/** P0-4: one owner for a connection attempt. A deadline ends observation,
 * not any request at the far end. No application bytes are read here. */
export async function connectSocket(path: string, deadlineMs: number): Promise<Socket> {
  try { return await connectEndpoint(path, deadlineMs); }
  catch (error) {
    if (error instanceof RangeError) throw error;
    throw unknownOutcome("the connection could not be observed");
  }
}

/** A response proves only the request it names; an invalid answer proves no
 * outcome. Both JSON and leading-frame response readers use this decoder. */
function responseResult(frame: Record<string, unknown>, id: string): Record<string, unknown> {
  const problem = responseProblem(frame);
  if (problem !== null || frame.id !== id) throw unknownOutcome(`the answer was malformed (${problem ?? "wrong id"})`);
  if (frame.ok !== true) throw new PlatformError(frame.error as PlatformFailure);
  return frame.result as Record<string, unknown>;
}

type Pending = { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class FramedPeer {
  private readonly parser: FrameParser;
  private readonly pending = new Map<string, Pending>();
  private readonly frameListeners: ((frame: Record<string, unknown>) => void)[] = [];
  private readonly closeListeners: ((reason: string) => void)[] = [];
  private sequence = 0;
  private closed: string | null = null;

  private readonly onData = (chunk: Buffer): void => { this.receive(chunk); };
  /** A JSON channel has nothing more to say once its peer has ended its side,
   * so this end closes too (the sockets are half-open capable). */
  private readonly onEnd = (): void => { this.close("the peer ended the connection"); };
  private readonly onSocketClose = (): void => { this.end("the connection closed"); };
  private readonly onError = (error: Error): void => { this.end(`the connection failed: ${error.message}`); };

  constructor(readonly socket: Socket, private readonly options: PeerOptions) {
    phaseBudget(options.requestTimeoutMs);
    this.parser = new FrameParser(options.frameBytes);
    socket.on("data", this.onData);
    socket.once("end", this.onEnd);
    socket.once("close", this.onSocketClose);
    socket.on("error", this.onError);
    socket.resume();
  }

  /** Hands the socket over to a byte channel: this peer stops reading it and
   * no longer reacts to its end or close. Only after the hello was answered,
   * before which the host sends nothing else (§4.3). The socket is handed
   * over paused, so nothing that arrives before its new owner reads is lost. */
  detach(): Socket {
    this.socket.pause();
    this.socket.off("data", this.onData);
    this.socket.off("end", this.onEnd);
    this.socket.off("close", this.onSocketClose);
    this.socket.off("error", this.onError);
    this.closed ??= "handed to a byte channel";
    return this.socket;
  }

  get isClosed(): boolean { return this.closed !== null; }

  private receive(chunk: Buffer): void {
    let frames: Record<string, unknown>[];
    try { frames = this.parser.feed(chunk).map(frame => frame.raw); }
    catch (error) { this.close(`an invalid frame arrived: ${error instanceof Error ? error.message : String(error)}`); return; }
    for (const frame of frames) {
      if (Object.hasOwn(frame, "ok") && typeof frame.id === "string" && this.pending.has(frame.id)) {
        const waiting = this.pending.get(frame.id)!;
        this.pending.delete(frame.id);
        clearTimeout(waiting.timer);
        try { waiting.resolve(responseResult(frame, frame.id)); }
        catch (error) { waiting.reject(error as Error); }
        continue;
      }
      for (const listener of this.frameListeners) listener(frame);
    }
  }

  private end(reason: string): void {
    if (this.closed !== null) return;
    this.closed = reason;
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(unknownOutcome(reason));
      this.pending.delete(id);
    }
    for (const listener of this.closeListeners) listener(reason);
  }

  /** Frames that are not an answer to this peer's own request. */
  onFrame(listener: (frame: Record<string, unknown>) => void): void { this.frameListeners.push(listener); }
  onClose(listener: (reason: string) => void): void {
    if (this.closed !== null) { listener(this.closed); return; }
    this.closeListeners.push(listener);
  }

  send(value: Record<string, unknown>): void {
    if (this.closed !== null) throw unknownOutcome(this.closed);
    const bytes = encodeFrame(value);
    if (bytes.length - 4 > this.options.frameBytes)
      throw new StoreError("FRAME_TOO_LARGE", "a platform frame exceeds the frame limit");
    this.socket.write(bytes);
  }

  request(method: string, params: Record<string, unknown>, key?: string, timeoutMs = this.options.requestTimeoutMs): Promise<Record<string, unknown>> {
    const id = `r${++this.sequence}`;
    return new Promise((resolve, reject) => {
      phaseBudget(timeoutMs);
      if (this.closed !== null) { reject(unknownOutcome(this.closed)); return; }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unknownOutcome(`no answer to ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ v: 1, id, method, params, ...(key === undefined ? {} : { key }) }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error as Error); }
    });
  }

  answer(id: string, result: Record<string, unknown>): void { this.send({ v: 1, id, ok: true, result }); }
  refuse(id: string, failure: PlatformFailure): void { this.send({ v: 1, id, ok: false, error: failure }); }

  close(reason = "closed by this end"): void {
    this.end(reason);
    this.socket.destroy();
  }

  /** Closes after what this end already wrote has left it, so a refusal
   * reaches the peer before the connection ends; a peer that does not close
   * its side in time is cut off. */
  closeAfterFlush(reason: string, graceMs = 1000): void {
    phaseBudget(graceMs);
    this.end(reason);
    const timer = setTimeout(() => { this.socket.destroy(); }, graceMs);
    timer.unref();
    this.socket.once("close", () => { clearTimeout(timer); });
    this.socket.end();
  }
}

/** The guest's side of a handshake: the first frame must be a valid hello. */
export function readHello(peer: FramedPeer, deadlineMs: number): Promise<{ readonly id: string; readonly params: HelloParams }> {
  return new Promise((resolve, reject) => {
    phaseBudget(deadlineMs);
    const timer = setTimeout(() => { peer.close("no hello"); reject(new StoreError("INVALID_REQUEST", "no hello before the deadline")); }, deadlineMs);
    timer.unref();
    let settled = false;
    peer.onFrame(frame => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const problem = requestProblem(frame) ?? (frame.method === "hello" ? helloParamsProblem(frame.params) : "the first message must be hello");
      if (problem !== null) {
        try { if (typeof frame.id === "string") peer.refuse(frame.id, { code: "INVALID_REQUEST", message: problem, retry: "never" }); } catch { /* closing anyway */ }
        peer.closeAfterFlush(problem);
        reject(new StoreError("INVALID_REQUEST", problem));
        return;
      }
      resolve({ id: frame.id as string, params: frame.params as unknown as HelloParams });
    });
    peer.onClose(reason => { if (!settled) { settled = true; clearTimeout(timer); reject(new StoreError("BROKER_UNAVAILABLE", reason)); } });
  });
}

/** The host's side: send hello and check what the guest answered. */
export async function sendHello(peer: FramedPeer, params: HelloParams, deadlineMs?: number): Promise<HelloResult> {
  const problem = helloParamsProblem(params);
  if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
  const result = await peer.request("hello", params as unknown as Record<string, unknown>, undefined, deadlineMs);
  const invalid = helloResultProblem(result);
  if (invalid !== null) { peer.close(invalid); throw unknownOutcome(`the guest's hello was malformed (${invalid})`); }
  return result as unknown as HelloResult;
}

/** The host's side of a byte channel's handshake (terminal, egress, stream).
 * The guest may send bytes the moment it has answered, so its answer is read
 * as exactly one frame and whatever came after it is handed back with the
 * socket; a framed peer would read those bytes as frames too. */
export async function sendHelloForBytes(socket: Socket, params: HelloParams, frameBytes: number, deadlineMs: number):
  Promise<{ readonly result: HelloResult; readonly rest: Buffer }> {
  const problem = helloParamsProblem(params);
  if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
  socket.write(encodeFrame({ v: 1, id: "hello", method: "hello", params }));
  try {
    const answer = await readLeadingResponse(socket, "hello", frameBytes, deadlineMs);
    const invalid = helloResultProblem(answer.result);
    if (invalid !== null) throw unknownOutcome(`the guest's hello was malformed (${invalid})`);
    return { result: answer.result as unknown as HelloResult, rest: answer.rest };
  } catch (error) { socket.destroy(); throw error; }
}

/** The response half of a byte-channel exchange. Silence, broken framing
 * and mismatched IDs are unknown outcomes, not input refusals (MAC-241). */
export async function readLeadingResponse(socket: Socket, id: string, frameBytes: number, deadlineMs: number):
  Promise<{ readonly result: Record<string, unknown>; readonly rest: Buffer }> {
  let answer: { frame: Record<string, unknown>; rest: Buffer };
  try { answer = await readLeadingFrame(socket, frameBytes, deadlineMs); }
  catch (error) {
    if (error instanceof RangeError) throw error;
    throw unknownOutcome("the response could not be observed");
  }
  return { result: responseResult(answer.frame, id), rest: answer.rest };
}

/** Reads exactly one frame from a socket that will then carry raw bytes (the
 * egress and stream channels), and hands back what arrived after it. The
 * socket is paused on return so nothing is lost before the caller pipes it.
 * An infinite deadline waits as long as the connection lives: a pooled
 * egress connection is idle until an engine needs it. */
export function readLeadingFrame(socket: Socket, frameBytes: number, deadlineMs: number): Promise<{ readonly frame: Record<string, unknown>; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    if (deadlineMs !== Number.POSITIVE_INFINITY) phaseBudget(deadlineMs);
    let buffered = Buffer.alloc(0);
    let settled = false;
    const timer = Number.isFinite(deadlineMs)
      ? setTimeout(() => finish(new StoreError("BROKER_UNAVAILABLE", "no leading frame before the deadline")), deadlineMs)
      : null;
    timer?.unref();
    const finish = (error: Error | null, value?: { frame: Record<string, unknown>; rest: Buffer }): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      socket.off("data", onData); socket.off("end", onEnd); socket.off("error", onError); socket.off("close", onClose);
      socket.pause();
      if (error !== null) reject(error); else resolve(value!);
    };
    const onClose = (): void => finish(new StoreError("BROKER_UNAVAILABLE", "the connection closed before its leading frame"));
    const onEnd = (): void => finish(new StoreError("BROKER_UNAVAILABLE", "the connection ended before its leading frame"));
    const onError = (cause: Error): void => finish(new StoreError("BROKER_UNAVAILABLE", "the connection failed before its leading frame", { cause }));
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32BE(0);
      if (length > frameBytes) { finish(new StoreError("FRAME_TOO_LARGE", "leading frame exceeds the frame limit")); return; }
      if (buffered.length < 4 + length) return;
      const parser = new FrameParser(frameBytes);
      let frame: Record<string, unknown>;
      try { frame = parser.feed(buffered.subarray(0, 4 + length))[0]!.raw; }
      catch (error) { finish(error as Error); return; }
      finish(null, { frame, rest: buffered.subarray(4 + length) });
    };
    // readableEnded means EOF was consumed, unlike readable === false or a
    // pending FIN: bytes buffered before an unread EOF still belong to us.
    if (socket.destroyed || socket.readableEnded) { onClose(); return; }
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.resume();
  });
}
