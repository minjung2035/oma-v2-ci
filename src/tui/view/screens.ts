/** TUI-007/012: the screens. Given state and already-collected data this module
 * returns the exact lines to draw. It performs no I/O and never invents a value:
 * an unknown observation stays unknown here (arch §23.5).
 *
 * Everything under `src/tui/view/` is presentation, and nothing outside it
 * decides how the product looks. Replacing the layout means replacing this
 * directory; the state machine, sources and transport do not change.
 */
import {
  CATEGORIES, categoryOf, cursorOf,
  type ConfigField, type Notice, type PanelData, type State,
} from "../model.js";
import { dashboardRows } from "./dashboard.js";
import { LAYOUT_BOUNDS } from "./layout.js";
import { noticeText } from "./notice.js";
import { applyLabel } from "./labels.js";
import { cellWidth, fit, pad, wrap } from "./text.js";



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
  readonly notice: Notice | null;
  /** The Principal is producing a reply. */
  readonly busy: boolean;
  readonly columns: number;
  readonly rows: number;
}

function frame(lines: string[], rows: number, columns: number): string[] {
  const out = lines.slice(0, rows).map(line => pad(line, columns));
  while (out.length < rows) out.push(" ".repeat(columns));
  return out;
}

function conversation(input: ViewInput, notice: string | null): string[] {
  const { columns, rows, transcript, state } = input;
  // A pasted draft is many lines, so the prompt is not one row. It takes at
  // most half the screen, showing its end -- where the next character lands --
  // so one paste can never push the conversation off the screen entirely.
  const draft = wrap(`> ${state.prompt.text.replace(/\n/g, "\n  ")}`, columns);
  const promptRows = Math.min(Math.max(draft.length, 1), Math.max(1, Math.floor(rows / 2)));
  const prompt = draft.slice(Math.max(0, draft.length - promptRows));
  const reserved = (notice === null ? 3 : 4) + promptRows - 1;
  const height = Math.max(1, rows - reserved);
  const wrapped: string[] = [];
  for (const entry of transcript) for (const line of wrap(entry, columns)) wrapped.push(line);
  const visible = wrapped.slice(Math.max(0, wrapped.length - height));
  const lines: string[] = [];
  while (lines.length < height - visible.length) lines.push("");
  for (const line of visible) lines.push(line);
  lines.push("─".repeat(Math.max(0, columns)));
  if (notice !== null) lines.push(fit(notice, columns));
  for (const line of prompt) lines.push(fit(line, columns));
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
  const labelWidth = Math.max(LAYOUT_BOUNDS.minLabelColumn.value,
    Math.min(LAYOUT_BOUNDS.labelColumn.value, Math.floor(columns / 2)));
  if (category === "dashboard") {
    const rows = dashboardRows(data.dashboard);
    // Label column follows the longest real label so a long unknown reason is
    // not clipped by padding that nothing uses.
    const width = rows.reduce((longest, row) => Math.max(longest, cellWidth(row.label)), 0) + 2;
    return rows.map(row => `  ${pad(row.label, width)}${row.value}`);
  }
  if (category === "config")
    return data.config.map((field, index) => {
      const marker = index === selected ? ">" : " ";
      const value = pad(fieldValue(field, state), LAYOUT_BOUNDS.valueColumn.value);
      // WP15: a blocked field says why instead of when it would apply.
      const scope = field.kind === "link" ? "" : field.blocked !== null ? `(${field.blocked})` : applyLabel(field.apply);
      return `${marker} ${pad(field.label, labelWidth)}${value}${scope}`;
    });
  // arch §23.5: what could not be read is said, never shown as no mail.
  const unreadable = data.mailUnreadable === null ? []
    : [fit(`  메일함 일부를 읽지 못함 (${data.mailUnreadable}) · 아래 목록이 전부가 아닐 수 있습니다`, columns)];
  if (data.mail.length === 0) return unreadable.length > 0 ? unreadable : ["  받은 메일이 없습니다."];
  return [...unreadable, fit("  ● Principal 세션에 아직 전달되지 않음 · 여기서 여는 것은 전달·확인이 아닙니다", columns), ...data.mail.map((row, index) => {
    const marker = index === selected ? ">" : " ";
    const flag = row.unread ? "●" : " ";
    return `${marker}${flag} ${pad(row.from, LAYOUT_BOUNDS.senderColumn.value)}${pad(row.kind, LAYOUT_BOUNDS.kindColumn.value)}${row.subject}`;
  })];
}

function extensionsScreen(input: ViewInput, notice: string | null): string[] {
  const { state, data, columns } = input;
  const detail = state.detail;
  const row = detail.kind === "extensions" ? detail.row : 0;
  const column = detail.kind === "extensions" ? detail.column : 0;
  const labelOf = (id: string, locked: boolean, missing = false): string => `${id}${locked ? " (고정)" : ""}${missing ? " (파일 없음)" : ""}`;
  // Width follows the longest real name so an id is not silently clipped, but
  // still leaves room for both role columns.
  const longest = data.extensions.reduce((width, extension) =>
    Math.max(width, cellWidth(labelOf(extension.id, extension.locked, extension.missing))), 0);
  const nameWidth = Math.max(LAYOUT_BOUNDS.minNameColumn.value,
    Math.min(longest + 2, Math.max(LAYOUT_BOUNDS.minNameColumn.value, columns - LAYOUT_BOUNDS.roleColumns.value)));
  const lines = ["EXTENSIONS", "", `  ${pad("", nameWidth)}Principal   Workers`, ""];
  data.extensions.forEach((extension, index) => {
    const marker = index === row ? ">" : " ";
    const principal = `[${extension.principal ? "x" : " "}]`;
    const workers = `[${extension.workers ? "x" : " "}]`;
    const left = index === row && column === 0 ? `<${principal}>` : ` ${principal} `;
    const right = index === row && column === 1 ? `<${workers}>` : ` ${workers} `;
    lines.push(`${marker} ${pad(labelOf(extension.id, extension.locked, extension.missing), nameWidth)}${pad(left, 12)}${right}`);
  });
  lines.push("");
  if (notice !== null) lines.push(fit(notice, columns));
  lines.push("  Enter 전환 · ←/→ 대상 · Esc 뒤로");
  return lines;
}

function mailDetail(input: ViewInput, notice: string | null): string[] {
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
  if (notice !== null) lines.push(fit(notice, columns));
  lines.push("  ↑/↓ 이동 · Esc 뒤로");
  return lines;
}

export function render(input: ViewInput): string[] {
  const { state, columns, rows } = input;
  const notice = noticeText(input.notice, input.busy);
  if (!state.open) return conversation(input, notice);
  const detail = state.detail;
  if (detail.kind === "extensions") return frame(extensionsScreen(input, notice), rows, columns);
  if (detail.kind === "mail") return frame(mailDetail(input, notice), rows, columns);
  const lines = header(state, columns);
  for (const line of rowsFor(input)) lines.push(line);
  lines.push("");
  if (notice !== null) lines.push(fit(notice, columns));
  lines.push(fit("←/→ 카테고리 · ↑/↓ 항목 · Enter 선택 · Esc 뒤로 · Ctrl+X 닫기", columns));
  return frame(lines, rows, columns);
}
