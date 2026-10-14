/** The Mac side of a society's terminal (macos-platform §2.4, MAC-222): what
 * the `oma` command -- and OMA.app's terminal view -- does with a Host API
 * connection. It draws nothing itself. It carries the Human's keys and the
 * window size to the guest's session and the session's bytes back, and when
 * it leaves it puts the Mac's terminal back the way it found it, as a tmux
 * client does.
 */
import type { Socket } from "node:net";
import { encodeFrame } from "../../frame.js";
import { connectSocket, readLeadingResponse } from "../rpc.js";
import { TerminalModes } from "../terminal-modes.js";
import { HOST_LOSS_SIGNALS } from "../../runtime/broker-lifetime.js";
import { HOST_API_VERSION } from "../../protocol/host-api.js";
import { withAsyncCleanup } from "../../process/cleanup.js";
import { parseJsonObject } from "../../frame.js";
import { parseHostHistoryQuery, type HostHistoryQuery } from "../../protocol/host-history.js";
import {
  TERMINAL_FRAME_BYTES, TerminalFrameParser, encodeTerminalFrame, encodeTerminalJson, parseTerminalJson, parseTerminalExit, resizePayload,
} from "../../protocol/host-guest.js";

export interface AttachTerminal {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?(on: boolean): unknown };
  readonly output: NodeJS.WritableStream & { columns?: number; rows?: number };
  /** Registers for window-size changes; answers the unregister. */
  onResize(listener: () => void): () => void;
}
export type AttachEnd =
  | { readonly kind: "exit"; readonly code: number | null; readonly signal: string | null; readonly next?: "new" | "resume"; readonly history?: string; readonly mode?: "personal" | "society" }
  | { readonly kind: "detached" }
  | { readonly kind: "refused"; readonly code: string; readonly message: string }
  /** The connection ended without the session saying why: whether the
   * society still runs is not known here (P0-5). */
  | { readonly kind: "lost" }
  /** This process was asked to end (P0V-81): the screen was put back and the
   * session left running, as a closed window leaves it. */
  | { readonly kind: "stopped"; readonly signal: string };

export interface AttachOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly society: string;
  readonly takeover: boolean;
  readonly frameBytes: number;
  readonly deadlineMs: number;
  readonly terminal: AttachTerminal;
  readonly histories?: (query: HostHistoryQuery) => Promise<Record<string, unknown>>;
}

async function exchange(socket: Socket, frame: Record<string, unknown>, options: AttachOptions): Promise<{ result: Record<string, unknown>; rest: Buffer }> {
  socket.write(encodeFrame(frame));
  return readLeadingResponse(socket, frame.id as string, options.frameBytes, options.deadlineMs);
}

export async function attachTerminal(options: AttachOptions): Promise<AttachEnd> {
  const socket = await connectSocket(options.socketPath, options.deadlineMs);
  let rest: Buffer;
  try {
    const hello = await exchange(socket, { v: 1, id: "hello", method: "hello",
      params: { api: { min: Math.max(1, HOST_API_VERSION - 1), max: HOST_API_VERSION }, token: options.token, client: "oma-cli" } }, options);
    if (hello.rest.length > 0) socket.unshift(hello.rest);
    rest = (await exchange(socket, { v: 1, id: "attach", method: "terminal.attach",
      params: { society: options.society, ...(options.takeover ? { takeover: true } : {}) } }, options)).rest;
  } catch (error) { socket.destroy(); throw error; }

  const { input, output } = options.terminal;
  const modes = new TerminalModes();
  const parser = new TerminalFrameParser();
  let end: AttachEnd | null = null;
  let observation = 0;
  const observeHistories = (query: HostHistoryQuery): void => {
    const epoch = ++observation;
    void Promise.resolve().then(() => {
      if (options.histories === undefined) throw new Error("This host screen cannot observe Personal histories");
      return options.histories(query);
    }).then(result => {
      if (epoch === observation && end === null && !socket.destroyed) socket.write(encodeTerminalJson("histories", { id: query.id, result }));
    }, () => {
      if (epoch === observation && end === null && !socket.destroyed) socket.write(encodeTerminalJson("histories", { id: query.id, error: "Host Personal histories could not be observed" }));
    }).catch(() => failed());
  };
  const resize = (): void => { socket.write(encodeTerminalFrame("resize", resizePayload(output.columns ?? 80, output.rows ?? 24))); };
  const typed = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (let at = 0; at < bytes.length; at += TERMINAL_FRAME_BYTES - 1)
      socket.write(encodeTerminalFrame("input", bytes.subarray(at, at + TERMINAL_FRAME_BYTES - 1)));
  };
  const received = (chunk: Buffer): void => {
    let frames;
    try { frames = parser.feed(chunk); } catch { end = { kind: "lost" }; socket.destroy(); return; }
    for (const frame of frames) {
      // A terminal word is final. Contradictory or malformed trailing frames
      // cannot grant a new birth, even when a valid exit preceded them.
      if (end !== null) { end = { kind: "lost" }; socket.destroy(); return; }
      if (frame.kind === "historyQuery") {
        try { observeHistories(parseHostHistoryQuery(parseJsonObject(frame.payload).raw)); }
        catch { end = { kind: "lost" }; socket.destroy(); return; }
        continue;
      }
      if (frame.kind === "output") { modes.feed(frame.payload); output.write(frame.payload); continue; }
      if (frame.kind === "exit") {
        const value = parseTerminalExit(frame.payload);
        if (value === null) { end = { kind: "lost" }; socket.destroy(); return; }
        end = { kind: "exit", ...value };
      } else if (frame.kind === "detached") end = { kind: "detached" };
      else if (frame.kind === "refused") {
        const value = parseTerminalJson(frame.payload, ["code", "message"]);
        end = { kind: "refused", code: String(value?.code ?? "INTERNAL_ERROR"), message: String(value?.message ?? "") };
      } else { end = { kind: "lost" }; socket.destroy(); return; }
    }
  };

  const raw = input.isTTY === true && typeof input.setRawMode === "function";
  let rawOwned = false, unresize: (() => void) | undefined;
  // AV31, P0V-81: a termination signal ends the attachment, not the session.
  let stoppedBy: string | null = null;
  const stop = (signal: NodeJS.Signals): void => { stoppedBy ??= signal; socket.destroy(); };
  const failed = (): void => { end = { kind: "lost" }; socket.destroy(); };
  let close: () => void;
  const closed = new Promise<void>(resolve => { close = resolve; socket.once("close", close); });
  return withAsyncCleanup<AttachEnd>(async () => {
    socket.on("error", failed);
    if (raw) { rawOwned = true; input.setRawMode!(true); }
    for (const signal of HOST_LOSS_SIGNALS) process.on(signal, stop);
    unresize = options.terminal.onResize(resize);
    input.on("data", typed);
    input.resume();
    socket.on("data", received);
    if (rest.length > 0) received(rest);
    // Handed back paused by the handshake reader; a listener alone does not
    // let a paused stream flow again. The close owner already exists.
    socket.resume();
    resize();
    await closed;
    if (stoppedBy !== null) return { kind: "stopped", signal: stoppedBy };
    try { parser.finish(); } catch { return { kind: "lost" }; }
    return end ?? { kind: "lost" };
  }, () => {
    observation++;
    // P0-4: partial acquisition and a failed restore still return every other
    // acquired resource; neither failure grants a replacement session.
    const errors: unknown[] = [];
    const release = (run: () => void): void => { try { run(); } catch (error) { errors.push(error); } };
    release(() => { socket.destroy(); });
    release(() => { socket.off("data", received); socket.off("close", close!); socket.off("error", failed); });
    release(() => { input.off("data", typed); });
    release(() => { input.pause(); });
    release(() => { unresize?.(); });
    release(() => { output.write(modes.undo()); });
    if (rawOwned) release(() => { input.setRawMode!(false); });
    for (const signal of HOST_LOSS_SIGNALS) release(() => { process.off(signal, stop); });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Terminal attachment cleanup failed");
  });
}
