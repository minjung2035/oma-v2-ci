/** TUI-007/012: pure presentation. Given state and already-collected data this
 * module returns the exact lines to draw. It performs no I/O and never invents
 * a value: an unknown observation stays unknown here (arch §23.5).
 */
import {
  CATEGORIES, categoryOf, cursorOf,
  type ConfigField, type PanelData, type State, type ApplyScope,
} from "./model.js";
import { PANEL_BOUNDS } from "./limits.js";
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

const APPLY_LABEL: Readonly<Record<ApplyScope, string>> = Object.freeze({
  immediate: "즉시 적용",
  "next-activation": "다음 worker 활성화부터",
  "next-session": "다음 세션부터",
  restart: "재시작 후",
  "bootstrap-only": "bootstrap 전용",
});

export function applyLabel(scope: ApplyScope): string { return APPLY_LABEL[scope]; }

function fieldValue(field: ConfigField, state: State): string {
  if (field.kind === "link") return ">";
  const edit = state.edit;
  if (field.kind === "choice") {
    if (edit.kind === "choice" && edit.field === field.id)
      return `[ ${field.options[edit.index] ?? field.value} ]`;
    return field.value;
  }
  if (edit.kind === "number" && edit.field === field.id) return `[ ${edit.draft}_ ]`;
  return String(field.value);
}

export interface ViewInput {
  readonly state: State;
  readonly data: PanelData;
  readonly transcript: readonly string[];
  readonly body: string | null;
  readonly notice: string | null;
  readonly columns: number;
  readonly rows: number;
}

function frame(lines: string[], rows: number, columns: number): string[] {
  const out = lines.slice(0, rows).map(line => pad(line, columns));
  while (out.length < rows) out.push(" ".repeat(columns));
  return out;
}

function conversation(input: ViewInput): string[] {
  const { columns, rows, transcript, state, notice } = input;
  const reserved = notice === null ? 3 : 4;
  const height = Math.max(1, rows - reserved);
  const wrapped: string[] = [];
  for (const entry of transcript) for (const line of wrap(entry, columns)) wrapped.push(line);
  const visible = wrapped.slice(Math.max(0, wrapped.length - height));
  const lines: string[] = [];
  while (lines.length < height - visible.length) lines.push("");
  for (const line of visible) lines.push(line);
  lines.push("─".repeat(Math.max(0, columns)));
  if (notice !== null) lines.push(fit(notice, columns));
  lines.push(fit(`> ${state.prompt}`, columns));
  lines.push(fit("Ctrl+X 관리 화면 · Ctrl+C 종료", columns));
  return frame(lines, rows, columns);
}

function header(state: State, columns: number): string[] {
  const tabs = CATEGORIES.map(category => {
    const label = category === "dashboard" ? "Dashboard" : category === "config" ? "Config" : "Mail";
    return categoryOf(state) === category ? `[${label}]` : ` ${label} `;
  }).join(" ");
  return [fit(tabs, columns), "─".repeat(Math.max(0, columns))];
}

function rowsFor(input: ViewInput): string[] {
  const { state, data, columns } = input;
  const category = categoryOf(state);
  const selected = cursorOf(state, data);
  const labelWidth = Math.max(PANEL_BOUNDS.minLabelColumn.value,
    Math.min(PANEL_BOUNDS.labelColumn.value, Math.floor(columns / 2)));
  if (category === "dashboard") {
    // Label column follows the longest real label so a long unknown reason is
    // not clipped by padding that nothing uses.
    const width = data.dashboard.reduce((longest, line) => Math.max(longest, cellWidth(line.label)), 0) + 2;
    return data.dashboard.map(line => `  ${pad(line.label, width)}${line.value}`);
  }
  if (category === "config")
    return data.config.map((field, index) => {
      const marker = index === selected ? ">" : " ";
      const value = pad(fieldValue(field, state), PANEL_BOUNDS.valueColumn.value);
      const scope = field.kind === "link" ? "" : applyLabel(field.apply);
      return `${marker} ${pad(field.label, labelWidth)}${value}${scope}`;
    });
  if (data.mail.length === 0) return ["  받은 메일이 없습니다."];
  return data.mail.map((row, index) => {
    const marker = index === selected ? ">" : " ";
    const flag = row.unread ? "●" : " ";
    return `${marker}${flag} ${pad(row.from, PANEL_BOUNDS.senderColumn.value)}${pad(row.kind, PANEL_BOUNDS.kindColumn.value)}${row.subject}`;
  });
}

function extensionsScreen(input: ViewInput): string[] {
  const { state, data, columns } = input;
  const detail = state.detail;
  const row = detail.kind === "extensions" ? detail.row : 0;
  const column = detail.kind === "extensions" ? detail.column : 0;
  const labelOf = (id: string, locked: boolean): string => `${id}${locked ? " (고정)" : ""}`;
  // Width follows the longest real name so an id is not silently clipped, but
  // still leaves room for both role columns.
  const longest = data.extensions.reduce((width, extension) =>
    Math.max(width, cellWidth(labelOf(extension.id, extension.locked))), 0);
  const nameWidth = Math.max(PANEL_BOUNDS.minNameColumn.value,
    Math.min(longest + 2, Math.max(PANEL_BOUNDS.minNameColumn.value, columns - PANEL_BOUNDS.roleColumns.value)));
  const lines = ["EXTENSIONS", "", `  ${pad("", nameWidth)}Principal   Workers`, ""];
  data.extensions.forEach((extension, index) => {
    const marker = index === row ? ">" : " ";
    const principal = `[${extension.principal ? "x" : " "}]`;
    const workers = `[${extension.workers ? "x" : " "}]`;
    const left = index === row && column === 0 ? `<${principal}>` : ` ${principal} `;
    const right = index === row && column === 1 ? `<${workers}>` : ` ${workers} `;
    lines.push(`${marker} ${pad(labelOf(extension.id, extension.locked), nameWidth)}${pad(left, 12)}${right}`);
  });
  lines.push("");
  if (input.notice !== null) lines.push(fit(input.notice, columns));
  lines.push("  Enter 전환 · ←/→ 대상 · Esc 뒤로");
  return lines;
}

function mailDetail(input: ViewInput): string[] {
  const { state, data, body, columns } = input;
  const detail = state.detail;
  const row = detail.kind === "mail" ? detail.row : 0;
  const message = data.mail[row];
  if (!message) return ["메일을 찾을 수 없습니다.", "", "  Esc 뒤로"];
  const lines = [
    `From: ${message.from}`,
    `Kind: ${message.kind}`,
    `Subject: ${message.subject}`,
    `Path: ${message.path}`,
    "─".repeat(Math.max(0, columns)),
  ];
  for (const line of wrap(body ?? "(본문을 읽을 수 없습니다)", columns)) lines.push(line);
  lines.push("");
  if (input.notice !== null) lines.push(fit(input.notice, columns));
  lines.push("  ↑/↓ 이동 · Esc 뒤로");
  return lines;
}

export function render(input: ViewInput): string[] {
  const { state, columns, rows } = input;
  if (!state.open) return conversation(input);
  const detail = state.detail;
  if (detail.kind === "extensions") return frame(extensionsScreen(input), rows, columns);
  if (detail.kind === "mail") return frame(mailDetail(input), rows, columns);
  const lines = header(state, columns);
  for (const line of rowsFor(input)) lines.push(line);
  lines.push("");
  if (input.notice !== null) lines.push(fit(input.notice, columns));
  lines.push(fit("←/→ 카테고리 · ↑/↓ 항목 · Enter 선택 · Esc 뒤로 · Ctrl+X 닫기", columns));
  return frame(lines, rows, columns);
}
