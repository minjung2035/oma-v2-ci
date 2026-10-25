import test from "node:test";
import assert from "node:assert/strict";
import { TuiApp, type AppPorts } from "@oma/tui/app";
import { decodeKeys } from "./fixtures/keys.js";
import { KeyDecoder } from "@oma/tui/keys";
import { StoreError } from "@oma/domain/errors";
import type { ConfigField, ExtensionRow, MailboxRead } from "@oma/tui/model";
import { unknownDashboard } from "./fixtures/dashboard.js";
import type { Terminal } from "@oma/tui/screen";
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS, humanPromptByteLimit, humanPromptFrameBytes } from "@oma/domain/surface-bounds";

const ESC = String.fromCharCode(27);
const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${ESC}[C`);
const DOWN = Buffer.from(`${ESC}[B`);
const UP = Buffer.from(`${ESC}[A`);
const ENTER = Buffer.from("\n");
/** What a terminal in bracketed-paste mode actually sends. */
const paste = (text: string): Buffer => Buffer.from(`${ESC}[200~${text}${ESC}[201~`);
/** Wait out the window in which an Enter is the newline of the paste that just
 * ended (arch §23.6), so that a test's Enter is one a Human pressed. */
const afterPasteBurst = (): Promise<void> =>
  new Promise(resolve => { setTimeout(resolve, TERMINAL_BOUNDS.pasteBurstMs.value + 20); });

function fakeTerminal(): Terminal & { frames: string[][]; repaints: number } {
  const frames: string[][] = [];
  const terminal = {
    frames,
    repaints: 0,
    columns: 100,
    rows: 16,
    draw(lines: readonly string[]) { frames.push([...lines]); },
    onKeys() { /* driven directly in tests */ },
    onResize() { /* no resize in tests */ },
    repaint() { terminal.repaints += 1; },
    restore() { /* nothing to restore */ },
  };
  return terminal;
}

interface Harness {
  readonly app: TuiApp;
  readonly terminal: Terminal & { frames: string[][]; repaints: number };
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
    { kind: "choice", id: "worker-model", label: "Worker model", value: model, options: ["cheap", "fast"], apply: "next-activation", blocked: null },
    { kind: "link", id: "extensions", label: "Extensions" },
  ];
  const dashboard = () => unknownDashboard();
  const extensions = (): readonly ExtensionRow[] => [
    { id: "packages/extension/dist/index.js", principal: true, workers: true, locked: true },
    { id: "extensions/review.js", principal: false, workers: false, locked: false },
  ];
  const mail = (): MailboxRead => ({ rows: [
    { id: "m1", from: "worker-a", kind: "question", subject: "API 선택 필요", unread: true, path: "/tmp/m1" },
  ], unreadable: null, omitted: 0 });
  const ports: AppPorts = {
    configFields: config,
    dashboard,
    extensions,
    mail,
    body: () => ({ text: "본문", truncated: false }),
    setField: (field, value) => { writes.push({ field, value }); if (field === "worker-model") model = String(value); return { kind: "saved" as const }; },
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

test("Ctrl-L repaints the whole screen and changes nothing else", () => {
  const h = harness();
  h.app.feed(Buffer.from("draft"));
  const before = h.last();
  const frames = h.terminal.frames.length;
  h.app.feed(Buffer.from([0x0c]));
  assert.equal(h.terminal.repaints, 1);
  assert.equal(h.terminal.frames.length, frames + 1, "the screen is drawn right after");
  assert.equal(h.last(), before, "the draft and the view are as they were");
  assert.deepEqual(h.prompts, []);
});

test("TUI-007: confirming a choice writes through the port and reports when it applies", () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, ENTER, UP, ENTER]) h.app.feed(chunk);
  assert.deepEqual(h.writes, [{ field: "worker-model", value: "cheap" }]);
  const frame = h.last();
  assert.match(frame, /Saved/);
  assert.match(frame, /Next worker activation/);
});

test("TUI-007: a rejected write says nothing was saved and keeps the previous value visible", () => {
  const h = harness({
    setField: () => { throw new StoreError("UNSUPPORTED_PROFILE", "unknown model profile"); },
  });
  for (const chunk of [CTRL_X, RIGHT, ENTER, UP, ENTER]) h.app.feed(chunk);
  const frame = h.last();
  assert.match(frame, /Could not save/);
  assert.doesNotMatch(frame, /· Saved/);
});

test("DR13 / P0-5, CONFIG-CONTRACT: a committed edit whose flush failed says it was saved, not that nothing was saved", () => {
  const unconfirmed = () => { throw new StoreError("INTERNAL_ERROR", "configuration was published but its durability is unconfirmed", { details: { publication: "unconfirmed" } }); };
  const h = harness({ setField: unconfirmed });
  for (const chunk of [CTRL_X, RIGHT, ENTER, UP, ENTER]) h.app.feed(chunk);
  assert.match(h.last(), /Saved; durability is unconfirmed/);
  assert.doesNotMatch(h.last(), /Could not save/);
  const toggled = harness({ setExtension: unconfirmed });
  for (const chunk of [CTRL_X, RIGHT, DOWN, ENTER, DOWN, ENTER]) toggled.app.feed(chunk);
  assert.match(toggled.last(), /Saved; durability/);
});

test("TUI-010: toggling an extension routes the role and the new state to the port, and the notice says when it applies", () => {
  const h = harness();
  for (const chunk of [CTRL_X, RIGHT, DOWN, ENTER, DOWN, ENTER]) h.app.feed(chunk);
  assert.deepEqual(h.toggles, [{ id: "extensions/review.js", role: "principal", enabled: true }]);
  assert.match(h.last(), /extensions\/review\.js · Principal enabled · Saved · Next session/);
  // The Workers column applies at a Resident's next activation, not this session's.
  for (const chunk of [RIGHT, ENTER]) h.app.feed(chunk);
  assert.deepEqual(h.toggles, [{ id: "extensions/review.js", role: "principal", enabled: true },
    { id: "extensions/review.js", role: "workers", enabled: true }]);
  assert.match(h.last(), /extensions\/review\.js · Workers enabled · Saved · Next worker activation/);
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
  assert.match(h.last(), /Generating response/);
  h.app.setBusy(false);
  assert.doesNotMatch(h.last(), /Generating response/);
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
  assert.equal(h.app.snapshot.prompt.overflow, "typed",
    "bytes without the terminal's brackets arrive as typing, and say so");
  assert.match(h.last(), /Input limit exceeded/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, [], "a bounded prefix must not impersonate the complete paste");
  assert.match(h.last(), /not sent/);

  h.app.key({ kind: "backspace" });
  assert.equal(h.app.snapshot.prompt.overflow, null);
  assert.doesNotMatch(h.last(), /Input limit exceeded/);
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
  assert.equal(h.app.snapshot.prompt.overflow, "typed");
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

test("TUI-002/023: a pasted block is one prompt boundary, not one prompt per line", async () => {
  // The failure this holds down: a paste whose second line the Human has not
  // read yet is submitted because its first newline looked like Enter.
  const h = harness();
  h.app.feed(paste("rm -rf build\nmake all"));
  assert.deepEqual(h.prompts, [], "a paste is an edit of the draft, never a submission");
  assert.equal(h.app.snapshot.prompt.text, "rm -rf build\nmake all");
  await afterPasteBurst();
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
  assert.equal(h.app.snapshot.prompt.overflow, "paste");
  assert.match(h.last(), /Paste limit exceeded/);
  assert.match(h.last(), /nothing was inserted/);
  assert.doesNotMatch(h.last(), /Backspace/,
    "a paste that added nothing must not be answered by deleting what the Human typed");
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, []);
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
  assert.equal(h.app.snapshot.prompt.overflow, "paste");
  assert.match(h.last(), /Paste limit exceeded/);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, [], "a fragment must not be submittable as the paste");

  // The stated way out works, and typing resumes.
  h.app.key({ kind: "backspace" });
  assert.equal(h.app.snapshot.prompt.overflow, null);
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
  assert.match(h.last(), /Could not send/);
  assert.match(h.last(), /대기열이 가득 찼습니다/);

  // Contrast: the same keystrokes, accepted, are echoed exactly once.
  h.refuse(null);
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["안녕", "안녕"]);
  assert.deepEqual(h.app.lines, ["> 안녕"]);
  assert.doesNotMatch(h.last(), /Could not send/);
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

test("TUI-013: a pasted multi-line draft is drawn whole and never pushes the hint off screen", async () => {
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
  await afterPasteBurst();
  long.app.feed(ENTER);
  assert.equal(long.prompts.length, 1);
  assert.equal(long.prompts[0]!.split("\n").length, 40);
});

test("T120 / TUI-023: recovery from a refused paste never spends a character the Human typed", async () => {
  // The failure this holds down: the paste added nothing, the screen said
  // "press Backspace", and Backspace deleted the Human's own last character --
  // so recovering from a rejected paste silently edited text it never touched.
  const h = harness();
  h.app.feed(Buffer.from("hello"));
  h.app.feed(paste("a".repeat(TERMINAL_BOUNDS.pasteBytes.value + 1)));
  assert.equal(h.app.snapshot.prompt.text, "hello", "a refused paste must not touch the draft");
  assert.equal(h.app.snapshot.prompt.overflow, "paste");
  assert.match(h.last(), /Paste limit exceeded/);
  assert.doesNotMatch(h.last(), /Backspace/, "the way out named a key that deletes the Human's text");

  h.app.key({ kind: "backspace" });
  assert.equal(h.app.snapshot.prompt.text, "hello",
    "the first edit after a refused paste deleted a character the paste never added");
  assert.equal(h.app.snapshot.prompt.overflow, null);
  await afterPasteBurst();
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["hello"]);

  // Typing on is a way out too, and it does not have to be Backspace.
  const typing = harness();
  typing.app.feed(Buffer.from("hello"));
  typing.app.feed(paste("a".repeat(TERMINAL_BOUNDS.pasteBytes.value + 1)));
  typing.app.feed(Buffer.from("!"));
  assert.equal(typing.app.snapshot.prompt.text, "hello!");
  assert.equal(typing.app.snapshot.prompt.overflow, null);

  // Negative control: an overflow the Human typed still shortens on Backspace,
  // because there the last character is one they entered.
  const typed = harness({}, 96);
  typed.app.feed(Buffer.from("\\".repeat(100)));
  assert.equal(typed.app.snapshot.prompt.overflow, "typed");
  assert.match(typed.last(), /Backspace/);
  const before = typed.app.snapshot.prompt.text;
  typed.app.key({ kind: "backspace" });
  assert.equal(typed.app.snapshot.prompt.text, before.slice(0, -1),
    "the control did not reproduce the behaviour this test distinguishes");
});

test("TUI-002: an Enter arriving in the burst after a paste is that paste's newline, not a submission", () => {
  // Defence in depth for a clipboard carrying `ESC[201~`: when the terminal
  // delivers the injected newline in the read after the paste, it is taken as
  // text rather than as an Enter no Human pressed.
  let nowMs = 1000;
  const decoder = new KeyDecoder(() => nowMs);
  assert.deepEqual(decoder.push(paste("rm -rf /")),
    [{ kind: "paste", value: "rm -rf /", truncated: false }]);

  nowMs += TERMINAL_BOUNDS.pasteBurstMs.value - 1;
  assert.deepEqual(decoder.push(Buffer.from("\n")), [{ kind: "char", value: "\n" }],
    "a newline inside the burst submitted the prompt");

  // Negative control: past the burst the same byte is the Human's Enter, so
  // the rule expires instead of disabling the key.
  nowMs += TERMINAL_BOUNDS.pasteBurstMs.value;
  assert.deepEqual(decoder.push(Buffer.from("\n")), [{ kind: "enter" }]);

  // And with no paste behind it, an Enter is an Enter from the first byte.
  const fresh = new KeyDecoder(() => nowMs);
  assert.deepEqual(fresh.push(Buffer.from("\n")), [{ kind: "enter" }]);
});

test("TUI-002: a clipboard carrying its own end marker cannot submit the text in front of it", async () => {
  // One read: `ESC[201~` from inside the clipboard, then a newline, then the
  // terminal's real end marker. Nothing after the first marker may act.
  const h = harness();
  h.app.feed(Buffer.from(`${ESC}[200~send this${ESC}[201~\nrm -rf /${ESC}[201~`));
  assert.deepEqual(h.prompts, [], "an injected end marker submitted the text in front of it");
  assert.equal(h.app.snapshot.prompt.text, "send this\nrm -rf /",
    "the bytes behind the injected marker are that paste's content");
  await afterPasteBurst();
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["send this\nrm -rf /"], "the Human's own Enter still submits");

  // The same clipboard split so the injected newline arrives in the next read:
  // there the burst rule, not the read boundary, is what holds it down.
  const split = harness();
  split.app.feed(Buffer.from(`${ESC}[200~send this${ESC}[201~`));
  split.app.feed(Buffer.from("\nrm -rf /"));
  assert.deepEqual(split.prompts, []);
  assert.equal(split.app.snapshot.prompt.text, "send this\nrm -rf /");

  // A read that runs out part way through yet another injected marker. Those
  // bytes are content, and the paste closes with this read, so there is no
  // later read to finish the match in: dropping them would silently eat
  // clipboard text. `ESC` is stripped from pasted text the way every control
  // byte is; `[2` is not.
  const partial = harness();
  partial.app.feed(Buffer.from(`${ESC}[200~ab${ESC}[201~cd${ESC}[2`));
  assert.deepEqual(partial.prompts, []);
  assert.equal(partial.app.snapshot.prompt.text, "abcd[2",
    "bytes part way through a second end marker vanished at the read boundary");
});

test("TUI-002: a code point the terminal split across reads has a deadline, and never becomes U+FFFD", async () => {
  // "한" is ED 95 9C. Held after two bytes, the decoder must say how long it
  // waits -- the spec promised a deadline for every unfinished token.
  const decoder = new KeyDecoder();
  assert.deepEqual(decoder.push(Buffer.from([0xed, 0x95])), []);
  assert.equal(decoder.pendingDelayMs, TERMINAL_BOUNDS.textDelayMs.value,
    "a half-delivered code point waited with no deadline at all");
  assert.deepEqual(decoder.push(Buffer.from([0x9c])), [{ kind: "char", value: "한" }]);
  assert.equal(decoder.pendingDelayMs, null, "a completed code point kept its deadline");

  // Abandoned, it is dropped rather than typed as a replacement character, and
  // the next byte begins what it says it begins.
  const abandoned = new KeyDecoder();
  abandoned.push(Buffer.from([0xed, 0x95]));
  assert.deepEqual(abandoned.flushPending(), [],
    "the abandoned bytes reached the prompt as a character nobody typed");
  assert.equal(abandoned.pendingDelayMs, null);
  assert.deepEqual(abandoned.push(Buffer.from("a")), [{ kind: "char", value: "a" }]);

  // Bytes that were never UTF-8 are dropped the same way.
  const invalid = new KeyDecoder();
  assert.deepEqual(invalid.push(Buffer.from([0xff, 0xfe])), []);
  assert.deepEqual(invalid.push(Buffer.from("ok")), [
    { kind: "char", value: "o" }, { kind: "char", value: "k" },
  ]);

  // End to end: the app's own deadline fires and the draft stays clean.
  const h = harness();
  h.app.feed(Buffer.from([0xed, 0x95]));
  assert.equal(h.app.snapshot.prompt.text, "");
  await new Promise(resolve => setTimeout(resolve, TERMINAL_BOUNDS.textDelayMs.value + 30));
  assert.equal(h.app.snapshot.prompt.text, "", "half a code point reached the draft");
  h.app.feed(Buffer.from("a"));
  assert.equal(h.app.snapshot.prompt.text, "a", "the keyboard died with a split code point");
});

test("T114 / TUI-023: a prompt that was never delivered is named, and given back when it can be", () => {
  // The failure this holds down: three prompts waiting behind a busy engine,
  // one of them fails to send, and the Human is told only that "the input"
  // could not be sent -- neither which one nor what it said.
  const h = harness();
  h.app.feed(Buffer.from("첫 번째"));
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["첫 번째"]);

  h.app.returnPrompt("첫 번째", "socket closed");
  assert.ok(h.app.lines.some(line => line.includes("Unsent input: 첫 번째")),
    "the transcript does not say which prompt was lost, or what it said");
  assert.equal(h.app.snapshot.prompt.text, "첫 번째",
    "an empty draft is where a failed prompt belongs, ready to send again");
  assert.match(h.last(), /Could not send/);
  assert.match(h.last(), /socket closed/);
  // "Do I have to retype it?" is the part the Human acts on, and the notice
  // line is cut to the screen's width, so matching it here is also the guard
  // against the wording growing past that bound.
  assert.match(h.last(), /input remains in the draft/);

  // The cause is the one part of that line the engine controls the length of.
  // A failure reported with a wall of text must not cost the Human the answer
  // to that question -- the cause is what gets cut, not the recovery.
  const long = harness();
  long.app.returnPrompt("짧은 입력", "x".repeat(4000));
  assert.match(long.last(), /input remains in the draft/,
    "a long failure reason pushed the recovery off the screen");
  assert.equal(long.app.snapshot.prompt.text, "짧은 입력");
  assert.ok(long.terminal.frames[long.terminal.frames.length - 1]!.every(line => [...line].length <= 100),
    "the notice grew past the screen instead of being cut to it");
});

test("T114 / TUI-023: a failed prompt never overwrites what the Human is typing", () => {
  const h = harness();
  h.app.feed(Buffer.from("지금 쓰는 중"));
  h.app.returnPrompt("보내지 못한 것", "socket closed");
  assert.equal(h.app.snapshot.prompt.text, "지금 쓰는 중",
    "returning a failed prompt destroyed the draft the Human was in the middle of");
  assert.ok(h.app.lines.some(line => line.includes("보내지 못한 것")),
    "the text that was not sent is nowhere the Human can copy it from");
  assert.match(h.last(), /input is kept in the conversation/);

  // The kept text is recoverable in full, newlines and all.
  const multi = harness();
  multi.app.feed(Buffer.from("x"));
  multi.app.returnPrompt("one\ntwo", "socket closed");
  assert.deepEqual(multi.app.lines, ["✗ Unsent input: one", "  two"]);
});

function manualInputTimers(t: import("node:test").TestContext) {
  const live = new Set<{ run(): void; unref(): void }>();
  t.mock.method(globalThis, "setTimeout", (run: () => void) => {
    const timer = { run, unref() {} }; live.add(timer); return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: { run(): void; unref(): void }) => { live.delete(timer); });
  return live;
}
function closeApp(app: TuiApp): void {
  const owner = app as TuiApp & { close?: () => void };
  assert.equal(typeof owner.close, "function", "the app must return its input owner");
  owner.close!();
}
test("DR27/P0-4: app close returns partial input and a late callback cannot redraw", t => {
  const timers = manualInputTimers(t), h = harness();
  h.app.feed(Buffer.from(ESC)); const old = [...timers][0]!;
  assert.equal(timers.size, 1); closeApp(h.app); closeApp(h.app);
  assert.equal(timers.size, 0);
  assert.equal((h.app as unknown as { keys: KeyDecoder }).keys.pendingDelayMs, null);
  const frames = h.terminal.frames.length, state = h.app.snapshot;
  old.run(); h.app.feed(Buffer.from("late\n")); h.app.key({ kind: "redraw" }); h.app.draw(); h.app.refresh();
  assert.equal(h.terminal.frames.length, frames); assert.equal(h.terminal.repaints, 0);
  assert.equal(h.app.snapshot, state); assert.equal(h.prompts.length, 0); assert.equal(timers.size, 0);
});
test("DR27/P0-4: a replaced partial-input callback cannot consume the current token", t => {
  const timers = manualInputTimers(t), h = harness();
  h.app.feed(Buffer.from(ESC)); const old = [...timers][0]!;
  h.app.feed(Buffer.from("[")); const current = [...timers][0]!;
  const frames = h.terminal.frames.length;
  old.run(); assert.equal(h.terminal.frames.length, frames, "an old callback acted on the new decoder token");
  assert.ok(timers.has(current)); h.app.feed(Buffer.from("C")); assert.equal(timers.size, 0);
  assert.equal(h.app.snapshot.prompt.text, ""); closeApp(h.app);
});
test("DR27/P0-4: quit ends input before later keys in the same terminal read", t => {
  const timers = manualInputTimers(t), h = harness();
  h.app.feed(Buffer.from("\x03late\n\x1b"));
  assert.equal(h.quits.length, 1); assert.equal(h.prompts.length, 0);
  assert.equal(timers.size, 0); assert.equal(h.app.snapshot.prompt.text, "");
});
