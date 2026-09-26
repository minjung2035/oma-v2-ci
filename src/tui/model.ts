/** TUI-007/008/010/011: the Control Panel state machine.
 *
 * This module is pure. It owns navigation, edit lifecycle and which effect a
 * keystroke requests; it never reads a file, opens a socket or decides how an
 * effect is persisted. Arch §23.4 fixes the navigation vocabulary and §23.6
 * fixes that a confirmed value is a saved value, so there is no dirty state
 * and no separate save step here.
 */
import type { Key } from "./keys.js";
import { CONFIG_BOUNDS } from "./limits.js";
import { EMPTY_PROMPT, appendPrompt, erasePrompt, pastePrompt, submitPrompt, type PromptDraft, type PromptOverflow, type PromptTransition } from "./prompt.js";
import { assertNever } from "../domain/exhaustive.js";

export type Category = "dashboard" | "config" | "mail";
export const CATEGORIES: readonly Category[] = Object.freeze(["dashboard", "config", "mail"]);

/** Arch §23.6: every setting carries when it actually takes effect. The UI
 * must never leave the user guessing why a value did not change yet.
 */
export type ApplyScope =
  | "immediate"
  | "next-activation"
  | "next-session"
  | "restart"
  | "bootstrap-only"
  | "new-agents";

/** WP15: why a field cannot be edited right now, said where the apply time
 * would be (no target, or a value that would change nothing), or null. */
export interface ChoiceField {
  readonly kind: "choice"; readonly id: string; readonly label: string;
  readonly value: string; readonly options: readonly string[]; readonly apply: ApplyScope;
  readonly blocked: string | null;
}
export interface NumberField {
  readonly kind: "number"; readonly id: string; readonly label: string;
  readonly value: number; readonly min: number; readonly max: number; readonly apply: ApplyScope;
  readonly blocked: string | null;
}
export interface LinkField {
  readonly kind: "link"; readonly id: string; readonly label: string;
}
export type ConfigField = ChoiceField | NumberField | LinkField;

/** TUI-010: `locked` marks the core OMA extension, which is always first and
 * cannot be cleared. It is not a styling hint.
 */
export interface ExtensionRow {
  readonly id: string; readonly principal: boolean;
  readonly workers: boolean; readonly locked: boolean;
  /** WP14: declared by a role but its file is not there; it can only be removed. */
  readonly missing?: boolean;
}
/** TUI-011: `unread` is derived by the caller from existing delivery facts.
 * The model stores no read state of its own.
 */
export interface MailRow {
  readonly id: string; readonly from: string; readonly kind: string;
  readonly subject: string; readonly unread: boolean; readonly path: string;
}
/** TUI-012: what the Dashboard knows, as data. How it is worded belongs to the
 * view. An unobserved status carries its reason and time rather than a guess.
 */
export interface DashboardData {
  readonly status:
    | { readonly kind: "observed"; readonly observedAtMs: number; readonly ready: number;
        /** P0V-39: null when a Resident's unit could not be observed. */
        readonly active: number | null; readonly pending: number }
    | { readonly kind: "unknown"; readonly observedAtMs: number; readonly reason: string };
  /** Seed population from configuration; not a running count. */
  readonly configuredWorkers: number;
  readonly workerLimit: number;
  /** Messages waiting for the Principal's session, or null when the mailbox
   * could not be read: an unread directory is not an empty one. */
  readonly unread: number | null;
  /** WP15.05: the configured Principal model, and the one the running session
   * was started with (null when no session runs). Nothing here is the engine's
   * own report of the model it is using; no pinned API gives that. */
  readonly principalModel: { readonly configured: string; readonly session: string | null };
  /** The rootfs Residents are confined to, or null when none is declared. */
  readonly rootfs: string | null;
}

/** What the notice line reports. The view words it. */
export type Notice =
  | { readonly kind: "saved"; readonly label: string; readonly value: string; readonly apply: ApplyScope | null }
  /** WP15.03: the confirmed value was already the configuration; nothing was written. */
  | { readonly kind: "unchanged"; readonly label: string; readonly value: string }
  /** WP15.03: the value was saved, but re-reading the configuration failed, so
   * the screen no longer shows it as current. */
  | { readonly kind: "saved-unread"; readonly label: string; readonly value: string; readonly reason: string }
  | { readonly kind: "extension"; readonly id: string; readonly role: "principal" | "workers"; readonly enabled: boolean }
  | { readonly kind: "save-failed"; readonly message: string }
  /** CONFIG-CONTRACT: the edit was committed and is what the file holds; that
   * it survives a power loss is what is not known yet. */
  | { readonly kind: "saved-unconfirmed"; readonly message: string }
  /** `kept` says where the text that was not sent now is, because a message
   * that says neither leaves the Human unsure whether to retype it. */
  | { readonly kind: "send-failed"; readonly message: string; readonly kept: "draft" | "conversation" }
  /** Why the draft refused, because the way out of each cause differs. */
  | { readonly kind: "prompt-limit"; readonly cause: PromptOverflow }
  | { readonly kind: "text"; readonly text: string };

/** A mailbox as read: its messages, and why a directory of it could not be
 * read, if one could not. */
export interface MailboxRead {
  readonly rows: readonly MailRow[];
  readonly unreadable: string | null;
}

export interface PanelData {
  readonly dashboard: DashboardData;
  readonly config: readonly ConfigField[];
  readonly extensions: readonly ExtensionRow[];
  readonly mail: readonly MailRow[];
  /** Why part of the mailbox could not be read, or null when all of it was:
   * the list above is then not the whole mailbox. */
  readonly mailUnreadable: string | null;
}

export type Detail =
  | { readonly kind: "none" }
  | { readonly kind: "extensions"; readonly row: number; readonly column: 0 | 1 }
  | { readonly kind: "mail"; readonly row: number };

export type Edit =
  | { readonly kind: "none" }
  | { readonly kind: "choice"; readonly field: string; readonly index: number }
  | { readonly kind: "number"; readonly field: string; readonly draft: string };

export interface State {
  readonly open: boolean;
  readonly category: number;
  readonly cursor: Readonly<Record<Category, number>>;
  readonly detail: Detail;
  readonly edit: Edit;
  readonly prompt: PromptDraft;
  readonly quit: boolean;
}

export type Effect =
  | { readonly kind: "set-choice"; readonly field: string; readonly value: string }
  | { readonly kind: "set-number"; readonly field: string; readonly value: number }
  | { readonly kind: "set-extension"; readonly id: string; readonly role: "principal" | "workers"; readonly enabled: boolean }
  | { readonly kind: "submit-prompt"; readonly text: string }
  | { readonly kind: "prompt-limit"; readonly active: true; readonly cause: PromptOverflow }
  | { readonly kind: "prompt-limit"; readonly active: false }
  | { readonly kind: "quit" };

export interface Step { readonly state: State; readonly effects: readonly Effect[] }

export const INITIAL: State = Object.freeze({
  open: false,
  category: 0,
  cursor: Object.freeze({ dashboard: 0, config: 0, mail: 0 }),
  detail: Object.freeze({ kind: "none" as const }),
  edit: Object.freeze({ kind: "none" as const }),
  prompt: EMPTY_PROMPT,
  quit: false,
});

const NONE: Detail = Object.freeze({ kind: "none" as const });
const NO_EDIT: Edit = Object.freeze({ kind: "none" as const });

export function categoryOf(state: State): Category {
  return CATEGORIES[state.category] ?? "dashboard";
}

function itemCount(data: PanelData, category: Category): number {
  // The Dashboard is read, not navigated: it has no selectable rows.
  if (category === "dashboard") return 0;
  if (category === "config") return data.config.length;
  return data.mail.length;
}

/** Cursors are clamped on read so that data shrinking underneath the UI can
 * never index past the end or strand the selection.
 */
export function cursorOf(state: State, data: PanelData, category = categoryOf(state)): number {
  const count = itemCount(data, category);
  if (count === 0) return 0;
  return Math.min(Math.max(state.cursor[category], 0), count - 1);
}

function withCursor(state: State, category: Category, value: number): State {
  return { ...state, cursor: Object.freeze({ ...state.cursor, [category]: value }) };
}

function move(state: State, data: PanelData, delta: number): State {
  const category = categoryOf(state);
  const count = itemCount(data, category);
  if (count === 0) return state;
  const next = Math.min(Math.max(cursorOf(state, data, category) + delta, 0), count - 1);
  return withCursor(state, category, next);
}

function closed(state: State): State {
  return { ...state, open: false, detail: NONE, edit: NO_EDIT };
}

function selectedField(state: State, data: PanelData): ConfigField | undefined {
  if (categoryOf(state) !== "config") return undefined;
  return data.config[cursorOf(state, data, "config")];
}

function fieldById(data: PanelData, id: string): ConfigField | undefined {
  return data.config.find(field => field.id === id);
}

function beginEdit(state: State, field: ConfigField): Step {
  if (field.kind === "link") return { state: { ...state, detail: { kind: "extensions", row: 0, column: 0 } }, effects: [] };
  // WP15: a field with no target or no effect is not edited; the reason is
  // already on screen where its apply time would be.
  if (field.blocked !== null) return { state, effects: [] };
  if (field.kind === "choice") {
    const index = Math.max(field.options.indexOf(field.value), 0);
    return { state: { ...state, edit: { kind: "choice", field: field.id, index } }, effects: [] };
  }
  return { state: { ...state, edit: { kind: "number", field: field.id, draft: String(field.value) } }, effects: [] };
}

function commitEdit(state: State, data: PanelData): Step {
  const edit = state.edit;
  if (edit.kind === "none") return { state, effects: [] };
  const field = fieldById(data, edit.field);
  const reverted: State = { ...state, edit: NO_EDIT };
  if (!field) return { state: reverted, effects: [] };
  if (edit.kind === "choice" && field.kind === "choice") {
    const value = field.options[edit.index];
    if (value === undefined || value === field.value) return { state: reverted, effects: [] };
    return { state: reverted, effects: [{ kind: "set-choice", field: field.id, value }] };
  }
  if (edit.kind === "number" && field.kind === "number") {
    if (!/^\d{1,9}$/.test(edit.draft)) return { state: reverted, effects: [] };
    const value = Number(edit.draft);
    // Out-of-range input reverts rather than silently clamping to a value the
    // user never confirmed.
    if (value < field.min || value > field.max || value === field.value) return { state: reverted, effects: [] };
    return { state: reverted, effects: [{ kind: "set-number", field: field.id, value }] };
  }
  return { state: reverted, effects: [] };
}

function stepEdit(state: State, data: PanelData, key: Key): Step {
  const edit = state.edit;
  if (edit.kind === "none") return { state, effects: [] };
  if (key.kind === "escape") return { state: { ...state, edit: NO_EDIT }, effects: [] };
  if (key.kind === "enter") return commitEdit(state, data);
  if (edit.kind === "choice") {
    const field = fieldById(data, edit.field);
    if (!field || field.kind !== "choice" || field.options.length === 0) return { state, effects: [] };
    if (key.kind === "up" || key.kind === "down") {
      const delta = key.kind === "up" ? -1 : 1;
      const size = field.options.length;
      const index = (edit.index + delta + size) % size;
      return { state: { ...state, edit: { kind: "choice", field: edit.field, index } }, effects: [] };
    }
    return { state, effects: [] };
  }
  if (key.kind === "backspace")
    return { state: { ...state, edit: { kind: "number", field: edit.field, draft: edit.draft.slice(0, -1) } }, effects: [] };
  if (key.kind === "char" && /^\d$/.test(key.value) && edit.draft.length < CONFIG_BOUNDS.numberDraftDigits.value)
    return { state: { ...state, edit: { kind: "number", field: edit.field, draft: edit.draft + key.value } }, effects: [] };
  return { state, effects: [] };
}

function stepExtensions(state: State, data: PanelData, key: Key, detail: Extract<Detail, { kind: "extensions" }>): Step {
  const rows = data.extensions;
  if (key.kind === "escape") return { state: { ...state, detail: NONE }, effects: [] };
  if (rows.length === 0) return { state, effects: [] };
  const row = Math.min(Math.max(detail.row, 0), rows.length - 1);
  if (key.kind === "up" || key.kind === "down") {
    const next = Math.min(Math.max(row + (key.kind === "up" ? -1 : 1), 0), rows.length - 1);
    return { state: { ...state, detail: { kind: "extensions", row: next, column: detail.column } }, effects: [] };
  }
  if (key.kind === "left" || key.kind === "right") {
    const column = key.kind === "left" ? 0 : 1;
    return { state: { ...state, detail: { kind: "extensions", row, column } }, effects: [] };
  }
  if (key.kind === "enter") {
    const target = rows[row]!;
    // TUI-010: the core extension is always loaded. Enter on it is a no-op,
    // not a silent unload.
    if (target.locked) return { state, effects: [] };
    const role = detail.column === 0 ? "principal" : "workers";
    const enabled = !(role === "principal" ? target.principal : target.workers);
    return { state, effects: [{ kind: "set-extension", id: target.id, role, enabled }] };
  }
  return { state, effects: [] };
}

function stepMailDetail(state: State, data: PanelData, key: Key, detail: Extract<Detail, { kind: "mail" }>): Step {
  if (key.kind === "escape") return { state: { ...state, detail: NONE }, effects: [] };
  if (data.mail.length === 0) return { state: { ...state, detail: NONE }, effects: [] };
  if (key.kind === "up" || key.kind === "down") {
    const next = Math.min(Math.max(detail.row + (key.kind === "up" ? -1 : 1), 0), data.mail.length - 1);
    return { state: withCursor({ ...state, detail: { kind: "mail", row: next } }, "mail", next), effects: [] };
  }
  return { state, effects: [] };
}

function stepPanelRoot(state: State, data: PanelData, key: Key): Step {
  switch (key.kind) {
    case "escape":
      return { state: closed(state), effects: [] };
    case "left":
    case "right": {
      const size = CATEGORIES.length;
      const delta = key.kind === "left" ? -1 : 1;
      return { state: { ...state, category: (state.category + delta + size) % size }, effects: [] };
    }
    case "up":
      return { state: move(state, data, -1), effects: [] };
    case "down":
      return { state: move(state, data, 1), effects: [] };
    case "enter": {
      const category = categoryOf(state);
      if (category === "config") {
        const field = selectedField(state, data);
        return field ? beginEdit(state, field) : { state, effects: [] };
      }
      if (category === "mail" && data.mail.length > 0)
        return { state: { ...state, detail: { kind: "mail", row: cursorOf(state, data, "mail") } }, effects: [] };
      // Arch §23.5: the Dashboard has no detail screen.
      return { state, effects: [] };
    }
    default:
      return { state, effects: [] };
  }
}

function conversationTransition(state: State, result: PromptTransition): Step {
  const next = { ...state, prompt: result.draft };
  switch (result.kind) {
    case "none":
      return { state: next, effects: [] };
    case "show-limit":
      return { state: next, effects: [{ kind: "prompt-limit", active: true, cause: result.cause }] };
    case "clear-limit":
      return { state: next, effects: [{ kind: "prompt-limit", active: false }] };
    case "submit":
      return { state: next, effects: [{ kind: "submit-prompt", text: result.text }] };
    default:
      return assertNever(result);
  }
}

function stepConversation(state: State, key: Key, frameBytes: number): Step {
  switch (key.kind) {
    case "char":
      return conversationTransition(state, appendPrompt(state.prompt, key.value, frameBytes));
    case "paste":
      // One paste is one edit of the draft, never a submission: the Human sees
      // what arrived and presses Enter, rather than a pasted newline sending a
      // line they have not read yet.
      return conversationTransition(state, pastePrompt(state.prompt, key.value, key.truncated, frameBytes));
    case "backspace":
      return conversationTransition(state, erasePrompt(state.prompt));
    case "enter":
      return conversationTransition(state, submitPrompt(state.prompt));
    case "eof":
      if (state.prompt.text.length > 0 || state.prompt.overflow !== null) return { state, effects: [] };
      return { state: { ...state, quit: true }, effects: [{ kind: "quit" }] };
    default:
      return { state, effects: [] };
  }
}

export function step(state: State, key: Key, data: PanelData, frameBytes: number): Step {
  if (key.kind === "panel")
    return { state: state.open ? closed(state) : { ...state, open: true }, effects: [] };
  if (key.kind === "interrupt") {
    if (state.edit.kind !== "none") return { state: { ...state, edit: NO_EDIT }, effects: [] };
    if (state.detail.kind !== "none") return { state: { ...state, detail: NONE }, effects: [] };
    if (state.open) return { state: closed(state), effects: [] };
    return { state: { ...state, quit: true }, effects: [{ kind: "quit" }] };
  }
  if (!state.open) return stepConversation(state, key, frameBytes);
  if (state.edit.kind !== "none") return stepEdit(state, data, key);
  if (state.detail.kind === "extensions") return stepExtensions(state, data, key, state.detail);
  if (state.detail.kind === "mail") return stepMailDetail(state, data, key, state.detail);
  return stepPanelRoot(state, data, key);
}
