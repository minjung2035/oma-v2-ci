/** Width, fitting and wrapping for terminal cells. The only module on the
 * product surface that imports the engine's terminal library (TUI-020).
 */
import { visibleWidth } from "@earendil-works/pi-tui";

/** Measurement comes from the engine's terminal library, layout does not.
 *
 * `visibleWidth` is grapheme-aware, so it gets ZWJ emoji, skin-tone sequences
 * and combining marks right where a hand-rolled code-point table silently
 * misaligns every column that follows. That is pure arithmetic and is worth
 * sharing.
 *
 * Fitting and wrapping stay here. The engine's versions carry its own
 * presentation choices, including ANSI styling it emits around a cut, and this
 * product owns its layout. Borrowing the arithmetic must not import a design.
 */
export const cellWidth = visibleWidth;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Iterating graphemes rather than code points is what keeps a cut from
 * splitting an emoji sequence in half. */
function clusters(text: string): string[] {
  return [...graphemes.segment(text)].map(entry => entry.segment);
}

export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  let out = "";
  let used = 0;
  for (const cluster of clusters(text)) {
    const size = cellWidth(cluster);
    if (size === 0) continue;
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
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) { lines.push(""); continue; }
    let line = "";
    let used = 0;
    for (const cluster of clusters(paragraph)) {
      const size = cellWidth(cluster);
      if (size === 0) continue;
      if (used + size > width) { lines.push(line); line = ""; used = 0; }
      line += cluster;
      used += size;
    }
    lines.push(line);
  }
  return lines;
}
