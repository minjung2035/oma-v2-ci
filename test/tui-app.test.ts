import test from "node:test";
import assert from "node:assert/strict";
import { TuiApp, type AppPorts } from "../src/tui/app.js";
import { decodeKeys } from "../src/tui/keys.js";
import { StoreError } from "../src/domain/errors.js";
import type { ConfigField, DashboardLine, ExtensionRow, MailRow } from "../src/tui/model.js";
import type { Terminal } from "../src/tui/screen.js";

const ESC = String.fromCharCode(27);
const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${ESC}[C`);
const DOWN = Buffer.from(`${ESC}[B`);
const UP = Buffer.from(`${ESC}[A`);
const ENTER = Buffer.from("\n");

function fakeTerminal(): Terminal & { frames: string[][] } {
  const frames: string[][] = [];
  return {
    frames,
    columns: 100,
    rows: 16,
    draw(lines) { frames.push([...lines]); },
    onKeys() { /* driven directly in tests */ },
    onResize() { /* no resize in tests */ },
    restore() { /* nothing to restore */ },
  };
}

interface Harness {
  readonly app: TuiApp;
  readonly terminal: Terminal & { frames: string[][] };
  readonly writes: { field: string; value: string | number }[];
  readonly toggles: { id: string; role: string; enabled: boolean }[];
  readonly prompts: string[];
  readonly quits: number[];
  last(): string;
}

function harness(overrides: Partial<AppPorts> = {}): Harness {
  const writes: { field: string; value: string | number }[] = [];
  const toggles: { id: string; role: string; enabled: boolean }[] = [];
  const prompts: string[] = [];
  const quits: number[] = [];
  let model = "fast";
  const config = (): readonly ConfigField[] => [
    { kind: "choice", id: "worker-model", label: "Worker model", value: model, options: ["cheap", "fast"], apply: "next-activation" },
    { kind: "link", id: "extensions", label: "Extensions" },
  ];
  const dashboard = (): readonly DashboardLine[] => [{ label: "Status", value: "unknown (broker 미연결)" }];
  const extensions = (): readonly ExtensionRow[] => [
    { id: "dist/src/pi-extension.js", principal: true, workers: true, locked: true },
    { id: "extensions/review.js", principal: false, workers: false, locked: false },
  ];
  const mail = (): readonly MailRow[] => [
    { id: "m1", from: "worker-a", kind: "question", subject: "API 선택 필요", unread: true, path: "/tmp/m1" },
  ];
  const ports: AppPorts = {
    configFields: config,
    dashboard,
    extensions,
    mail,
    body: () => "본문",
    setField: (field, value) => { writes.push({ field, value }); if (field === "worker-model") model = String(value); },
    setExtension: (id, role, enabled) => { toggles.push({ id, role, enabled }); },
    submitPrompt: text => { prompts.push(text); },
    quit: () => { quits.push(1); },
    ...overrides,
  };
  const terminal = fakeTerminal();
  const app = new TuiApp(ports, terminal);
  app.refresh();
  app.draw();
  return {
    app, terminal, writes, toggles, prompts, quits,
    last: () => (terminal.frames[terminal.frames.length - 1] ?? []).join("\n"),
  };
}

test("TUI-007: confirming a choice writes through the port and reports when it applies", () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, ENTER, UP, ENTER]) h.app.feed(chunk);
  assert.deepEqual(h.writes, [{ field: "worker-model", value: "cheap" }]);
  const frame = h.last();
  assert.match(frame, /저장됨/);
  assert.match(frame, /다음 worker 활성화부터/);
});

test("TUI-007: a rejected write says nothing was saved and keeps the previous value visible", () => {
  const h = harness({
    setField: () => { throw new StoreError("UNSUPPORTED_PROFILE", "unknown model profile"); },
  });
  for (const chunk of [CTRL_X, RIGHT, ENTER, UP, ENTER]) h.app.feed(chunk);
  const frame = h.last();
  assert.match(frame, /저장하지 못했습니다/);
  assert.doesNotMatch(frame, /· 저장됨/);
});

test("TUI-010: toggling an extension routes the role and the new state to the port", () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, DOWN, ENTER, DOWN, ENTER]) h.app.feed(chunk);
  assert.deepEqual(h.toggles, [{ id: "extensions/review.js", role: "principal", enabled: true }]);
  assert.match(h.last(), /Principal 사용 · 저장됨/);
});

test("arch 23.3: a submitted prompt reaches the session once and is echoed in the transcript", () => {
  const h = harness();
  h.app.feed(Buffer.from("안녕"));
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["안녕"]);
  assert.match(h.last(), /> 안녕/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["안녕"], "an empty prompt must not be submitted");
});

test("arch 23.4: the Control Panel overlays the conversation and Ctrl+X returns to it", () => {
  const h = harness();
  h.app.feed(Buffer.from("작업 중"));
  const conversation = h.last();
  assert.match(conversation, /작업 중/);
  h.app.feed(CTRL_X);
  const panel = h.last();
  assert.match(panel, /Dashboard/);
  assert.match(panel, /\[Dashboard\]/);
  h.app.feed(CTRL_X);
  // Returning to the conversation must not lose the half-typed prompt.
  assert.match(h.last(), /작업 중/);
});

test("TUI-011: the Mail detail shows the message body and Esc returns to the list", () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, RIGHT, ENTER]) h.app.feed(chunk);
  const detail = h.last();
  assert.match(detail, /From: worker-a/);
  assert.match(detail, /본문/);
  h.app.feed(Buffer.from(ESC));
  assert.match(h.last(), /API 선택 필요/);
});

test("TUI-012: the busy indicator reflects session state without inventing a result", () => {
  const h = harness();
  h.app.setBusy(true);
  assert.match(h.last(), /응답 생성 중/);
  h.app.setBusy(false);
  assert.doesNotMatch(h.last(), /응답 생성 중/);
});

test("the transcript is bounded so a long session cannot grow without limit", () => {
  const h = harness();
  for (let index = 0; index < 700; index += 1) h.app.line(`line ${index}`);
  const frame = h.last();
  assert.ok(frame.length > 0);
  assert.doesNotMatch(frame, /line 0\b/);
  assert.match(frame, /line 699/);
});

test("Ctrl+C unwinds edit, then detail, then the panel before it quits", () => {
  const h = harness();
  const CTRL_C = Buffer.from([0x03]);
  for (const chunk of [CTRL_X, RIGHT, ENTER]) h.app.feed(chunk);
  h.app.feed(CTRL_C);
  assert.equal(h.app.snapshot.edit.kind, "none");
  assert.equal(h.app.snapshot.open, true);
  h.app.feed(CTRL_C);
  assert.equal(h.app.snapshot.open, false);
  assert.deepEqual(h.quits, []);
  h.app.feed(CTRL_C);
  assert.deepEqual(h.quits, [1]);
});

test("decoded input reaches the app as whole keys even when a sequence is split", () => {
  const h = harness();
  h.app.feed(CTRL_X);
  // A single read carrying two arrows must move twice, not once.
  h.app.feed(Buffer.from(`${ESC}[C${ESC}[C`));
  assert.equal(h.app.snapshot.category, 2);
  assert.deepEqual(decodeKeys(Buffer.from(`${ESC}[C${ESC}[C`)), [{ kind: "right" }, { kind: "right" }]);
});
