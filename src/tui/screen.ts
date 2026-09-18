/** TUI-002: the only terminal owner. Raw mode, alternate screen and cursor
 * state live here so that every other TUI module stays pure and testable.
 * Restoring the terminal is unconditional: a crash must not leave the user
 * without an echo.
 */
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
  output.write(ALT_ON + CURSOR_OFF + CLEAR);
  const terminal: Terminal = {
    get columns() { return Math.max(20, output.columns ?? 80); },
    get rows() { return Math.max(6, output.rows ?? 24); },
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
      output.write(CURSOR_ON + ALT_OFF);
    },
  };
  return terminal;
}
