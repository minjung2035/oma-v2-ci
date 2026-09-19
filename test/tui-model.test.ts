import test from "node:test";
import assert from "node:assert/strict";
import { decodeKeys, type Key } from "../src/tui/keys.js";
import {
  INITIAL, categoryOf, cursorOf, step,
  type ConfigField, type Effect, type PanelData, type State,
} from "../src/tui/model.js";
import { render } from "../src/tui/view/index.js";
import { cellWidth, fit } from "../src/tui/view/text.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

const data: PanelData = Object.freeze({
  dashboard: unknownDashboard(),
  config: Object.freeze<ConfigField[]>([
    { kind: "choice", id: "principal-model", label: "Principal model", value: "fast", options: ["cheap", "fast"], apply: "next-session" },
    { kind: "number", id: "worker-limit", label: "Worker limit", value: 8, min: 1, max: 64, apply: "restart" },
    { kind: "link", id: "extensions", label: "Extensions" },
  ]),
  extensions: Object.freeze([
    { id: "dist/src/pi-extension.js", principal: true, workers: true, locked: true },
    { id: "extensions/review.js", principal: false, workers: true, locked: false },
  ]),
  mail: Object.freeze([
    { id: "m1", from: "worker-a", kind: "question", subject: "API 선택 필요", unread: true, path: "/tmp/m1" },
    { id: "m2", from: "worker-b", kind: "result", subject: "구현 완료", unread: false, path: "/tmp/m2" },
  ]),
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
    const result = step(state, key, data);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

test("T92/arch 23.4: Ctrl+X opens and closes the Control Panel from the conversation", () => {
  assert.equal(INITIAL.open, false);
  const opened = step(INITIAL, KEY.panel, data).state;
  assert.equal(opened.open, true);
  assert.equal(categoryOf(opened), "dashboard");
  const closed = step(opened, KEY.panel, data).state;
  assert.equal(closed.open, false);
});

test("arch 23.4: left and right move across exactly the three categories", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  assert.equal(categoryOf(drive(open, [KEY.right]).state), "config");
  assert.equal(categoryOf(drive(open, [KEY.right, KEY.right]).state), "mail");
  assert.equal(categoryOf(drive(open, [KEY.right, KEY.right, KEY.right]).state), "dashboard");
  assert.equal(categoryOf(drive(open, [KEY.left]).state), "mail");
});

test("arch 23.4: item cursor never leaves the current category's range", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const top = drive(open, [KEY.right, KEY.up, KEY.up, KEY.up]).state;
  assert.equal(cursorOf(top, data), 0);
  const bottom = drive(open, [KEY.right, KEY.down, KEY.down, KEY.down, KEY.down]).state;
  assert.equal(cursorOf(bottom, data), data.config.length - 1);
});

test("T96/TUI-007: a confirmed choice saves immediately with no separate save step", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const { effects } = drive(open, [KEY.right, KEY.enter, KEY.up, KEY.enter]);
  assert.deepEqual(effects, [{ kind: "set-choice", field: "principal-model", value: "cheap" }]);
});

test("TUI-007: Esc during an edit reverts and emits no effect", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const { state, effects } = drive(open, [KEY.right, KEY.enter, KEY.up, KEY.escape]);
  assert.deepEqual(effects, []);
  assert.equal(state.edit.kind, "none");
});

test("TUI-007: confirming the unchanged value produces no write", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const { effects } = drive(open, [KEY.right, KEY.enter, KEY.enter]);
  assert.deepEqual(effects, []);
});

test("TUI-007: a number edit commits only a digit string inside the declared range", () => {
  const open = step(INITIAL, KEY.panel, data).state;
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
  const open = step(INITIAL, KEY.panel, data).state;
  assert.equal(drive(open, [KEY.enter]).state.detail.kind, "none");
  assert.equal(drive(open, [KEY.right, KEY.down, KEY.down, KEY.enter]).state.detail.kind, "extensions");
  assert.equal(drive(open, [KEY.right, KEY.right, KEY.enter]).state.detail.kind, "mail");
});

test("T97/TUI-010: the locked core extension cannot be toggled, other rows can", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const toExtensions = [KEY.right, KEY.down, KEY.down, KEY.enter] as const;
  assert.deepEqual(drive(open, [...toExtensions, KEY.enter]).effects, []);
  assert.deepEqual(drive(open, [...toExtensions, KEY.down, KEY.enter]).effects,
    [{ kind: "set-extension", id: "extensions/review.js", role: "principal", enabled: true }]);
  assert.deepEqual(drive(open, [...toExtensions, KEY.down, KEY.right, KEY.enter]).effects,
    [{ kind: "set-extension", id: "extensions/review.js", role: "workers", enabled: false }]);
});

test("arch 23.4: Esc leaves a detail screen before it closes the panel", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const inDetail = drive(open, [KEY.right, KEY.down, KEY.down, KEY.enter]).state;
  const back = step(inDetail, KEY.escape, data).state;
  assert.equal(back.detail.kind, "none");
  assert.equal(back.open, true);
  assert.equal(step(back, KEY.escape, data).state.open, false);
});

test("conversation keys build a prompt and submit it exactly once", () => {
  const typed = drive(INITIAL, [KEY.char("h"), KEY.char("i"), KEY.char("!"), KEY.backspace]);
  assert.equal(typed.state.prompt, "hi");
  const submitted = step(typed.state, KEY.enter, data);
  assert.deepEqual(submitted.effects, [{ kind: "submit-prompt", text: "hi" }]);
  assert.equal(submitted.state.prompt, "");
  assert.deepEqual(step(submitted.state, KEY.enter, data).effects, []);
});

test("cursors stay valid when the underlying data shrinks to empty", () => {
  const empty: PanelData = { ...data, mail: Object.freeze([]), config: Object.freeze([]) };
  const open = step(INITIAL, KEY.panel, data).state;
  const onMail = drive(open, [KEY.right, KEY.right, KEY.down]).state;
  assert.equal(cursorOf(onMail, empty, "mail"), 0);
  assert.deepEqual(step(onMail, KEY.enter, empty).effects, []);
  assert.equal(step(onMail, KEY.enter, empty).state.detail.kind, "none");
});

test("key decoding maps arrows, Ctrl+X and text without leaking escape sequences", () => {
  const esc = String.fromCharCode(27);
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}[A${esc}[B${esc}[C${esc}[D`)),
    [{ kind: "up" }, { kind: "down" }, { kind: "right" }, { kind: "left" }]);
  assert.deepEqual(decodeKeys(Buffer.from([0x18])), [{ kind: "panel" }]);
  assert.deepEqual(decodeKeys(Buffer.from([0x03])), [{ kind: "interrupt" }]);
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}`)), [{ kind: "escape" }]);
  // An unknown CSI report is consumed, never typed into the prompt.
  assert.deepEqual(decodeKeys(Buffer.from(`${esc}[200~`)), []);
  assert.deepEqual(decodeKeys(Buffer.from("가a")), [{ kind: "char", value: "가" }, { kind: "char", value: "a" }]);
});

test("rendering keeps every line inside the terminal width for wide characters", () => {
  assert.equal(cellWidth("가"), 2);
  assert.equal(cellWidth("a"), 1);
  assert.equal(fit("가가가", 5), "가가");
  const open = step(INITIAL, KEY.panel, data).state;
  for (const columns of [24, 40, 80]) {
    const lines = render({ state: open, data, transcript: [], body: null, notice: null, busy: false, columns, rows: 12 });
    assert.equal(lines.length, 12);
    for (const line of lines) assert.ok(cellWidth(line) <= columns, `line exceeded ${columns}: ${line}`);
  }
});

test("TUI-007: the panel always shows when a setting takes effect", () => {
  const open = step(INITIAL, KEY.panel, data).state;
  const config = step(open, KEY.right, data).state;
  const text = render({ state: config, data, transcript: [], body: null, notice: null, busy: false, columns: 100, rows: 14 }).join("\n");
  assert.match(text, /다음 세션부터/);
  assert.match(text, /재시작 후/);
});
