/** One terminal owner: the host fallback or the interactive child, never both.
 * Nothing owns it at first: the engine's own screen is what a start shows, so
 * this process draws nothing until the engine takes the terminal or this
 * process has to show its own screen instead (reclaim). */
import { openTerminal, restoreTerminalModes, type Terminal, type TerminalStreams } from "./screen.js";
import type { PiEvent } from "@oma/protocol/jsonl";
import { TERMINAL_BOUNDS } from "@oma/domain/surface-bounds";

export class PanelTerminal implements Terminal {
  private local: Terminal | null;
  private remote: ((event: PiEvent) => void) | null = null;
  private keys: ((chunk: Uint8Array) => void) | undefined;
  private resize: (() => void) | undefined;
  private width = TERMINAL_BOUNDS.assumedColumns.value;
  private height = TERMINAL_BOUNDS.assumedRows.value;
  private panelOpen = false;
  /** Whether anything has taken the terminal: the engine or this process. */
  private used = false;
  private restored = false;
  private startup: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly streams: TerminalStreams, private readonly isOpen: () => boolean) {
    this.local = null;
  }
  /** A start that has not reached the engine's screen within its budget shows
   * this process's own screen, so a slow or failing start is not a blank one. */
  whenUnclaimed(show: () => void): void {
    this.cancelStartup();
    if (this.restored || this.used) return;
    const timer = setTimeout(() => {
      if (this.startup !== timer || this.restored || this.used) return;
      this.startup = null;
      this.reclaim(); show();
    }, TERMINAL_BOUNDS.startupScreenMs.value);
    this.startup = timer;
    timer.unref();
  }
  private cancelStartup(): void {
    if (this.startup !== null) clearTimeout(this.startup);
    this.startup = null;
  }
  get columns(): number { return this.local?.columns ?? this.width; }
  get rows(): number { return this.local?.rows ?? this.height; }
  onKeys(handler: (chunk: Uint8Array) => void): void { if (this.restored) return; this.keys = handler; this.local?.onKeys(handler); }
  onResize(handler: () => void): void { if (this.restored) return; this.resize = handler; this.local?.onResize(handler); }
  repaint(): void { this.local?.repaint(); }
  draw(lines: readonly string[]): void {
    if (this.restored) return;
    if (this.local) this.local.draw(lines);
    else if (this.panelOpen) {
      const open = this.isOpen();
      this.remote?.({ type: "panel_frame", open, lines: open ? [...lines] : [] });
      if (!open) this.panelOpen = false;
    }
  }
  handoff(send: (event: PiEvent) => void): void {
    if (this.restored) return;
    this.cancelStartup();
    this.used = true;
    this.local?.restore();
    this.local = null;
    this.remote = send;
  }
  size(event: PiEvent): void {
    if (this.restored) return;
    const { columns, rows } = event;
    if (typeof columns !== "number" || typeof rows !== "number" ||
        !Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)) return;
    // Use the real tty's dimensions as the ceiling, not a peer's allocation request.
    this.width = Math.max(TERMINAL_BOUNDS.minColumns.value,
      Math.min(columns, this.streams.output.columns ?? TERMINAL_BOUNDS.assumedColumns.value));
    this.height = Math.max(TERMINAL_BOUNDS.minRows.value,
      Math.min(rows, this.streams.output.rows ?? TERMINAL_BOUNDS.assumedRows.value));
  }
  open(event: PiEvent): void { if (this.restored) return; this.size(event); this.panelOpen = true; }
  /** Called only after the child has been reaped (or spawn never happened). */
  reclaim(): void {
    if (this.restored) return;
    this.cancelStartup();
    if (this.local) return;
    this.used = true;
    this.remote = null;
    this.panelOpen = false;
    const local = openTerminal(this.streams);
    this.local = local;
    try {
      if (this.keys) local.onKeys(this.keys);
      if (this.resize) local.onResize(this.resize);
    } catch (error) {
      this.local = null;
      try { local.restore(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "panel setup and cleanup failed"); }
      throw error;
    }
  }
  restore(): void {
    if (this.restored) return;
    this.restored = true;
    this.cancelStartup();
    this.remote = null;
    this.panelOpen = false;
    this.keys = undefined; this.resize = undefined;
    const local = this.local;
    this.local = null;
    if (local) local.restore();
    else if (this.used) {
      // After the child has ended, also covers a forced kill with no cleanup.
      restoreTerminalModes(this.streams, true);
    }
  }
}
