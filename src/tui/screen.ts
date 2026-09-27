/** TUI-002: the only terminal owner. Raw mode, alternate screen and cursor
 * state live here so that every other TUI module stays pure and testable.
 * Restoring the terminal is unconditional: a crash must not leave the user
 * without an echo.
 */
import { TERMINAL_BOUNDS } from "./limits.js";

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
  if (input.isTTY) input.setRawMode(true);
  input.resume();
  output.write(ALT_ON + CURSOR_OFF + PASTE_ON + CURSOR_KEYS_NORMAL + CLEAR);
  // WP28: unconditional means every exit, not only the ones that remember to
  // call restore(). A TTY write and setRawMode are synchronous, so they still
  // happen inside an `exit` handler.
  process.once("exit", () => terminal.restore());
  const terminal: Terminal = {
    get columns() { return Math.max(TERMINAL_BOUNDS.minColumns.value, output.columns ?? TERMINAL_BOUNDS.assumedColumns.value); },
    get rows() { return Math.max(TERMINAL_BOUNDS.minRows.value, output.rows ?? TERMINAL_BOUNDS.assumedRows.value); },
    draw(lines) {
      // Redraw only when something changed, so an idle TUI does not stream
      // escape sequences at the terminal.
      if (lines.length === previous.length && lines.every((line, index) => line === previous[index])) return;
      previous = [...lines];
      output.write(HOME + lines.join(NEWLINE));
    },
    onKeys(handler) {
      input.on("data", chunk => handler(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    },
    onResize(handler) { output.on("resize", handler); },
    repaint() {
      if (restored) return;
      previous = [];
      output.write(CURSOR_OFF + PASTE_ON + CURSOR_KEYS_NORMAL + CLEAR);
    },
    restore() {
      if (restored) return;
      restored = true;
      previous = [];
      try { if (input.isTTY) input.setRawMode(false); } catch { /* terminal already gone */ }
      input.pause();
      output.write(PASTE_OFF + CURSOR_ON + ALT_OFF);
    },
  };
  return terminal;
}
