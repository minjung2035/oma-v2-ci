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
import type { Duplex } from "node:stream";
import { FrameParser, encodeFrame, parseJsonObject } from "@oma/protocol/frame";
import { parseHostHistoryQuery, type HostHistoryQuery } from "@oma/protocol/host-history";
import { spawnInTerminal } from "@oma/process/async";
import { openPseudoTerminal, setWindowSize } from "@oma/native/pty";
import { TerminalModes } from "../terminal-modes.js";
import {
  TERMINAL_FRAME_BYTES, TerminalFrameParser, encodeTerminalFrame, encodeTerminalJson, parseResize, parseTerminalJson, isNewSessionHandoff, isResumeSessionHandoff,
} from "@oma/protocol/host-guest";

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
export interface SessionEnd { readonly code: number | null; readonly signal: string | null; readonly next?: "new" | "resume"; readonly history?: string; readonly mode?: "personal" | "society" }

type Screen = { readonly socket: Socket; readonly parser: TerminalFrameParser; attached: boolean; sized: boolean };

export class TerminalSession {
  private readonly modes = new TerminalModes();
  private readonly terminal: tty.ReadStream;
  private readonly child: ChildProcess;
  private screen: Screen | null = null;
  private ended: SessionEnd | null = null;
  private readonly endListeners: ((end: SessionEnd) => void)[] = [];
  private readonly historyChannel: Duplex | null;
  private historyQuery: { query: HostHistoryQuery; screen: Screen } | null = null;

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
    const handoff = child.stdio[3] as Duplex | null;
    this.historyChannel = handoff;
    const requests = new FrameParser(TERMINAL_FRAME_BYTES - 1);
    let handoffEnded = handoff === null, requested: { next: "new" | "resume"; history?: string; mode?: "personal" | "society" } | null = null, invalidHandoff = false;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (exited === null || !drained || !handoffEnded) return;
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      drainTimer = undefined;
      this.finish({ ...exited, ...(requested !== null && !invalidHandoff && exited.code === 0 && exited.signal === null ? requested : {}) });
    };
    handoff?.on("data", (chunk: Buffer) => {
      if (invalidHandoff) return;
      try {
        for (const frame of requests.feed(chunk)) {
          if (requested !== null) throw new Error("Invalid session handoff");
          if (isNewSessionHandoff(frame.raw)) requested = { next: "new",
            ...(frame.raw.mode === "personal" || frame.raw.mode === "society" ? { mode: frame.raw.mode } : {}) };
          else if (isResumeSessionHandoff(frame.raw)) requested = { next: "resume", history: frame.raw.history as string };
          else this.requestHistory(parseHostHistoryQuery(frame.raw));
        }
      } catch { invalidHandoff = true; handoff.destroy(); }
    });
    handoff?.once("end", () => {
      try { requests.finish(); } catch { invalidHandoff = true; }
      this.historyQuery = null;
      handoff.end();
      handoffEnded = true; settle();
    });
    handoff?.on("error", () => { invalidHandoff = true; });
    handoff?.once("close", () => {
      if (!handoffEnded) invalidHandoff = true;
      handoffEnded = true; settle();
    });
    const drain = (): void => { drained = true; settle(); };
    this.terminal.on("error", drain);
    this.terminal.once("end", drain);
    this.terminal.once("close", drain);
    child.once("exit", (code, signal) => {
      exited = { code, signal };
      if (!drained) {
        drainTimer = setTimeout(drain, 1000);
        drainTimer.unref();
      }
      settle();
    });
    // P0-5: ChildProcess also emits error when a signal could not be sent.
    // Only exit proves death; close with no pid confirms a failed spawn.
    child.on("error", () => {});
    child.once("close", () => {
      if (exited === null && child.pid === undefined) {
        exited = { code: null, signal: null };
        drain();
      }
    });
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
    if (this.ended === null && this.child.exitCode === null && this.child.signalCode === null)
      this.child.kill("SIGTERM");
  }

  /** A connection from guesthost. Its first frame is `attach`. */
  accept(socket: Socket): void {
    const screen: Screen = { socket, parser: new TerminalFrameParser(), attached: false, sized: false };
    socket.on("data", (chunk: Buffer) => { this.fromScreen(screen, chunk); });
    socket.on("error", () => { socket.destroy(); });
    socket.once("close", () => { if (this.screen === screen) { this.historyUnavailable("The attached host screen closed"); this.screen = null; } });
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
      if (frame.kind === "histories") {
        let value: Record<string, unknown>;
        try {
          value = parseJsonObject(frame.payload).raw;
          if (typeof value.id !== "string" || Object.keys(value).sort().join(",") !== (value.error === undefined ? "id,result" : "error,id") ||
              (value.error === undefined ? !value.result || typeof value.result !== "object" || Array.isArray(value.result) :
               typeof value.error !== "string" || value.error.length > 160)) throw new Error();
        } catch { this.drop(screen); return; }
        if (this.historyQuery?.screen === screen && this.historyQuery.query.id === value.id) {
          this.historyQuery = null;
          this.historyChannel?.write(encodeFrame(value));
        }
        continue;
      }
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
      screen.socket.end(encodeTerminalJson("exit", { ...this.ended }));
      return false;
    }
    const previous = this.screen;
    if (previous !== null && !takeover) {
      screen.socket.end(encodeTerminalJson("refused", { code: "ATTACH_CONFLICT", message: "this society is shown on another screen" }));
      return false;
    }
    if (previous !== null) { this.historyUnavailable("Another host screen took over"); previous.socket.end(encodeTerminalJson("detached", { reason: "taken-over" })); }
    screen.attached = true;
    this.screen = screen;
    return true;
  }

  private drop(screen: Screen): void {
    if (this.screen === screen) { this.historyUnavailable("Host history reply was lost"); this.screen = null; }
    screen.socket.destroy();
  }

  private finish(end: SessionEnd): void {
    if (this.ended !== null) return;
    this.ended = end;
    this.historyQuery = null;
    const screen = this.screen;
    this.screen = null;
    if (screen !== null) screen.socket.end(encodeTerminalJson("exit", { ...end }));
    this.terminal.destroy();
    for (const listener of this.endListeners) listener(end);
  }

  private requestHistory(query: HostHistoryQuery): void {
    this.historyUnavailable("A newer host history observation replaced this one");
    const screen = this.screen;
    if (screen === null || !screen.sized) {
      this.historyChannel?.write(encodeFrame({ id: query.id, error: "Attach a host terminal to observe Personal histories" }));
      return;
    }
    this.historyQuery = { query, screen };
    screen.socket.write(encodeTerminalJson("historyQuery", { ...query }));
  }

  private historyUnavailable(error: string): void {
    if (this.historyQuery === null) return;
    const { query } = this.historyQuery;
    this.historyQuery = null;
    this.historyChannel?.write(encodeFrame({ id: query.id, error }));
  }
}
