/** The few DEC private modes a terminal program sets that a screen must be
 * told again when it attaches (the guest's session holder, macos-platform
 * §4.6) and undone when it leaves (the Mac's attach client, MAC-222). */
const ESC = "\u001b";

/** The DEC private modes a newly attached screen needs back. Only these are
 * followed; the screen's contents are the program's to redraw. */
export class TerminalModes {
  private alternate = false;
  private paste = false;
  private cursorHidden = false;
  /** An escape sequence cut by a read boundary, kept for the next chunk. */
  private tail = "";

  feed(chunk: Uint8Array): void {
    // latin1 maps each byte to one code unit, so escape bytes stay where they are.
    const text = this.tail + Buffer.from(chunk).toString("latin1");
    for (const match of text.matchAll(/\u001b\[\?([0-9;]+)([hl])/g)) {
      const on = match[2] === "h";
      for (const mode of match[1]!.split(";")) {
        if (mode === "1049" || mode === "1047" || mode === "47") this.alternate = on;
        else if (mode === "2004") this.paste = on;
        else if (mode === "25") this.cursorHidden = !on;
      }
    }
    const partial = /\u001b(?:\[(?:\?[0-9;]*)?)?$/.exec(text);
    this.tail = partial === null ? "" : partial[0].slice(-32);
  }

  /** What a screen that attaches now must be told. */
  replay(): string {
    return (this.alternate ? `${ESC}[?1049h` : "") + (this.paste ? `${ESC}[?2004h` : "") + (this.cursorHidden ? `${ESC}[?25l` : "");
  }
  /** What a screen that leaves now must be told to be as it was. */
  undo(): string {
    return (this.paste ? `${ESC}[?2004l` : "") + (this.cursorHidden ? `${ESC}[?25h` : "") + (this.alternate ? `${ESC}[?1049l` : "");
  }
}
