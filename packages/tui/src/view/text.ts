/** Width, fitting and wrapping for terminal cells (TUI-020).
 */
import { cellWidth } from "../cells.js";
import { UNSEEN } from "@oma/domain/unseen-text";

/** Measurement comes from the engine's terminal library (cells.ts), layout
 * does not. Fitting and wrapping stay here. The engine's versions carry its
 * own presentation choices, including ANSI styling it emits around a cut, and
 * this product owns its layout. Borrowing the arithmetic must not import a
 * design. */
export { cellWidth };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** A tab as spaces, because a tab written to a terminal moves to the
 * terminal's next tab stop, which this module cannot see: the cell arithmetic
 * every other line is padded by would then disagree with the screen from that
 * column on. */
const TAB = "    ";

/** What may be written to a cell.
 *
 * Control bytes never reach the terminal: an escape sequence in produced text
 * or in a paste would be read by the terminal as an instruction -- move the
 * cursor, change colour, start a paste -- and this product owns its frame.
 * P0V-108: nor do the format characters that reorder or hide letters (a mail
 * subject that reads backwards, a token hidden between visible ones); what
 * the Human sees is what the text says. The set is the domain's one
 * definition (`UNSEEN`), which the paste reading shares.
 */
export function displayable(text: string): string {
  return text.replace(/\t/g, TAB).replace(UNSEEN, "");
}

/** Iterating graphemes rather than code points is what keeps a cut from
 * splitting an emoji sequence in half. */
function clusters(text: string): string[] {
  return [...graphemes.segment(text)].map(entry => entry.segment);
}

export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const cluster of clusters(displayable(text))) {
    const size = cellWidth(cluster);
    // G11-02: a cluster of no width (a mark with nothing to sit on) is part
    // of the text; it takes no cell and is kept.
    if (used + size > width) return out;
    out += cluster;
    used += size;
  }
  return out;
}

export function pad(text: string, width: number): string {
  const clipped = fit(text, width);
  return clipped + " ".repeat(Math.max(0, width - cellWidth(clipped)));
}

export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  // Line breaks are read before control bytes are dropped: a produced line
  // that contains them is several lines, not one line with them removed.
  for (const raw of text.split("\n")) {
    const paragraph = displayable(raw);
    if (paragraph.length === 0) { lines.push(""); continue; }
    let line = "";
    let used = 0;
    for (const cluster of clusters(paragraph)) {
      const size = cellWidth(cluster);
      // NB-14: a cluster wider than the line wraps only what precedes it --
      // pushing `line` when nothing of width is on it would emit a blank row.
      if (size > 0 && used > 0 && used + size > width) { lines.push(line); line = ""; used = 0; }
      line += cluster;
      used += size;
    }
    lines.push(line);
  }
  return lines;
}
