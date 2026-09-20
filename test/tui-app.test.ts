import test from "node:test";
import assert from "node:assert/strict";
import { TuiApp, type AppPorts } from "../src/tui/app.js";
import { decodeKeys, KeyDecoder } from "../src/tui/keys.js";
import { StoreError } from "../src/domain/errors.js";
import type { ConfigField, ExtensionRow, MailRow } from "../src/tui/model.js";
import { unknownDashboard } from "./fixtures/dashboard.js";
import type { Terminal } from "../src/tui/screen.js";
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS, humanPromptByteLimit, humanPromptFrameBytes } from "../src/tui/limits.js";

const ESC = String.fromCharCode(27);
const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${ESC}[C`);
const DOWN = Buffer.from(`${ESC}[B`);
const UP = Buffer.from(`${ESC}[A`);
const ENTER = Buffer.from("\n");
/** What a terminal in bracketed-paste mode actually sends. */
const paste = (text: string): Buffer => Buffer.from(`${ESC}[200~${text}${ESC}[201~`);

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
  /** Make the session refuse the next prompts, or accept them again. A refusal
   * is the session's answer, not a thrown error, so tests drive it here. */
  refuse(reason: string | null): void;
  last(): string;
}

function harness(overrides: Partial<AppPorts> = {}, frameBytes = 262144): Harness {
  const writes: { field: string; value: string | number }[] = [];
  const toggles: { id: string; role: string; enabled: boolean }[] = [];
  const prompts: string[] = [];
  const quits: number[] = [];
  let refusal: string | null = null;
  let model = "fast";
  const config = (): readonly ConfigField[] => [
    { kind: "choice", id: "worker-model", label: "Worker model", value: model, options: ["cheap", "fast"], apply: "next-activation" },
    { kind: "link", id: "extensions", label: "Extensions" },
  ];
  const dashboard = () => unknownDashboard();
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
    submitPrompt: text => {
      prompts.push(text);
      return refusal === null ? { kind: "accepted" } : { kind: "refused", reason: refusal };
    },
    quit: () => { quits.push(1); },
    ...overrides,
  };
  const terminal = fakeTerminal();
  const app = new TuiApp(ports, terminal, frameBytes);
  app.refresh();
  app.draw();
  return {
    app, terminal, writes, toggles, prompts, quits,
    refuse: reason => { refusal = reason; },
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

test("TUI-011: the Mail detail shows the message body and Esc returns to the list", async () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, RIGHT, ENTER]) h.app.feed(chunk);
  const detail = h.last();
  assert.match(detail, /From: worker-a/);
  assert.match(detail, /본문/);
  h.app.feed(Buffer.from(ESC));
  await new Promise(resolve => setTimeout(resolve, 70));
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

test("the declared transcript bound holds for the Human's own prompts too", () => {
  // The Human's prompt is echoed by a different code path from every other
  // line. A path that pushed its own line would be a second owner of how far
  // the transcript grows, and while a long run is going -- exactly when the
  // Human types more than usual -- nothing else appends to trim it back.
  const h = harness();
  const keep = CONVERSATION_BOUNDS.transcriptLines.value;
  for (let index = 0; index < keep + 200; index += 1) {
    h.app.feed(Buffer.from(`p${index}`));
    h.app.feed(ENTER);
  }
  assert.equal(h.prompts.length, keep + 200);
  assert.ok(h.app.lines.length <= keep, `the transcript held ${h.app.lines.length} lines past a bound of ${keep}`);
  assert.equal(h.app.lines.at(-1), `> p${keep + 199}`);
});

test("T120 / TUI-023: an oversized paste is rejected as a whole instead of submitting its prefix", () => {
  const h = harness();
  const cap = CONVERSATION_BOUNDS.promptBytes.value;
  const input = "가".repeat(Math.ceil(cap / 3) + 500);
  h.app.feed(Buffer.from(input));
  assert.equal(Buffer.byteLength(h.app.snapshot.prompt.text, "utf8"), Math.floor(cap / 3) * 3,
    "the retained draft grew past its declared UTF-8 byte bound");
  assert.equal(h.app.snapshot.prompt.overflow, true);
  assert.match(h.last(), /입력 한도 초과/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, [], "a bounded prefix must not impersonate the complete paste");
  assert.match(h.last(), /전송하지 않습니다/);

  h.app.key({ kind: "backspace" });
  assert.equal(h.app.snapshot.prompt.overflow, false);
  assert.doesNotMatch(h.last(), /입력 한도 초과/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["가".repeat(Math.floor(cap / 3) - 1)]);
});

test("T120 / TUI-023: JSON escaping overflow rejects the whole prompt", () => {
  const frameBytes = 96;
  const h = harness({}, frameBytes);
  h.app.feed(Buffer.from("\\".repeat(100)));
  const prompt = h.app.snapshot.prompt.text;
  assert.ok(Buffer.byteLength(prompt, "utf8") <= humanPromptByteLimit(frameBytes));
  assert.ok(humanPromptFrameBytes(prompt) <= frameBytes,
    `the retained prompt used ${humanPromptFrameBytes(prompt)} bytes of a ${frameBytes}-byte frame`);
  assert.ok(humanPromptFrameBytes(`${prompt}\\`) > frameBytes,
    "the fixture did not reach the JSON-escaping boundary");
  assert.equal(h.app.snapshot.prompt.overflow, true);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, []);
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

test("TUI-002: UTF-8 and CSI tokens survive every terminal read boundary", () => {
  const korean = Buffer.from("가");
  for (let split = 1; split < korean.length; split += 1) {
    const decoder = new KeyDecoder();
    assert.deepEqual(decoder.push(korean.subarray(0, split)), []);
    assert.deepEqual(decoder.push(korean.subarray(split)), [{ kind: "char", value: "가" }]);
  }

  const csi = Buffer.from(`${ESC}[C`);
  for (let split = 1; split < csi.length; split += 1) {
    const decoder = new KeyDecoder();
    assert.deepEqual([
      ...decoder.push(csi.subarray(0, split)),
      ...decoder.push(csi.subarray(split)),
    ], [{ kind: "right" }], `split at byte ${split}`);
  }

  const h = harness();
  h.app.feed(CTRL_X);
  h.app.feed(Buffer.from(ESC));
  h.app.feed(Buffer.from("["));
  h.app.feed(Buffer.from("C"));
  assert.equal(h.app.snapshot.category, 1);
  assert.equal(h.app.snapshot.prompt.text, "", "the CSI final byte leaked into the prompt");
});

test("TUI-002: malformed and overlong terminal reports stay bounded and never become prompt text", () => {
  const decoder = new KeyDecoder();
  const prefix = Buffer.from(`${ESC}[`);
  assert.deepEqual(decoder.push(prefix), []);
  for (let index = 0; index < 10_000; index += 1)
    assert.deepEqual(decoder.push(Buffer.from("1")), []);
  assert.deepEqual(decoder.push(Buffer.from("~safe")), [
    { kind: "char", value: "s" }, { kind: "char", value: "a" },
    { kind: "char", value: "f" }, { kind: "char", value: "e" },
  ]);
  assert.deepEqual(decoder.finish(), []);

  const unknown = new KeyDecoder();
  assert.deepEqual(unknown.push(Buffer.from(`${ESC}[199`)), []);
  assert.deepEqual(unknown.push(Buffer.from("~x")), [{ kind: "char", value: "x" }]);
});

test("TUI-002/023: a pasted block is one prompt boundary, not one prompt per line", () => {
  // The failure this holds down: a paste whose second line the Human has not
  // read yet is submitted because its first newline looked like Enter.
  const h = harness();
  h.app.feed(paste("rm -rf build\nmake all"));
  assert.deepEqual(h.prompts, [], "a paste is an edit of the draft, never a submission");
  assert.equal(h.app.snapshot.prompt.text, "rm -rf build\nmake all");
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["rm -rf build\nmake all"]);
  assert.deepEqual(h.app.lines, ["> rm -rf build", "  make all"],
    "the echo must read as the one thing that was sent");

  // Negative control: the same bytes without the terminal's brackets are
  // keystrokes, and the first line goes on its own.
  const typed = harness();
  typed.app.feed(Buffer.from("rm -rf build\nmake all"));
  assert.deepEqual(typed.prompts, ["rm -rf build"],
    "the control did not reproduce the defect this test exists for");
});

test("TUI-002: a paste survives every terminal read boundary it can be split at", () => {
  const bytes = paste("한 줄\n두 번째 줄\tvalue");
  for (let split = 1; split < bytes.length; split += 1) {
    const decoder = new KeyDecoder();
    const keys = [...decoder.push(bytes.subarray(0, split)), ...decoder.push(bytes.subarray(split))];
    assert.deepEqual(keys, [{ kind: "paste", value: "한 줄\n두 번째 줄\tvalue", truncated: false }],
      `split at byte ${split}`);
  }
});

test("TUI-002: pasted text carries line breaks and tabs, and no terminal instructions", () => {
  const decoder = new KeyDecoder();
  const keys = decoder.push(Buffer.from(
    `${ESC}[200~a\r\nb\rc\td${ESC}[Ae${ESC}[201~`));
  // The escape byte is removed rather than interpreted: what a paste contains
  // is text, so an arrow-key report inside one is not an arrow key and its
  // remaining characters are not hidden either.
  assert.deepEqual(keys, [{ kind: "paste", value: "a\nb\nc\td[Ae", truncated: false }]);
  assert.equal(keys[0] && "value" in keys[0] ? keys[0].value.includes(ESC) : true, false,
    "a paste must not carry an escape byte into the prompt");

  // A partial end marker inside the paste is content, not an end.
  const partial = new KeyDecoder();
  assert.deepEqual(partial.push(Buffer.from(`${ESC}[200~x${ESC}[201y${ESC}[201~`)),
    [{ kind: "paste", value: "x[201y", truncated: false }]);
});

test("T120 / TUI-023: a paste over the decoder's bound is refused whole, never as its prefix", () => {
  const oversized = new KeyDecoder();
  const big = "a".repeat(TERMINAL_BOUNDS.pasteBytes.value + 1);
  assert.deepEqual(oversized.push(paste(big)), [{ kind: "paste", value: "", truncated: true }],
    "a bounded prefix must not impersonate the paste");

  const h = harness();
  h.app.feed(paste(big));
  assert.equal(h.app.snapshot.prompt.text, "");
  assert.equal(h.app.snapshot.prompt.overflow, true);
  assert.match(h.last(), /입력 한도 초과/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, []);
  assert.match(h.last(), /전송하지 않습니다/);
});

test("TUI-002: a paste the terminal never ended is rejected whole, and the keyboard lives on", async () => {
  const decoder = new KeyDecoder();
  decoder.push(Buffer.from(`${ESC}[200~hello`));
  assert.equal(decoder.pendingDelayMs, TERMINAL_BOUNDS.pasteIdleMs.value,
    "an assembling paste must declare how long its owner waits");
  assert.deepEqual(decoder.flushPending(), [{ kind: "paste", value: "", truncated: true }],
    "what arrived of an unfinished paste is a fragment, not a shorter paste");

  const h = harness();
  h.app.feed(Buffer.from(`${ESC}[200~hello`));
  assert.equal(h.app.snapshot.prompt.text, "", "an unfinished paste is not delivered in pieces");
  await new Promise(resolve => setTimeout(resolve, TERMINAL_BOUNDS.pasteIdleMs.value + 50));
  assert.equal(h.app.snapshot.prompt.text, "", "the fragment reached the draft after the deadline");
  assert.equal(h.app.snapshot.prompt.overflow, true);
  assert.match(h.last(), /입력 한도 초과/);
  assert.match(h.last(), /Backspace/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, [], "a fragment must not be submittable as the paste");

  // The stated way out works, and typing resumes.
  h.app.key({ kind: "backspace" });
  assert.equal(h.app.snapshot.prompt.overflow, false);
  h.app.feed(Buffer.from("x"));
  assert.equal(h.app.snapshot.prompt.text, "x", "the keyboard died with an unfinished paste");
});

test("TUI-002: an unfinished terminal report gives up instead of eating the next key", async () => {
  const h = harness();
  h.app.feed(Buffer.from(`${ESC}[`));
  assert.equal(h.app.snapshot.prompt.text, "");
  await new Promise(resolve => setTimeout(resolve, TERMINAL_BOUNDS.escapeDelayMs.value + 30));
  h.app.feed(Buffer.from("C"));
  assert.equal(h.app.snapshot.prompt.text, "C", "the next key was consumed as a CSI final byte");

  // Negative control: with no deadline the same bytes are one report, and the
  // Human's keystroke is gone.
  const decoder = new KeyDecoder();
  decoder.push(Buffer.from(`${ESC}[`));
  assert.deepEqual(decoder.push(Buffer.from("C")), [{ kind: "right" }],
    "the control did not reproduce the defect this test exists for");

  // An overlong report is in a different state and needs the same deadline.
  const overlong = new KeyDecoder();
  overlong.push(Buffer.from(`${ESC}[${"1".repeat(TERMINAL_BOUNDS.escapeSequenceBytes.value * 2)}`));
  assert.equal(overlong.pendingDelayMs, TERMINAL_BOUNDS.escapeDelayMs.value);
  assert.deepEqual(overlong.flushPending(), []);
  assert.deepEqual(overlong.push(Buffer.from("C")), [{ kind: "char", value: "C" }]);
});

test("arch 23.3: a prompt the session refused is not echoed as sent and comes back to the draft", () => {
  const h = harness();
  h.refuse("대기열이 가득 찼습니다.");
  h.app.feed(Buffer.from("안녕"));
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["안녕"]);
  assert.equal(h.app.snapshot.prompt.text, "안녕", "a refusal must not cost the Human the text");
  assert.deepEqual(h.app.lines, [], "a refused prompt must not read as one the Principal has");
  assert.match(h.last(), /전송하지 못했습니다/);
  assert.match(h.last(), /대기열이 가득 찼습니다/);

  // Contrast: the same keystrokes, accepted, are echoed exactly once.
  h.refuse(null);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["안녕", "안녕"]);
  assert.deepEqual(h.app.lines, ["> 안녕"]);
  assert.doesNotMatch(h.last(), /전송하지 못했습니다/);
});

test("TUI-013: produced control bytes are drawn as text, never as terminal instructions", () => {
  const h = harness();
  h.app.line(`before${ESC}[2Jafter\u0007\ttab`);
  assert.ok(h.app.lines[0]?.includes(ESC), "the transcript keeps what was produced");
  const frame = h.last();
  assert.doesNotMatch(frame, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/,
    "a control byte reached the terminal");
  assert.equal(frame.includes("\t"), false, "a tab reached the terminal");
  assert.match(frame, /before\[2Jafter/);
});

test("TUI-013: a pasted multi-line draft is drawn whole and never pushes the hint off screen", () => {
  const h = harness();
  h.app.feed(paste("one\ntwo\nthree"));
  const lines = h.terminal.frames.at(-1)!;
  assert.equal(lines.length, 16);
  assert.ok(lines.some(line => line.startsWith("> one")));
  assert.ok(lines.some(line => line.trimStart().startsWith("two")));
  assert.ok(lines.some(line => line.trimStart().startsWith("three")));
  assert.match(lines.at(-1)!, /Ctrl\+X/);
  assert.ok(lines.some(line => line.startsWith("─")));

  // A draft longer than the screen shows its end -- where the next character
  // lands -- and leaves the conversation, divider and hint standing.
  const long = harness();
  long.app.feed(paste(Array.from({ length: 40 }, (_, index) => `l${index}`).join("\n")));
  const frame = long.terminal.frames.at(-1)!;
  assert.equal(frame.length, 16);
  assert.ok(frame.some(line => line.includes("l39")));
  assert.match(frame.at(-1)!, /Ctrl\+X/);
  assert.ok(frame.some(line => line.startsWith("─")));
  long.app.feed(ENTER);
  assert.equal(long.prompts.length, 1);
  assert.equal(long.prompts[0]!.split("\n").length, 40);
});
