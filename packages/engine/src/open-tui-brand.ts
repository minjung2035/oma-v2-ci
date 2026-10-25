/** Open TUI's own header and footer, told that this is oma. The upstream
 * components render as they ship; only their finished lines are rewritten:
 * the header title names oma and its version, the logo is oma's own, the
 * welcome names the society this window uses, the path is the Human's project
 * rather than the Principal's private workspace (the engine's working
 * directory, shown by upstream as `~` because that workspace is the engine's
 * HOME), and the command tips name Ctrl+X. Every rewrite keeps the line's
 * width, so the box and the footer columns stay where upstream put them. */
import { visibleWidth as cellWidth } from "@earendil-works/pi-tui";

import type { OpenTuiBrand } from "@oma/contracts/presentation";


/** oma's mark: O, M and A drawn with half blocks, so each pixel is square on a
 * terminal cell and the corners round. Its own drawing, not upstream's. */
export const OMA_LOGO = Object.freeze([
  " ▄████▄   ██▄    ▄██   ▄████▄ ",
  "██    ██  ██▀█▄▄█▀██  ██    ██",
  "██    ██  ██  ▀▀  ██  ████████",
  "██    ██  ██      ██  ██    ██",
  " ▀████▀   ██      ██  ██    ██",
]);

const SGR = "(?:\\x1b\\[[0-9;]*m)*";
const plain = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, "");
const LEADING_SGR = new RegExp(`^${SGR}`);
const TRAILING_SGR = new RegExp(`${SGR}$`);
/** NB-11: truncation is by grapheme cluster, so a cut never leaves half a
 * surrogate pair or half an emoji sequence on screen. */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `line` with the text between its first box border and the next rule
 * replaced by `text`, centered in that span's width. */
function replaceLeftColumn(line: string, text: string): string {
  const first = line.indexOf("│");
  const second = first < 0 ? -1 : line.indexOf("│", first + 1);
  if (second < 0) return line;
  const start = first + 1 + LEADING_SGR.exec(line.slice(first + 1))![0].length;
  const end = start + line.slice(start, second).replace(TRAILING_SGR, "").length;
  const width = cellWidth(line.slice(start, end));
  const left = Math.max(0, Math.floor((width - cellWidth(text)) / 2));
  return `${line.slice(0, start)}${" ".repeat(left)}${text}${" ".repeat(Math.max(0, width - left - cellWidth(text)))}${line.slice(end)}`;
}
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `line` with the visible `from` (the first one at or after `start`)
 * replaced by `to`, the width difference taken from or given to the spaces
 * beside it: after it, or split around it when `centered`. */
export function swapText(line: string, from: string, to: string, centered = false, start = 0): string {
  const at = line.indexOf(from, start);
  if (at < 0) return line;
  const before = line.slice(0, at);
  const after = line.slice(at + from.length);
  const lead = new RegExp(`( *)(${SGR})$`).exec(before)!;
  const trail = new RegExp(`^(${SGR})( *)`).exec(after)!;
  const room = trail[2]!.length + (centered ? lead[1]!.length : 0);
  // One space must stay, or the text would touch what follows it.
  const width = cellWidth(from) + room - 1;
  let text = to;
  if (cellWidth(text) > width) {
    let cut = "";
    for (const entry of graphemes.segment(text)) {
      if (cellWidth(`${cut}${entry.segment}…`) > width) break;
      cut += entry.segment;
    }
    text = cut.length === 0 ? from : `${cut}…`;
  }
  const delta = cellWidth(text) - cellWidth(from);
  let leadSpaces = lead[1]!.length;
  let trailSpaces = trail[2]!.length;
  if (centered) {
    const total = leadSpaces + trailSpaces - delta;
    leadSpaces = Math.floor(total / 2);
    trailSpaces = total - leadSpaces;
  } else trailSpaces -= delta;
  return `${before.slice(0, before.length - lead[0].length)}${" ".repeat(leadSpaces)}${lead[2]}${text}` +
    `${trail[1]}${" ".repeat(trailSpaces)}${after.slice(trail[0].length)}`;
}

export function brandHeader(lines: readonly string[], brand: OpenTuiBrand, paint: (text: string) => string = text => text): string[] {
  const out = [...lines];
  if (out.length === 0) return out;
  // The logo rows are the ones above upstream's tagline, in the left column.
  const tagline = out.findIndex(line => plain(line).split("│")[1]?.trim() === "Let's build something great");
  if (tagline > 1) {
    const rows = tagline - 1;
    const span = cellWidth(plain(out[1]!).split("│")[1] ?? "");
    const logo: readonly string[] = span >= OMA_LOGO[0]!.length + 2 && rows >= OMA_LOGO.length ? OMA_LOGO : ["oma"];
    const top = 1 + Math.floor((rows - logo.length) / 2);
    for (let row = 0; row < rows; row += 1) {
      const mark = logo[row - (top - 1)];
      out[1 + row] = replaceLeftColumn(out[1 + row]!, mark === undefined ? "" : paint(mark));
    }
  }
  if (tagline >= 0)
    out[tagline] = swapText(out[tagline]!, "Let's build something great", "Your ideas, in motion", true);
  // The title sits in the top border, followed by that border's fill: a
  // longer title takes from the fill, a shorter one gives it back.
  const title = new RegExp(`Pi(${SGR}) v${escape(brand.engineVersion)}`);
  const top = out[0]!;
  if (title.test(top)) {
    const named = top.replace(title, `${brand.title}$1 v${brand.version}`);
    const delta = cellWidth(named) - cellWidth(top);
    out[0] = delta === 0 ? named : named.replace(/─{2,}(?=[^─]*$)/, run =>
      "─".repeat(Math.max(1, run.length - delta)));
  }
  for (let index = 1; index < out.length; index += 1) {
    const columns = plain(out[index]!).split("│");
    // The working-directory line: `~` alone in the left column.
    if (columns[1]?.trim() === "~") {
      const at = out[index]!.search(/(?<=m)~(?=\x1b\[)/);
      if (at >= 0) out[index] = swapText(out[index]!, "~", brand.project, true, at);
    }
  }
  // The welcome names the society this window uses: with several windows on
  // one project, each has its own.
  for (let index = 1; index < out.length; index += 1) {
    const tips = plain(out[index]!).split("│")[2]?.trim();
    const divider = out[index]!.indexOf("│", out[index]!.indexOf("│") + 1);
    if (tips === "Welcome") out[index] = swapText(out[index]!, "Welcome", brand.mode ?? "Society", false, divider);
    else if (tips === "Ask Pi anything") out[index] = swapText(out[index]!, "Ask Pi anything", brand.society, false, divider);
  }
  // The last of the four command tips names oma's key instead. Upstream may
  // truncate that command's name when an extension added one, so the cell is
  // rewritten by position rather than by matching its text.
  const tips = out.map(line => plain(line).split("│")).findIndex(columns => columns[2]?.trim() === "Commands");
  const last = tips < 0 ? -1 : tips + 4;
  if (last > 0 && last < out.length && plain(out[last]!).split("│")[2]?.trim())
    out[last] = replaceColumn(out[last]!, 2, ` ${brand.tip}`);
  return out;
}

/** `line` with the visible content of its `n`th `│`-delimited cell replaced by
 * `text`, left-aligned in the same span. ANSI inside the cell is dropped; the
 * borders and what lies outside the cell are byte-identical. */
function replaceColumn(line: string, n: number, text: string): string {
  let first = -1;
  for (let index = 0; index < n; index += 1) {
    first = line.indexOf("│", first + 1);
    if (first < 0) return line;
  }
  const second = line.indexOf("│", first + 1);
  if (second < 0) return line;
  const start = first + 1 + LEADING_SGR.exec(line.slice(first + 1))![0].length;
  const end = start + line.slice(start, second).replace(TRAILING_SGR, "").length;
  const inner = line.slice(start, end);
  const width = cellWidth(inner);
  let visible = text;
  if (cellWidth(visible) > width) {
    // Grapheme-aware like swapText: a code-unit cut can split a surrogate
    // pair or an emoji sequence and print a lone `�`.
    let cut = "";
    for (const entry of graphemes.segment(visible)) {
      if (cellWidth(`${cut}${entry.segment}…`) > width) break;
      cut += entry.segment;
    }
    visible = cut.length === 0 ? "" : `${cut}…`;
  }
  // Keep the color the cell's text wore: its first SGR, closed after the tip.
  const paint = /\x1b\[[0-9;]*m/.exec(inner)?.[0] ?? "";
  const body = paint.length > 0 ? `${paint}${visible}\x1b[39m` : visible;
  return `${line.slice(0, start)}${body}${" ".repeat(Math.max(0, width - cellWidth(visible)))}${line.slice(end)}`;
}

/** The footer's working-directory segment names the project. What the longer
 * text needs comes from the widest gap between the footer's groups. */
export function brandFooter(lines: readonly string[], brand: OpenTuiBrand): string[] {
  return lines.map((line, index) => {
    const at = line.search(/(?<=m)~(?=\x1b\[)/);
    if (index !== 0 || at < 0) return line;
    // NB-12: the gap must sit after the `~`; the widest one before it gives
    // no room, so only gaps past the marker are candidates.
    const gap = [...line.matchAll(/ {2,}/g)].reduce<RegExpMatchArray | null>((wide, match) =>
      match.index! > at && (wide === null || match[0].length > wide[0].length) ? match : wide, null);
    const room = gap === null ? 0 : gap[0].length - 1;
    let text = brand.project;
    if (cellWidth(text) - 1 > room) text = text.split("/").filter(Boolean).at(-1) ?? text;
    const delta = cellWidth(text) - 1;
    if (gap === null || delta > room) return line;
    const shrunk = line.slice(0, gap.index!) + " ".repeat(gap[0].length - delta) + line.slice(gap.index! + gap[0].length);
    return shrunk.slice(0, at) + text + shrunk.slice(at + 1);
  });
}
