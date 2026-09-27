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
import { FrameParser, encodeFrame } from "../frame.js";
import { StoreError } from "../domain/errors.js";
import {
  helloParamsProblem, helloResultProblem, requestProblem, responseProblem,
  type HelloParams, type HelloResult, type PlatformFailure,
} from "../protocol/host-guest.js";

/** A failure the peer answered with, as the caller sees it. */
export class PlatformError extends Error {
  constructor(readonly failure: PlatformFailure) { super(`${failure.code}: ${failure.message}`); this.name = "PlatformError"; }
}
/** The answer did not arrive, so what the request did is not known. */
export function unknownOutcome(reason: string): PlatformError {
  return new PlatformError({ code: "ENGINE_UNAVAILABLE", message: reason, retry: "same-key" });
}

export interface PeerOptions {
  readonly frameBytes: number;
  /** How long a request waits for its answer before it is an unknown outcome. */
  readonly requestTimeoutMs: number;
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
    this.parser = new FrameParser(options.frameBytes);
    socket.on("data", this.onData);
    socket.once("end", this.onEnd);
    socket.once("close", this.onSocketClose);
    socket.on("error", this.onError);
  }

  /** Hands the socket over to a byte channel: this peer stops reading it and
   * no longer reacts to its end or close. Only after the hello was answered,
   * before which the host sends nothing else (§4.3). */
  detach(): Socket {
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
        const problem = responseProblem(frame);
        if (problem !== null) waiting.reject(unknownOutcome(`the answer was malformed (${problem})`));
        else if (frame.ok === true) waiting.resolve(frame.result as Record<string, unknown>);
        else waiting.reject(new PlatformError(frame.error as PlatformFailure));
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

  request(method: string, params: Record<string, unknown>, key?: string): Promise<Record<string, unknown>> {
    const id = `r${++this.sequence}`;
    return new Promise((resolve, reject) => {
      if (this.closed !== null) { reject(unknownOutcome(this.closed)); return; }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(unknownOutcome(`no answer to ${method} within ${this.options.requestTimeoutMs} ms`));
      }, this.options.requestTimeoutMs);
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
export async function sendHello(peer: FramedPeer, params: HelloParams): Promise<HelloResult> {
  const problem = helloParamsProblem(params);
  if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
  const result = await peer.request("hello", params as unknown as Record<string, unknown>);
  const invalid = helloResultProblem(result);
  if (invalid !== null) { peer.close(invalid); throw unknownOutcome(`the guest's hello was malformed (${invalid})`); }
  return result as unknown as HelloResult;
}

/** Reads exactly one frame from a socket that will then carry raw bytes (the
 * egress and stream channels), and hands back what arrived after it. The
 * socket is paused on return so nothing is lost before the caller pipes it. */
export function readLeadingFrame(socket: Socket, frameBytes: number, deadlineMs: number): Promise<{ readonly frame: Record<string, unknown>; readonly rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new StoreError("INVALID_REQUEST", "no leading frame before the deadline")), deadlineMs);
    timer.unref();
    const finish = (error: Error | null, value?: { frame: Record<string, unknown>; rest: Buffer }): void => {
      clearTimeout(timer);
      socket.off("data", onData); socket.off("close", onClose);
      socket.pause();
      if (error !== null) reject(error); else resolve(value!);
    };
    const onClose = (): void => finish(new StoreError("BROKER_UNAVAILABLE", "the connection closed before its leading frame"));
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
    socket.on("data", onData);
    socket.once("close", onClose);
    socket.resume();
  });
}
