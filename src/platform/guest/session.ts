/** A society's terminal session (macos-platform §4.6): one pseudo-terminal,
 * the program on it -- the product's own `oma` -- and at most one screen
 * attached to it at a time.
 *
 * This is the dtach/abduco model. The holder keeps reading the program's
 * output whether or not a screen is attached, so the program never blocks on
 * a missing screen. It does not emulate the terminal: a screen that attaches
 * anew gets back the few modes the program set (alternate screen, bracketed
 * paste, a hidden cursor) and the program is asked to draw everything again
 * (Ctrl-L), which is dtach's redraw method.
 */
import { closeSync } from "node:fs";
import tty from "node:tty";
import type { Socket } from "node:net";
import type { ChildProcess } from "node:child_process";
import { spawnInTerminal } from "../../process/async.js";
import { openPseudoTerminal, setWindowSize } from "./pty.js";
import { TerminalModes } from "../terminal-modes.js";
import {
  TERMINAL_FRAME_BYTES, TerminalFrameParser, encodeTerminalFrame, encodeTerminalJson, parseResize, parseTerminalJson,
} from "../../protocol/host-guest.js";

const REDRAW = Buffer.from([0x0c]);

export interface SessionProgram {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}
export interface SessionOptions {
  readonly columns: number;
  readonly rows: number;
  /** Output a screen has not taken yet, past which that screen is dropped:
   * it reattaches and is drawn again rather than holding the program back. */
  readonly backlogBytes: number;
}
export interface SessionEnd { readonly code: number | null; readonly signal: string | null }

type Screen = { readonly socket: Socket; readonly parser: TerminalFrameParser; attached: boolean; sized: boolean };

export class TerminalSession {
  private readonly modes = new TerminalModes();
  private readonly terminal: tty.ReadStream;
  private readonly child: ChildProcess;
  private screen: Screen | null = null;
  private ended: SessionEnd | null = null;
  private readonly endListeners: ((end: SessionEnd) => void)[] = [];

  private constructor(private readonly master: number, child: ChildProcess, private readonly options: SessionOptions) {
    this.child = child;
    this.terminal = new tty.ReadStream(master);
    this.terminal.on("data", (chunk: Buffer) => { this.fromProgram(chunk); });
    // The program's last output can still be in the terminal when its exit is
    // reported, so the end waits for the terminal too: EIO once every holder
    // of the other side has closed it. A descendant that kept the terminal
    // open is not waited for past a moment.
    let exited: SessionEnd | null = null;
    let drained = false;
    const settle = (): void => { if (exited !== null && drained) this.finish(exited); };
    this.terminal.on("error", () => { drained = true; settle(); });
    this.terminal.on("end", () => { drained = true; settle(); });
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      setTimeout(() => { drained = true; settle(); }, 1000).unref();
      settle();
    });
    child.once("error", () => { exited = { code: null, signal: null }; drained = true; settle(); });
  }

  static start(program: SessionProgram, options: SessionOptions): TerminalSession {
    const pty = openPseudoTerminal(options.columns, options.rows);
    let child: ChildProcess;
    try { child = spawnInTerminal(program.executable, program.argv, program.cwd, program.env, pty.slave); }
    catch (error) { closeSync(pty.master); throw error; }
    finally { closeSync(pty.slave); }
    return new TerminalSession(pty.master, child, options);
  }

  get pid(): number | undefined { return this.child.pid; }
  get end(): SessionEnd | null { return this.ended; }
  onEnd(listener: (end: SessionEnd) => void): void {
    if (this.ended !== null) { listener(this.ended); return; }
    this.endListeners.push(listener);
  }

  /** Asks the program to end the way a terminal's owner would (SIGTERM; the
   * product's `oma` then takes its own shutdown path). */
  terminate(): void {
    if (this.ended === null) this.child.kill("SIGTERM");
  }

  /** A connection from guesthost. Its first frame is `attach`. */
  accept(socket: Socket): void {
    const screen: Screen = { socket, parser: new TerminalFrameParser(), attached: false, sized: false };
    socket.on("data", (chunk: Buffer) => { this.fromScreen(screen, chunk); });
    socket.on("error", () => { socket.destroy(); });
    socket.once("close", () => { if (this.screen === screen) this.screen = null; });
  }

  private fromProgram(chunk: Buffer): void {
    this.modes.feed(chunk);
    const screen = this.screen;
    if (screen === null || !screen.sized) return;
    for (let at = 0; at < chunk.length; at += TERMINAL_FRAME_BYTES - 1)
      screen.socket.write(encodeTerminalFrame("output", chunk.subarray(at, at + TERMINAL_FRAME_BYTES - 1)));
    if (screen.socket.writableLength > this.options.backlogBytes) {
      this.screen = null;
      screen.socket.destroy();
    }
  }

  private fromScreen(screen: Screen, chunk: Buffer): void {
    let frames;
    try { frames = screen.parser.feed(chunk); }
    catch { this.drop(screen); return; }
    for (const frame of frames) {
      if (!screen.attached) {
        const request = frame.kind === "attach" ? parseTerminalJson(frame.payload, [], ["takeover"]) : null;
        if (request === null || (request.takeover !== undefined && request.takeover !== true)) { this.drop(screen); return; }
        if (!this.attach(screen, request.takeover === true)) return;
        continue;
      }
      if (this.screen !== screen) return;
      if (frame.kind === "input") { this.terminal.write(frame.payload); continue; }
      if (frame.kind === "resize") {
        const size = parseResize(frame.payload);
        if (size === null) { this.drop(screen); return; }
        setWindowSize(this.master, size.columns, size.rows);
        if (!screen.sized) {
          // First size of this screen: its modes back, then the whole screen.
          screen.sized = true;
          const modes = this.modes.replay();
          if (modes.length > 0) screen.socket.write(encodeTerminalFrame("output", Buffer.from(modes, "latin1")));
          this.terminal.write(REDRAW);
        }
        continue;
      }
      this.drop(screen);
      return;
    }
  }

  /** MAC-220: one screen at a time; a takeover tells the previous one. */
  private attach(screen: Screen, takeover: boolean): boolean {
    if (this.ended !== null) {
      screen.socket.end(encodeTerminalJson("exit", { code: this.ended.code, signal: this.ended.signal }));
      return false;
    }
    const previous = this.screen;
    if (previous !== null && !takeover) {
      screen.socket.end(encodeTerminalJson("refused", { code: "ATTACH_CONFLICT", message: "this society is shown on another screen" }));
      return false;
    }
    if (previous !== null) previous.socket.end(encodeTerminalJson("detached", { reason: "taken-over" }));
    screen.attached = true;
    this.screen = screen;
    return true;
  }

  private drop(screen: Screen): void {
    if (this.screen === screen) this.screen = null;
    screen.socket.destroy();
  }

  private finish(end: SessionEnd): void {
    if (this.ended !== null) return;
    this.ended = end;
    const screen = this.screen;
    this.screen = null;
    if (screen !== null) screen.socket.end(encodeTerminalJson("exit", { code: end.code, signal: end.signal }));
    this.terminal.destroy();
    for (const listener of this.endListeners) listener(end);
  }
}
