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
  output.write(ALT_ON + CURSOR_OFF + PASTE_ON + CLEAR);
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
