/** TUI-007/012: the screens. Given state and already-collected data this module
 * returns the exact lines to draw. It performs no I/O and never invents a value:
 * an unknown observation stays unknown here (arch §23.5).
 *
 * Everything under `src/tui/view/` is presentation, and nothing outside it
 * decides how the product looks. Replacing the layout means replacing this
 * directory; the state machine, sources and transport do not change.
 */
import {
  CATEGORIES, categoryOf, cursorOf, mailIdentity,
  type ConfigField, type MailBody, type Notice, type PanelData, type State,
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
  readonly body: MailBody | null;
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

/** P0V-40: the part of a list that fits `height` rows, placed so that the
 * selected row is on screen. Drawing a list from its top whatever was selected
 * moved the selection off a small screen with nothing saying where it went. */
function windowed(lines: readonly string[], selected: number | null, height: number): string[] {
  const fits = Math.max(1, height);
  if (lines.length <= fits) return [...lines];
  const start = selected === null ? 0 : Math.min(Math.max(0, selected - fits + 1), lines.length - fits);
  return lines.slice(start, start + fits);
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

/** The panel's lines: `fixed` ones always shown above `rows`, the list the
 * selection moves through. */
function rowsFor(input: ViewInput): { readonly fixed: string[]; readonly rows: string[]; readonly selected: number | null } {
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
    return { fixed: rows.map(row => `  ${pad(row.label, width)}${row.value}`), rows: [], selected: null };
  }
  if (category === "config")
    return { fixed: [], selected, rows: data.config.map((field, index) => {
      const marker = index === selected ? ">" : " ";
      const value = pad(fieldValue(field, state), LAYOUT_BOUNDS.valueColumn.value);
      // WP15: a blocked field says why instead of when it would apply.
      const scope = field.kind === "link" ? "" : field.blocked !== null ? `(${field.blocked})` : applyLabel(field.apply);
      return `${marker} ${pad(field.label, labelWidth)}${value}${scope}`;
    }) };
  // arch §23.5: what could not be read is said, never shown as no mail.
  const unreadable = data.mailUnreadable === null ? []
    : [fit(`  메일함 일부를 읽지 못함 (${data.mailUnreadable}) · 아래 목록이 전부가 아닐 수 있습니다`, columns)];
  // P0V-43: older messages counted but not listed are said, not hidden.
  const omitted = data.mailOmitted === 0 ? []
    : [fit(`  최근 ${data.mail.length}통만 표시 · 오래된 ${data.mailOmitted}통은 이번에 읽지 않음`, columns)];
  if (data.mail.length === 0)
    return { fixed: unreadable.length + omitted.length > 0 ? [...unreadable, ...omitted] : ["  받은 메일이 없습니다."], rows: [], selected: null };
  return { fixed: [...unreadable, ...omitted, fit("  ● Principal 세션에 아직 전달되지 않음 · 여기서 여는 것은 전달·확인이 아닙니다", columns)],
    selected, rows: data.mail.map((row, index) => {
      const marker = index === selected ? ">" : " ";
      const flag = row.unread ? "●" : " ";
      return `${marker}${flag} ${pad(row.from, LAYOUT_BOUNDS.senderColumn.value)}${pad(row.kind, LAYOUT_BOUNDS.kindColumn.value)}${row.subject}`;
    }) };
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
  const entries = data.extensions.map((extension, index) => {
    const marker = index === row ? ">" : " ";
    const principal = `[${extension.principal ? "x" : " "}]`;
    const workers = `[${extension.workers ? "x" : " "}]`;
    const left = index === row && column === 0 ? `<${principal}>` : ` ${principal} `;
    const right = index === row && column === 1 ? `<${workers}>` : ` ${workers} `;
    return `${marker} ${pad(labelOf(extension.id, extension.locked, extension.missing), nameWidth)}${pad(left, 12)}${right}`;
  });
  const footer = ["", ...(notice === null ? [] : [fit(notice, columns)]), "  Enter 전환 · ←/→ 대상 · Esc 뒤로"];
  return [...lines, ...windowed(entries, row, input.rows - lines.length - footer.length), ...footer];
}

/** The open message's screen as three parts, so the body gets what the head
 * and the foot leave (P0V-40) and says when it is only part of the message
 * (P0V-42). */
function mailDetailParts(input: ViewInput, notice: string | null) {
  const { state, data, body, columns } = input;
  const detail = state.detail;
  const message = detail.kind === "mail" ? data.mail.find(row => mailIdentity(row) === detail.id) : undefined;
  if (!message) return null;
  const head = [
    `From: ${message.from}`,
    `Kind: ${message.kind}`,
    `Subject: ${message.subject}`,
    `Path: ${message.path}`,
    "─".repeat(Math.max(0, columns)),
    ...(body?.truncated ? [fit("(저장된 메일이 읽기 한도를 넘어 앞부분만 표시합니다)", columns)] : []),
  ];
  const text = wrap(body === null ? "(본문을 읽을 수 없습니다)" : body.text, columns);
  const foot = ["", ...(notice === null ? [] : [fit(notice, columns)]), ""];
  const height = Math.max(1, input.rows - head.length - foot.length);
  return { head, text, foot, height, limit: Math.max(0, text.length - height) };
}

/** The notice line this screen shows, if any. P0V-68: one reading for the
 * render and for the scroll limit, so the limit is taken from the layout that
 * is actually drawn -- a notice (or the busy line) takes a row from the body. */
function screenNotice(input: ViewInput): string | null { return noticeText(input.notice, input.busy); }

/** How far the open message's body can scroll on this screen: the owner of
 * the state keeps the scroll within it. */
export function mailScrollLimit(input: ViewInput): number {
  return mailDetailParts(input, screenNotice(input))?.limit ?? 0;
}

function mailDetail(input: ViewInput, notice: string | null): string[] {
  const parts = mailDetailParts(input, notice);
  if (parts === null) return ["메일을 찾을 수 없습니다.", "", "  Esc 뒤로"];
  const detail = input.state.detail;
  const scroll = Math.min(detail.kind === "mail" ? detail.scroll : 0, parts.limit);
  const shown = parts.text.slice(scroll, scroll + parts.height);
  const position = parts.text.length > parts.height ? ` · ${scroll + 1}–${scroll + shown.length}/${parts.text.length}행` : "";
  parts.foot[parts.foot.length - 1] = fit(`  ↑/↓ 스크롤 · ←/→ 이전/다음 메일 · Esc 뒤로${position}`, input.columns);
  return [...parts.head, ...shown, ...parts.foot];
}

export function render(input: ViewInput): string[] {
  const { state, columns, rows } = input;
  const notice = screenNotice(input);
  if (!state.open) return conversation(input, notice);
  const detail = state.detail;
  if (detail.kind === "extensions") return frame(extensionsScreen(input, notice), rows, columns);
  if (detail.kind === "mail") return frame(mailDetail(input, notice), rows, columns);
  const lines = header(state, columns);
  const panel = rowsFor(input);
  const foot = ["", ...(notice === null ? [] : [fit(notice, columns)]), fit("←/→ 카테고리 · ↑/↓ 항목 · Enter 선택 · Esc 뒤로 · Ctrl+X 닫기", columns)];
  lines.push(...panel.fixed);
  if (panel.rows.length > 0) lines.push(...windowed(panel.rows, panel.selected, rows - lines.length - foot.length));
  lines.push(...foot);
  return frame(lines, rows, columns);
}
