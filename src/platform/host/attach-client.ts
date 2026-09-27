/** The Mac side of a society's terminal (macos-platform §2.4, MAC-222): what
 * the `oma` command -- and OMA.app's terminal view -- does with a Host API
 * connection. It draws nothing itself. It carries the Human's keys and the
 * window size to the guest's session and the session's bytes back, and when
 * it leaves it puts the Mac's terminal back the way it found it, as a tmux
 * client does.
 */
import { connect, type Socket } from "node:net";
import { encodeFrame } from "../../frame.js";
import { PlatformError, readLeadingFrame } from "../rpc.js";
import { TerminalModes } from "../terminal-modes.js";
import { HOST_LOSS_SIGNALS } from "../../runtime/broker-lifetime.js";
import { HOST_API_VERSION } from "../../protocol/host-api.js";
import {
  TERMINAL_FRAME_BYTES, TerminalFrameParser, encodeTerminalFrame, parseTerminalJson, resizePayload, responseProblem,
  type PlatformFailure,
} from "../../protocol/host-guest.js";

export interface AttachTerminal {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?(on: boolean): unknown };
  readonly output: NodeJS.WritableStream & { columns?: number; rows?: number };
  /** Registers for window-size changes; answers the unregister. */
  onResize(listener: () => void): () => void;
}
export type AttachEnd =
  | { readonly kind: "exit"; readonly code: number | null; readonly signal: string | null }
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
}

async function exchange(socket: Socket, frame: Record<string, unknown>, options: AttachOptions): Promise<{ result: Record<string, unknown>; rest: Buffer }> {
  socket.write(encodeFrame(frame));
  const answer = await readLeadingFrame(socket, options.frameBytes, options.deadlineMs);
  const problem = responseProblem(answer.frame);
  if (problem !== null || answer.frame.id !== frame.id) throw new PlatformError({ code: "ENGINE_UNAVAILABLE", message: "the service's answer was malformed", retry: "same-key" });
  if (answer.frame.ok !== true) throw new PlatformError(answer.frame.error as PlatformFailure);
  return { result: answer.frame.result as Record<string, unknown>, rest: answer.rest };
}

export async function attachTerminal(options: AttachOptions): Promise<AttachEnd> {
  const socket = connect(options.socketPath);
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
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
  const resize = (): void => { socket.write(encodeTerminalFrame("resize", resizePayload(output.columns ?? 80, output.rows ?? 24))); };
  const typed = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (let at = 0; at < bytes.length; at += TERMINAL_FRAME_BYTES - 1)
      socket.write(encodeTerminalFrame("input", bytes.subarray(at, at + TERMINAL_FRAME_BYTES - 1)));
  };
  const received = (chunk: Buffer): void => {
    let frames;
    try { frames = parser.feed(chunk); } catch { socket.destroy(); return; }
    for (const frame of frames) {
      if (frame.kind === "output") { modes.feed(frame.payload); output.write(frame.payload); continue; }
      if (frame.kind === "exit") {
        const value = parseTerminalJson(frame.payload, ["code", "signal"]);
        end = { kind: "exit", code: typeof value?.code === "number" ? value.code : null, signal: typeof value?.signal === "string" ? value.signal : null };
      } else if (frame.kind === "detached") end = { kind: "detached" };
      else if (frame.kind === "refused") {
        const value = parseTerminalJson(frame.payload, ["code", "message"]);
        end = { kind: "refused", code: String(value?.code ?? "INTERNAL_ERROR"), message: String(value?.message ?? "") };
      }
    }
  };

  const raw = input.isTTY === true && typeof input.setRawMode === "function";
  if (raw) input.setRawMode!(true);
  // AV31, P0V-81: a termination signal ends the attachment as a closed
  // connection does, so the one restore below puts this screen back. Its
  // default action would leave the Human's terminal raw, on the session's
  // alternate screen.
  let stoppedBy: string | null = null;
  const stop = (signal: NodeJS.Signals): void => { stoppedBy ??= signal; socket.destroy(); };
  for (const signal of HOST_LOSS_SIGNALS) process.on(signal, stop);
  const unresize = options.terminal.onResize(resize);
  input.on("data", typed);
  input.resume();
  socket.on("data", received);
  socket.on("error", () => { socket.destroy(); });
  if (rest.length > 0) received(rest);
  // Handed back paused by the handshake's reader; a listener alone does not
  // let a paused stream flow again.
  socket.resume();
  resize();
  await new Promise<void>(resolve => { socket.once("close", () => resolve()); });
  input.off("data", typed);
  input.pause();
  unresize();
  // MAC-222: whatever the session left on, this screen is put back.
  output.write(modes.undo());
  if (raw) input.setRawMode!(false);
  for (const signal of HOST_LOSS_SIGNALS) process.off(signal, stop);
  if (stoppedBy !== null) return { kind: "stopped", signal: stoppedBy };
  return end ?? { kind: "lost" };
}
