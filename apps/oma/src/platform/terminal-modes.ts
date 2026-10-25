/** The few DEC private modes a terminal program sets that a screen must be
 * told again when it attaches (the guest's session holder, macos-platform
 * §4.6) and undone when it leaves (the Mac's attach client, MAC-222). */
const ESC = "\u001b";

/** P0V-109 (G12-05): the DEC private modes followed, each with the state a
 * terminal starts in. A program that leaves one changed -- mouse reporting,
 * application cursor keys, a synchronized update -- would leave the Human's
 * own terminal reading clicks as keys or drawing nothing; the list is what a
 * screen is told again when it attaches and put back when it leaves. The
 * alternate screen's three spellings are one mode. */
const FOLLOWED: ReadonlyMap<string, boolean> = new Map([
  ["1", false],     // application cursor keys (DECCKM)
  ["7", true],      // autowrap (DECAWM)
  ["1000", false], ["1002", false], ["1003", false], // mouse reporting
  ["1004", false],  // focus reporting
  ["1005", false], ["1006", false], ["1015", false], // mouse encodings
  ["2004", false],  // bracketed paste
  ["2026", false],  // synchronized output
  ["25", true],     // cursor visible (DECTCEM)
  ["1049", false],  // alternate screen (1047 and 47 are read as it)
]);
const ALTERNATE = "1049";

/** The DEC private modes a newly attached screen needs back. Only these are
 * followed; the screen's contents are the program's to redraw. */
export class TerminalModes {
  private readonly state = new Map(FOLLOWED);
  /** An escape sequence cut by a read boundary, kept for the next chunk. */
  private tail = "";

  feed(chunk: Uint8Array): void {
    // latin1 maps each byte to one code unit, so escape bytes stay where they are.
    const text = this.tail + Buffer.from(chunk).toString("latin1");
    for (const match of text.matchAll(/\u001b\[\?([0-9;]+)([hl])/g)) {
      const on = match[2] === "h";
      for (const raw of match[1]!.split(";")) {
        const mode = raw === "1047" || raw === "47" ? ALTERNATE : raw;
        if (FOLLOWED.has(mode)) this.state.set(mode, on);
      }
    }
    const partial = /\u001b(?:\[(?:\?[0-9;]*)?)?$/.exec(text);
    this.tail = partial === null ? "" : partial[0].slice(-32);
  }

  private changed(): string[] {
    return [...FOLLOWED].filter(([mode, initial]) => this.state.get(mode) !== initial).map(([mode]) => mode);
  }
  /** What a screen that attaches now must be told: the alternate screen
   * first, then the rest as they are now. */
  replay(): string {
    const modes = this.changed();
    const set = (mode: string): string => `${ESC}[?${mode}${this.state.get(mode) ? "h" : "l"}`;
    return (modes.includes(ALTERNATE) ? set(ALTERNATE) : "") + modes.filter(mode => mode !== ALTERNATE).map(set).join("");
  }
  /** What a screen that leaves now must be told to be as it was: every mode
   * back to how a terminal starts, the alternate screen last. */
  undo(): string {
    const modes = this.changed();
    const reset = (mode: string): string => `${ESC}[?${mode}${FOLLOWED.get(mode) ? "h" : "l"}`;
    return modes.filter(mode => mode !== ALTERNATE).map(reset).join("") + (modes.includes(ALTERNATE) ? reset(ALTERNATE) : "");
  }
}
