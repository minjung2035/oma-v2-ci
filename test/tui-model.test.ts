import test from "node:test";
import assert from "node:assert/strict";
import { decodeKeys } from "./fixtures/keys.js";
import type { Key } from "@oma/tui/keys";
import {
  INITIAL, categoryOf, cursorOf, step,
  type ConfigField, type Effect, type PanelData, type State,
} from "@oma/tui/model";
import { render } from "@oma/tui/view/index";
import { cellWidth, fit } from "@oma/tui/view/text";
import { unknownDashboard } from "./fixtures/dashboard.js";

const FRAME_BYTES = 262144;

const data: PanelData = Object.freeze({
  dashboard: unknownDashboard(),
  config: Object.freeze<ConfigField[]>([
    { kind: "choice", id: "principal-model", label: "Principal model", value: "fast", options: ["cheap", "fast"], apply: "next-session", blocked: null },
    { kind: "number", id: "worker-limit", label: "Worker limit", value: 8, min: 1, max: 64, apply: "restart", blocked: null },
    { kind: "link", id: "extensions", label: "Extensions" },
  ]),
  extensions: Object.freeze([
    { id: "packages/extension/dist/index.js", principal: true, workers: true, locked: true },
    { id: "extensions/review.js", principal: false, workers: true, locked: false },
  ]),
  mail: Object.freeze([
    { id: "m1", from: "worker-a", kind: "question", subject: "API 선택 필요", unread: true, path: "/tmp/m1" },
    { id: "m2", from: "worker-b", kind: "result", subject: "구현 완료", unread: false, path: "/tmp/m2" },
  ]),
  mailUnreadable: null, mailOmitted: 0,
});

const KEY = {
  panel: { kind: "panel" } as Key,
  enter: { kind: "enter" } as Key,
  escape: { kind: "escape" } as Key,
  up: { kind: "up" } as Key,
  down: { kind: "down" } as Key,
  left: { kind: "left" } as Key,
  right: { kind: "right" } as Key,
  backspace: { kind: "backspace" } as Key,
  char: (value: string): Key => ({ kind: "char", value }),
};

function drive(start: State, keys: readonly Key[]): { state: State; effects: Effect[] } {
  let state = start;
  const effects: Effect[] = [];
  for (const key of keys) {
    const result = step(state, key, data, FRAME_BYTES);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

test("T92/arch 23.4: Ctrl+X opens and closes the Control Panel from the conversation", () => {
  assert.equal(INITIAL.open, false);
  const opened = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  assert.equal(opened.open, true);
  assert.equal(categoryOf(opened), "dashboard");
  const closed = step(opened, KEY.panel, data, FRAME_BYTES).state;
  assert.equal(closed.open, false);
});

test("arch 23.4: left and right move across exactly the three categories", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  assert.equal(categoryOf(drive(open, [KEY.right]).state), "config");
  assert.equal(categoryOf(drive(open, [KEY.right, KEY.right]).state), "mail");
  assert.equal(categoryOf(drive(open, [KEY.right, KEY.right, KEY.right]).state), "dashboard");
  assert.equal(categoryOf(drive(open, [KEY.left]).state), "mail");
});

test("arch 23.4: item cursor never leaves the current category's range", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const top = drive(open, [KEY.right, KEY.up, KEY.up, KEY.up]).state;
  assert.equal(cursorOf(top, data), 0);
  const bottom = drive(open, [KEY.right, KEY.down, KEY.down, KEY.down, KEY.down]).state;
  assert.equal(cursorOf(bottom, data), data.config.length - 1);
});

test("T96/TUI-007: a confirmed choice saves immediately with no separate save step", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const { effects } = drive(open, [KEY.right, KEY.enter, KEY.up, KEY.enter]);
  assert.deepEqual(effects, [{ kind: "set-choice", field: "principal-model", value: "cheap" }]);
});

test("TUI-007: Esc during an edit reverts and emits no effect", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const { state, effects } = drive(open, [KEY.right, KEY.enter, KEY.up, KEY.escape]);
  assert.deepEqual(effects, []);
  assert.equal(state.edit.kind, "none");
});

test("TUI-007: confirming the unchanged value produces no write", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const { effects } = drive(open, [KEY.right, KEY.enter, KEY.enter]);
  assert.deepEqual(effects, []);
});

test("TUI-007: a number edit commits only a digit string inside the declared range", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const start = [KEY.right, KEY.down, KEY.enter] as const;
  const committed = drive(open, [...start, KEY.backspace, KEY.char("1"), KEY.char("2"), KEY.enter]);
  assert.deepEqual(committed.effects, [{ kind: "set-number", field: "worker-limit", value: 12 }]);
  // 999 is above max=64: the edit reverts rather than silently clamping.
  const rejected = drive(open, [...start, KEY.backspace, KEY.char("9"), KEY.char("9"), KEY.char("9"), KEY.enter]);
  assert.deepEqual(rejected.effects, []);
  const emptied = drive(open, [...start, KEY.backspace, KEY.enter]);
  assert.deepEqual(emptied.effects, []);
});

test("arch 23.4: only Extensions and Mail open a detail screen", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  assert.equal(drive(open, [KEY.enter]).state.detail.kind, "none");
  assert.equal(drive(open, [KEY.right, KEY.down, KEY.down, KEY.enter]).state.detail.kind, "extensions");
  assert.equal(drive(open, [KEY.right, KEY.right, KEY.enter]).state.detail.kind, "mail");
});

test("T97/TUI-010: the locked core extension cannot be toggled, other rows can", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const toExtensions = [KEY.right, KEY.down, KEY.down, KEY.enter] as const;
  assert.deepEqual(drive(open, [...toExtensions, KEY.enter]).effects, []);
  assert.deepEqual(drive(open, [...toExtensions, KEY.down, KEY.enter]).effects,
    [{ kind: "set-extension", id: "extensions/review.js", role: "principal", enabled: true }]);
  assert.deepEqual(drive(open, [...toExtensions, KEY.down, KEY.right, KEY.enter]).effects,
    [{ kind: "set-extension", id: "extensions/review.js", role: "workers", enabled: false }]);
});

test("arch 23.4: Esc leaves a detail screen before it closes the panel", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const inDetail = drive(open, [KEY.right, KEY.down, KEY.down, KEY.enter]).state;
  const back = step(inDetail, KEY.escape, data, FRAME_BYTES).state;
  assert.equal(back.detail.kind, "none");
  assert.equal(back.open, true);
  assert.equal(step(back, KEY.escape, data, FRAME_BYTES).state.open, false);
});

test("conversation keys build a prompt and submit it exactly once", () => {
  const typed = drive(INITIAL, [KEY.char("h"), KEY.char("i"), KEY.char("!"), KEY.backspace]);
  assert.equal(typed.state.prompt.text, "hi");
  const submitted = step(typed.state, KEY.enter, data, FRAME_BYTES);
  assert.deepEqual(submitted.effects, [{ kind: "submit-prompt", text: "hi" }]);
  assert.equal(submitted.state.prompt.text, "");
  assert.deepEqual(step(submitted.state, KEY.enter, data, FRAME_BYTES).effects, []);
});

test("conversation Backspace removes one grapheme without leaving broken Unicode", () => {
  for (const value of ["😀", "e\u0301", "👨‍👩‍👧‍👦"]) {
    const typed = drive(INITIAL, [KEY.char("a"), ...[...value].map(KEY.char)]);
    const erased = step(typed.state, KEY.backspace, data, FRAME_BYTES).state;
    assert.equal(erased.prompt.text, "a", `did not remove one grapheme: ${value}`);
    assert.equal(erased.prompt.text.includes("\uFFFD"), false);
  }
});

test("cursors stay valid when the underlying data shrinks to empty", () => {
  const empty: PanelData = { ...data, mail: Object.freeze([]), config: Object.freeze([]) };
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const onMail = drive(open, [KEY.right, KEY.right, KEY.down]).state;
  assert.equal(cursorOf(onMail, empty, "mail"), 0);
  assert.deepEqual(step(onMail, KEY.enter, empty, FRAME_BYTES).effects, []);
  assert.equal(step(onMail, KEY.enter, empty, FRAME_BYTES).state.detail.kind, "none");
});

test("key decoding maps arrows, Ctrl+X and text without leaking escape sequences", () => {
  const esc = String.fromCharCode(27);
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}[A${esc}[B${esc}[C${esc}[D`)),
    [{ kind: "up" }, { kind: "down" }, { kind: "right" }, { kind: "left" }]);
  assert.deepEqual(decodeKeys(Buffer.from([0x18])), [{ kind: "panel" }]);
  assert.deepEqual(decodeKeys(Buffer.from([0x03])), [{ kind: "interrupt" }]);
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}`)), [{ kind: "escape" }]);
  // An unknown CSI report is consumed, never typed into the prompt.
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}[199~`)), []);
  // A bracketed paste is one key, not the keystrokes its bytes resemble.
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}[200~ab${esc}[201~`)),
    [{ kind: "paste", value: "ab", truncated: false }]);
  assert.deepEqual(decodeKeys(Buffer.from("가a")), [{ kind: "char", value: "가" }, { kind: "char", value: "a" }]);
});

test("rendering keeps every line inside the terminal width for wide characters", () => {
  assert.equal(cellWidth("가"), 2);
  assert.equal(cellWidth("a"), 1);
  assert.equal(fit("가가가", 5), "가가");
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  for (const columns of [24, 40, 80]) {
    const lines = render({ state: open, data, transcript: [], body: null, notice: null, busy: false, columns, rows: 12 });
    assert.equal(lines.length, 12);
    for (const line of lines) assert.ok(cellWidth(line) <= columns, `line exceeded ${columns}: ${line}`);
  }
});

test("B4: the open message names its sender and its recipients", () => {
  // B4: the rows carry the screen's names already; the detail shows From and To.
  const named: PanelData = Object.freeze({ ...data,
    mail: Object.freeze([
      { id: "m1", from: "worker1", to: "worker", kind: "question", subject: "API 선택 필요", unread: true, path: "/tmp/m1" },
    ]) });
  let state = step(INITIAL, KEY.panel, named, FRAME_BYTES).state;
  for (const key of [KEY.right, KEY.right, KEY.enter]) state = step(state, key, named, FRAME_BYTES).state;
  const detail = render({ state, data: named, transcript: [], body: null, notice: null, busy: false, columns: 100, rows: 14 }).join("\n");
  assert.match(detail, /^From: worker1\s*$/m);
  assert.match(detail, /^To: worker\s*$/m);

  // A message whose header named no recipients gets no To line.
  state = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  for (const key of [KEY.right, KEY.right, KEY.enter]) state = step(state, key, data, FRAME_BYTES).state;
  const without = render({ state, data, transcript: [], body: null, notice: null, busy: false, columns: 100, rows: 14 }).join("\n");
  assert.match(without, /^From: worker-a\s*$/m);
  assert.doesNotMatch(without, /^To:/m);
});

test("TUI-007: the panel always shows when a setting takes effect", () => {
  const open = step(INITIAL, KEY.panel, data, FRAME_BYTES).state;
  const config = step(open, KEY.right, data, FRAME_BYTES).state;
  const text = render({ state: config, data, transcript: [], body: null, notice: null, busy: false, columns: 100, rows: 14 }).join("\n");
  assert.match(text, /Next session/);
  assert.match(text, /After restart/);
});

test("P0V-108 / F-06, TUI-002: what reorders or hides letters is not drawn, and the joiners that shape them are", () => {
  // A subject that would read "evil txt.exe": the override is gone, the letters are in order.
  assert.equal(fit("evil‮exe.txt", 40), "evilexe.txt");
  for (const unseen of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "‎", "‏",
    "؜", "​", "⁠", "﻿", "­", "\u{E0041}", "\u001B", "\u009B"])
    assert.equal(fit(`a${unseen}b`, 40), "ab", `U+${unseen.codePointAt(0)!.toString(16)}`);
  // The joiners stay: an emoji family is one cluster, a Persian word keeps its shape.
  assert.equal(fit("\u{1F468}‍\u{1F469}‍\u{1F467}", 40), "\u{1F468}‍\u{1F469}‍\u{1F467}");
  assert.equal(fit("می‌خواهم", 40), "می‌خواهم");
  // G11-02: a mark with nothing before it is text too; it takes no cell.
  assert.equal(fit("́ab", 1), "́a");
});

test("P0V-108: a paste loses what the screen would not show, so the draft the Human reads is the text that is sent", () => {
  const pasted = (text: string): Key[] => decodeKeys(Buffer.from(`\u001b[200~${text}\u001b[201~`));
  const keys = pasted("rm -rf ‮/ ; echo​ ok\tdone\r\nnext\u{E0049}");
  const paste = keys.find(key => key.kind === "paste") as { kind: "paste"; value: string } | undefined;
  assert.ok(paste, JSON.stringify(keys));
  assert.equal(paste.value, "rm -rf / ; echo ok\tdone\nnext");
});


test("TUI-007 / CFG-001: number editing accepts safe integers beyond nine digits, never rounded integers", () => {
  const wide: PanelData = { ...data, config: [{ kind: "number", id: "worker-limit", label: "Worker limit",
    value: 8, min: 0, max: Number.MAX_SAFE_INTEGER, apply: "restart", blocked: null }] };
  for (const text of ["0", "1000000000", String(Number.MAX_SAFE_INTEGER), "9007199254740992"]) {
    let state = INITIAL;
    for (const key of [KEY.panel, KEY.right, KEY.enter, KEY.backspace, ...[...text].map(KEY.char)])
      state = step(state, key, wide, FRAME_BYTES).state;
    const result = step(state, KEY.enter, wide, FRAME_BYTES);
    assert.deepEqual(result.effects, Number.isSafeInteger(Number(text))
      ? [{ kind: "set-number", field: "worker-limit", value: Number(text) }] : []);
  }
});
