/** TUI-007/012: the screens. Given state and already-collected data this module
 * returns the exact lines to draw. It performs no I/O and never invents a value:
 * an unknown observation stays unknown here (arch §23.5).
 *
 * Everything under `packages/tui/src/view/` is presentation, and nothing outside it
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
import { applyLabel, extensionLabel } from "./labels.js";
import { cellWidth, fit, pad, wrap } from "./text.js";



function fieldValue(field: ConfigField, state: State): string {
  if (field.kind === "link") return field.value ?? ">";
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
  lines.push(fit("Ctrl+X Control Panel · Ctrl+C Quit", columns));
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
  if (category === "config") {
    const rows: string[] = [];
    let focus = selected;
    data.config.forEach((field, index) => {
      const marker = index === selected ? ">" : " ";
      // DR24: a link's value is the model the engine runs; cut to the column it
      // could name another model, so it is shown whole and its note follows.
      const shown = fieldValue(field, state);
      const value = field.kind === "link" && cellWidth(shown) >= LAYOUT_BOUNDS.valueColumn.value ? `${shown} `
        : pad(fit(shown, LAYOUT_BOUNDS.valueColumn.value - 1), LAYOUT_BOUNDS.valueColumn.value);
      // WP15: a blocked field says why instead of when it would apply.
      const scope = field.kind === "link"
        ? field.blocked ? `(${field.blocked})` : field.value !== undefined ? "(Enter: choose from the list)" : ""
        : field.blocked !== null ? `(${field.blocked})` : applyLabel(field.apply);
      rows.push(`${marker} ${pad(field.label, labelWidth)}${value}${scope}`);
      // A choice being edited shows every option, not only the one in view.
      const edit = state.edit;
      if (field.kind === "choice" && edit.kind === "choice" && edit.field === field.id) {
        field.options.forEach((option, at) => rows.push(`    ${at === edit.index ? "●" : "○"} ${option}${option === field.value ? " (current)" : ""}`));
        focus = rows.length - field.options.length + edit.index;
      }
    });
    return { fixed: [], selected: focus, rows };
  }
  // arch §23.5: what could not be read is said, never shown as no mail.
  const unreadable = data.mailUnreadable === null ? []
    : [fit(`  Part of the mailbox is unreadable (${data.mailUnreadable}); the list may be incomplete`, columns)];
  // P0V-43: older messages counted but not listed are said, not hidden.
  const omitted = data.mailOmitted === 0 ? []
    : [fit(`  Showing ${data.mail.length} recent messages; ${data.mailOmitted} older messages were not read`, columns)];
  if (data.mail.length === 0)
    return { fixed: unreadable.length + omitted.length > 0 ? [...unreadable, ...omitted] : ["  No society mail."], rows: [], selected: null };
  return { fixed: [...unreadable, ...omitted, fit("  All society mail · ● Awaiting Principal delivery; opening does not acknowledge mail", columns)],
    selected, rows: data.mail.map((row, index) => {
      const marker = index === selected ? ">" : " ";
      const flag = row.unread ? "●" : " ";
      const thread = (row.threadCount ?? 0) > 1 ? `(${row.threadCount})` : "";
      return `${marker}${flag} ${pad(row.from, LAYOUT_BOUNDS.senderColumn.value)}${pad(row.kind, LAYOUT_BOUNDS.kindColumn.value)}${thread}${row.subject}`;
    }) };
}

function extensionsScreen(input: ViewInput, notice: string | null): string[] {
  const { state, data, columns } = input;
  const detail = state.detail;
  const row = detail.kind === "extensions" ? detail.row : 0;
  const column = detail.kind === "extensions" ? detail.column : 0;
  const labelOf = (id: string, locked: boolean, missing = false, source?: string): string =>
    `${extensionLabel(id, source)}${locked ? " (Locked)" : ""}${missing ? " (File missing)" : ""}`;
  // Width follows the longest real name so an id is not silently clipped, but
  // still leaves room for both role columns.
  const longest = data.extensions.reduce((width, extension) =>
    Math.max(width, cellWidth(labelOf(extension.id, extension.locked, extension.missing, extension.source))), 0);
  const nameWidth = Math.max(LAYOUT_BOUNDS.minNameColumn.value,
    Math.min(longest + 2, Math.max(LAYOUT_BOUNDS.minNameColumn.value, columns - LAYOUT_BOUNDS.roleColumns.value)));
  const lines = ["EXTENSIONS", "", `  ${pad("", nameWidth)}Principal   Workers`, ""];
  const entries = data.extensions.map((extension, index) => {
    const marker = index === row ? ">" : " ";
    const principal = `[${extension.principal ? "x" : " "}]`;
    const workers = `[${extension.workers ? "x" : " "}]`;
    const left = index === row && column === 0 ? `<${principal}>` : ` ${principal} `;
    const right = index === row && column === 1 ? `<${workers}>` : ` ${workers} `;
    return `${marker} ${pad(labelOf(extension.id, extension.locked, extension.missing, extension.source), nameWidth)}${pad(left, 12)}${right}`;
  });
  const footer = ["", ...(notice === null ? [] : [fit(notice, columns)]), "  Enter Toggle · ←/→ Target · Esc Back"];
  // NB-13: a minimal screen cannot lose the footer; the head's tail is cut
  // first, then the entries get what remains.
  const room = Math.max(0, input.rows - footer.length);
  const head = lines.slice(0, room);
  return [...head, ...(room > head.length ? windowed(entries, row, room - head.length) : []), ...footer];
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
    ...(message.requester === undefined ? [] : [`Requested by: ${message.requester}`]),
    // B4: the recipients the message names, absent when it carries none.
    ...(message.to === undefined ? [] : [`To: ${message.to}`]),
    `Kind: ${message.kind}`,
    `Subject: ${message.subject}`,
    `Path: ${message.path}`,
    ...(message.earlier ?? []).map((path, index) =>
      `Earlier in this thread ${index + 1}/${message.earlier!.length}: ${path}`),
    "─".repeat(Math.max(0, columns)),
    ...(body?.truncated ? [fit("(Showing the beginning only; the stored mail exceeds the read limit)", columns)] : []),
  ];
  const text = wrap(body === null ? "(Cannot read the message body)" : body.text, columns);
  const foot = ["", ...(notice === null ? [] : [fit(notice, columns)]), ""];
  // NB-13: at minimal geometry the head's tail (the earlier-thread list) is
  // what gives first, so the foot with the way back is never pushed off.
  const shown = head.slice(0, Math.max(0, input.rows - foot.length - 1));
  const height = Math.max(1, input.rows - shown.length - foot.length);
  return { head: shown, text, foot, height, limit: Math.max(0, text.length - height) };
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
  if (parts === null) return ["Message not found.", "", "  Esc Back"];
  const detail = input.state.detail;
  const scroll = Math.min(detail.kind === "mail" ? detail.scroll : 0, parts.limit);
  const shown = parts.text.slice(scroll, scroll + parts.height);
  const position = parts.text.length > parts.height ? ` · ${scroll + 1}–${scroll + shown.length}/${parts.text.length} lines` : "";
  parts.foot[parts.foot.length - 1] = fit(`  ↑/↓ Scroll · ←/→ Previous/next message · Esc Back${position}`, input.columns);
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
  const foot = ["", ...(notice === null ? [] : [fit(notice, columns)]), fit("←/→ Category · ↑/↓ Item · Enter Select · Esc Back · Ctrl+X Close", columns)];
  // NB-13: fixed rows may not push the footer (and the notice it carries) off
  // a minimal screen -- their tail is cut, and one row is kept for the list.
  const room = Math.max(0, rows - lines.length - foot.length);
  lines.push(...panel.fixed.slice(0, panel.rows.length > 0 ? Math.max(0, room - 1) : room));
  const left = rows - lines.length - foot.length;
  if (panel.rows.length > 0 && left > 0) lines.push(...windowed(panel.rows, panel.selected, left));
  lines.push(...foot);
  return frame(lines, rows, columns);
}
