/** TUI-002: the only terminal owner. Raw mode, alternate screen and cursor
 * state live here so that every other TUI module stays pure and testable.
 * The terminal is restored on every end this process sees: its exit, however
 * it comes, and each termination signal, which the entry turns into its
 * shutdown (HOST_LOSS_SIGNALS, P0V-81). A crash must not leave the user
 * without an echo. SIGKILL and a fatal abort are seen by nothing in the
 * process; then the society is held by the fence (REC-007) and the terminal
 * is left to the shell's `reset`.
 */
import { TERMINAL_BOUNDS } from "@oma/domain/surface-bounds";

export interface Terminal {
  readonly columns: number;
  readonly rows: number;
  draw(lines: readonly string[]): void;
  onKeys(handler: (chunk: Uint8Array) => void): void;
  onResize(handler: () => void): void;
  /** Forgets what was drawn and clears the screen, so the next draw writes
   * every line. For a screen that no longer shows what this owner last drew:
   * one the Human asked to redraw (Ctrl-L), or a terminal that has just
   * attached to this one's session (macos-platform §4.6). The modes that save
   * nothing are asserted again; the alternate screen is not, because entering
   * it twice overwrites the cursor it saved. */
  repaint(): void;
  restore(): void;
}

const ESC = String.fromCharCode(27);
const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
const CURSOR_OFF = `${ESC}[?25l`;
const CURSOR_ON = `${ESC}[?25h`;
const HOME = `${ESC}[H`;
const CLEAR = `${ESC}[2J`;
/** DEC 2004. Without it the terminal sends a paste as if it had been typed,
 * so every newline in it is an Enter and one paste is submitted as several
 * prompts. It is turned off with the alternate screen: a terminal left in this
 * mode after OMA exits would bracket pastes at a shell that does not read
 * them. */
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;
/** P0V-79: DECCKM off -- the cursor keys send `ESC [`, not `ESC O`. Another
 * program may have left the terminal in application cursor mode, and it saves
 * nothing, so it is asserted wherever the other modes are. */
const CURSOR_KEYS_NORMAL = `${ESC}[?1l`;
const NEWLINE = `${String.fromCharCode(13)}${String.fromCharCode(10)}`;

export interface TerminalStreams {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
}

export function openTerminal(streams: TerminalStreams): Terminal {
  const { input, output } = streams;
  let restored = false;
  let previous: readonly string[] = [];
  /** NB-15: `write` on a destroyed stream throws synchronously, which arrives
   * as an uncaughtException through the input `data` listener. A destroyed
   * stream cannot take a frame, so the draw is skipped before the write --
   * while a live stream's write error still reaches the caller that owns it
   * (the pre-session chooser rejects on it). */
  const outputDead = (): boolean => (output as { destroyed?: boolean }).destroyed === true;
  const keyListeners: ((chunk: Buffer | string) => void)[] = [];
  const resizeListeners: (() => void)[] = [];
  const onExit = (): void => terminal.restore();
  const terminal: Terminal = {
    get columns() { return Math.max(TERMINAL_BOUNDS.minColumns.value, output.columns ?? TERMINAL_BOUNDS.assumedColumns.value); },
    get rows() { return Math.max(TERMINAL_BOUNDS.minRows.value, output.rows ?? TERMINAL_BOUNDS.assumedRows.value); },
    draw(lines) {
      if (restored || outputDead()) return;
      // Redraw only when something changed, so an idle TUI does not stream
      // escape sequences at the terminal.
      if (lines.length === previous.length && lines.every((line, index) => line === previous[index])) return;
      output.write(HOME + lines.join(NEWLINE));
      previous = [...lines];
    },
    onKeys(handler) {
      if (restored) return;
      const listener = (chunk: Buffer | string): void => handler(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      keyListeners.push(listener);
      input.on("data", listener);
    },
    onResize(handler) { if (restored) return; resizeListeners.push(handler); output.on("resize", handler); },
    repaint() {
      if (restored || outputDead()) return;
      previous = [];
      output.write(CURSOR_OFF + PASTE_ON + CURSOR_KEYS_NORMAL + CLEAR);
    },
    restore() {
      if (restored) return;
      restored = true;
      previous = [];
      releaseTerminalResources([
        () => process.off("exit", onExit),
        ...keyListeners.splice(0).map(listener => () => input.off("data", listener)),
        ...resizeListeners.splice(0).map(listener => () => output.off("resize", listener)),
        () => restoreTerminalModes(streams),
      ]);
    },
  };
  try {
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    output.write(ALT_ON + CURSOR_OFF + PASTE_ON + CURSOR_KEYS_NORMAL + CLEAR);
    // WP28: even an exit that forgets restore returns the terminal. The owner
    // exists before any fallible setup, including registration of this hook.
    process.once("exit", onExit);
  } catch (error) {
    try { terminal.restore(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "terminal setup and cleanup failed"); }
    throw error;
  }
  return terminal;
}

/** P0-4: one failed return must not strand the other terminal resources. */
export function releaseTerminalResources(actions: readonly (() => void)[]): void {
  const errors: unknown[] = [];
  for (const action of actions) try { action(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "terminal cleanup failed");
}

/** Also used after the interactive child has actually exited. */
export function restoreTerminalModes({ input, output }: TerminalStreams, mouse = false): void {
  releaseTerminalResources([
    () => { if (input.isTTY) input.setRawMode(false); },
    () => { input.pause(); },
    // NB-15: a destroyed output cannot take the restore sequence, and the
    // synchronous throw `write` raises on one crashes an `exit` hook. A dead
    // stream is skipped; a live stream's error still propagates.
    () => { if (!(output as { destroyed?: boolean }).destroyed) output.write((mouse ? `${ESC}[?1000l${ESC}[?1002l${ESC}[?1003l${ESC}[?1006l` : "") + PASTE_OFF + CURSOR_ON + ALT_OFF); },
  ]);
}
