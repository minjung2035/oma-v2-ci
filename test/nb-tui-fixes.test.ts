/** NB-04..15 (docs/priority-0-audit.md): one reproduction per defect. Each
 * test names the failure it would have caught, so a regression is a broken
 * oracle, not a changed expectation:
 *   NB-04 a mail body re-read from disk on every frame
 *   NB-05 a Pending count that counted the Principal in a workers' row
 *   NB-06 a failure message a pipe dropped because exit beat the drain
 *   NB-07 an invisible typed character sent though the screen hid it
 *   NB-08 a Linux-console function key leaking into the draft as text
 *   NB-10 input swallowed while the control panel was open
 *   NB-11 an emoji cut in half by a UTF-16-unit truncation
 *   NB-12 branding never inserted though a suitable gap existed
 *   NB-13 a footer pushed off a minimal screen by fixed rows
 *   NB-14 a blank line emitted before an over-width cluster
 *   NB-15 a write to a dead stream thrown into the input listener
 * NB-09's oracle lives in engine-login-ownership.test.mjs: `runEngineLogin`
 * is declared `Promise<number>`, so its failures are rejections there. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TuiApp, type AppPorts } from "@oma/tui/app";
import { KeyDecoder } from "@oma/tui/keys";
import { dashboardData } from "@oma/tui/dashboard";
import { openTerminal, type Terminal } from "@oma/tui/screen";
import { brandFooter, swapText } from "@oma/engine/open-tui-brand";
import { wrap } from "@oma/tui/view/text";
import { defaultHostConfig } from "@oma/config/defaults";
import type { AgentStatus } from "@oma/contracts";
import type { ConfigField, ExtensionRow, MailboxRead } from "@oma/tui/model";
import { unknownDashboard } from "./fixtures/dashboard.js";

const ESC = String.fromCharCode(27);
const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${ESC}[C`);
const ENTER = Buffer.from("\n");
/** Long enough for a lone Escape or a paste burst to settle (both 50 ms). */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));

function fakeTerminal(columns = 100, rows = 16): Terminal & { frames: string[][] } {
  const frames: string[][] = [];
  return {
    frames,
    columns,
    rows,
    draw(lines: readonly string[]) { frames.push([...lines]); },
    onKeys() { /* driven directly */ },
    onResize() { /* no resize */ },
    repaint() { /* counted where it matters */ },
    restore() { /* nothing to restore */ },
  };
}

function harness(overrides: Partial<AppPorts> = {}, terminal = fakeTerminal()) {
  const prompts: string[] = [];
  const ports: AppPorts = {
    configFields: (): readonly ConfigField[] => [],
    dashboard: () => unknownDashboard(),
    extensions: (): readonly ExtensionRow[] => [],
    mail: (): MailboxRead => ({ rows: [
      { id: "m1", from: "worker-a", kind: "question", subject: "첫 번째", unread: true, path: "/tmp/m1" },
      { id: "m2", from: "worker-b", kind: "report", subject: "두 번째", unread: false, path: "/tmp/m2" },
    ], unreadable: null, omitted: 0 }),
    body: () => ({ text: "본문", truncated: false }),
    setField: () => ({ kind: "saved" as const }),
    setExtension: () => { /* no toggles */ },
    submitPrompt: text => { prompts.push(text); return { kind: "accepted" as const }; },
    quit: () => { /* no quit */ },
    ...overrides,
  };
  const app = new TuiApp(ports, terminal, 262144);
  app.refresh();
  app.draw();
  return { app, terminal, prompts, last: () => (terminal.frames.at(-1) ?? []).join("\n") };
}

test("NB-04: the open mail's body is read once per message, not once per frame", async () => {
  let reads = 0;
  const h = harness({ body: path => { reads += 1; return { text: `body of ${path}`, truncated: false }; } });
  // Open the first message and look at it for many frames.
  for (const chunk of [CTRL_X, RIGHT, RIGHT, ENTER]) h.app.feed(chunk);
  assert.equal(reads, 1, "opening the message reads its body once");
  for (let index = 0; index < 8; index += 1) { h.app.refresh(); h.app.draw(); }
  // Scroll the body: still the same message, still the same read.
  h.app.feed(Buffer.from(`${ESC}[B`));
  assert.equal(reads, 1, "redraws and scrolls reuse the read");
  // Close and reopen the same message: it is read again -- the cache holds
  // only the open one and never answers for a message that is not open.
  h.app.feed(Buffer.from(ESC));
  await settle();
  h.app.feed(ENTER);
  assert.equal(reads, 2, "a closed message is re-read on reopen");
});

test("NB-05: Pending counts Residents only; the Principal's own count stays its own row", () => {
  const config = defaultHostConfig({ society: "demo", node: "/usr/bin/node", libdir: "/opt/oma",  deploymentDigest: "a".repeat(64) });
  const row = (agent: string, pending: number): AgentStatus => ({
    agent, desired: "enabled", activeState: "active", subState: "running", unitResult: "success",
    execMainStatus: 0, pending, preparedBatches: 0, reason: null, runnerObservedAtMs: null });
  const data = dashboardData({ config, principalModel: { configured: "m", session: null }, unread: 0,
    observation: { kind: "observed", statuses: [row("principal", 5), row("alice", 2), row("bob", 1)], observedAtMs: Date.UTC(2026, 8, 26) } });
  const status = data.status;
  assert.equal(status.kind, "observed");
  if (status.kind !== "observed") return;
  assert.equal(status.pending, 3, "the Principal is not a worker; its 5 are not the Residents' pending");
  assert.equal(status.principalPending, 5, "and they are not lost either -- they are its own count");
});

test("NB-06: a failure message survives process.exit behind it, even past the pipe's buffer", () => {
  const exit = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/application/exit")));
  // Well past any pipe buffer: a buffered write() has no chance to drain
  // before process.exit. On Linux the Human's stream is stderr.
  const script = `import { fail } from ${JSON.stringify(exit)}; fail("x".repeat(300_000) + "TAIL", 2);`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script],
    { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  assert.equal(run.status, 2);
  assert.ok(run.stderr.startsWith("oma: "), "the message's head reached the pipe");
  assert.ok(run.stderr.endsWith("TAIL\n"), "the message's tail reached the pipe -- it was drained, not dropped");
});

test("NB-07: a typed character the screen cannot show is never sent", () => {
  const typed = (...chunks: number[][]): string => {
    const decoder = new KeyDecoder(() => 0);
    return [...chunks.flatMap(chunk => decoder.push(Uint8Array.from(chunk))), ...decoder.finish()]
      .map(key => (key.kind === "char" ? key.value : "")).join("");
  };
  const bytes = (text: string): number[] => [...Buffer.from(text, "utf8")];
  // C1 controls, a zero-width space, a BOM, and bidi formatting: invisible on
  // screen, so none of them may land in the draft.
  for (const invisible of ["\u0080", "\u009f", "\u200b", "\ufeff", "\u200f", "\u200e"])
    assert.equal(typed(bytes(`A${invisible}B`)), "AB", `typed U+${invisible.codePointAt(0)!.toString(16)}`);
  // A cut through the encoding changes nothing about the drop.
  const whole = bytes("A\ufeffB");
  for (let cut = 1; cut < whole.length; cut += 1)
    assert.equal(typed(whole.slice(0, cut), whole.slice(cut)), "AB", `cut after byte ${cut}`);
  // Visible characters still type: the sanitization removes only what the
  // screen cannot show, never what it can.
  assert.equal(typed(bytes("A한 B")), "A한 B");
});

test("NB-08: a Linux-console function key (ESC [ [ A-E) is one key, not a leak into the draft", () => {
  for (const final of ["A", "B", "C", "D", "E"]) {
    const decoder = new KeyDecoder(() => 0);
    const keys = [...decoder.push(Buffer.from(`${ESC}[[${final}x`)), ...decoder.finish()];
    const text = keys.map(key => (key.kind === "char" ? key.value : "")).join("");
    assert.equal(text, "x", `ESC [[ ${final}: the final byte is consumed, the next key still types`);
  }
  // And a real CSI report still ends where it always did.
  const decoder = new KeyDecoder(() => 0);
  const keys = [...decoder.push(Buffer.from(`${ESC}[Bx`)), ...decoder.finish()];
  assert.deepEqual(keys.map(key => key.kind), ["down", "char"]);
});

test("NB-10: text typed while the panel is open waits in the draft instead of vanishing", () => {
  const h = harness();
  h.app.feed(CTRL_X);
  assert.match(h.last(), /\[Dashboard\]/, "the panel is open");
  h.app.feed(Buffer.from("send later"));
  h.app.feed(CTRL_X); // close the panel: the draft is still there
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["send later"], "typed behind the panel, sent after it closed");
});

test("NB-10: a paste behind the panel is kept the same way", async () => {
  const h = harness();
  h.app.feed(CTRL_X);
  h.app.feed(Buffer.from(`${ESC}[200~pasted${ESC}[201~`));
  h.app.feed(CTRL_X);
  await settle(); // the paste's burst window, so the Enter is the Human's
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["pasted"]);
});

test("NB-11: swapText truncates on grapheme boundaries -- a flag is kept whole or dropped whole", () => {
  const flags = "🇫🇷🇩🇪🇯🇵🇰🇷"; // four regional-indicator pairs, 2 cells each
  const line = `│${"from".padEnd(30)}│`;
  const swapped = swapText(line, "from", flags, false);
  // Every regional indicator that survived is paired: an odd count of them
  // anywhere would mean a half flag was drawn.
  const regionals = [...swapped].filter(char => /🇦-🇿/u.test(char)).length;
  assert.equal(regionals % 2, 0, "no half a flag on screen");
  assert.doesNotMatch(swapped, /�/, "no replacement character from a split pair");
});

test("NB-12: brandFooter uses a gap after the ~ marker, even when the widest gap is before it", () => {
  // A huge gap before the ~ used to win the width contest and leave the
  // branding nowhere to go.
  const line = `${ESC}[36mAA${" ".repeat(30)}${ESC}[39m${" ".repeat(4)}${ESC}[36m~${ESC}[39m${" ".repeat(8)}END`;
  const branded = brandFooter([line], { title: "t", version: "0", engineVersion: "0", project: "myproj", tip: "", society: "s" })[0]!;
  assert.match(branded.replace(/\x1b\[[0-9;]*m/g, ""), /myproj/, "the project went into the gap after ~");
});

test("NB-13: at a minimal terminal the panel's footer -- the way back -- stays on screen", () => {
  const h = harness({}, fakeTerminal(80, 4));
  h.app.feed(CTRL_X);
  const frame = h.terminal.frames.at(-1)!;
  assert.equal(frame.length, 4);
  assert.match(frame.join("\n"), /Esc Back/, "the footer is drawn, not pushed off");
});

test("NB-13: at a minimal terminal a notice on the mail detail is not pushed off by the head", () => {
  const h = harness({ mail: () => ({ rows: [
    { id: "m1", from: "worker-a", kind: "question", subject: "s", unread: true, path: "/tmp/m1",
      earlier: ["/tmp/e1", "/tmp/e2", "/tmp/e3", "/tmp/e4", "/tmp/e5"] },
  ], unreadable: null, omitted: 0 }) }, fakeTerminal(60, 6));
  for (const chunk of [CTRL_X, RIGHT, RIGHT, ENTER]) h.app.feed(chunk);
  h.app.note("the notice that must remain visible");
  const frame = h.terminal.frames.at(-1)!;
  assert.equal(frame.length, 6);
  assert.match(frame.join("\n"), /the notice that must remain visible/);
});

test("NB-14: an over-width cluster wraps into its own line, not a blank one first", () => {
  // A cluster wider than the whole line (한 is 2 cells, the line is 1) used
  // to push the still-empty line before itself: a blank row no Human typed.
  assert.deepEqual(wrap("한한한", 1), ["한", "한", "한"]);
  // The same at a line start after other paragraphs: text that precedes the
  // cluster is pushed, the empty line under the cluster is not.
  assert.deepEqual(wrap("한ab", 1), ["한", "a", "b"]);
  assert.deepEqual(wrap("a 한", 1).every(line => line.length > 0), true);
  // The boundary: an empty paragraph is still one empty line, as before.
  assert.deepEqual(wrap("", 5), [""]);
});

test("NB-15: a destroyed output takes no frame -- draw, repaint and restore skip the write", () => {
  const input = { isTTY: true, setRawMode() {}, resume() {}, pause() {}, on() {}, off() {} };
  const writes: string[] = [];
  const output = {
    isTTY: true, columns: 80, rows: 24, destroyed: false,
    on() {}, off() {},
    write(text: string) { if (this.destroyed) throw new Error("write after destroyed"); writes.push(text); return true; },
  };
  const terminal = openTerminal({ input: input as never, output: output as never });
  terminal.draw(["a frame"]);
  assert.equal(writes.length, 2, "setup and one frame");
  output.destroyed = true;
  assert.doesNotThrow(() => { terminal.draw(["another"]); terminal.repaint(); terminal.restore(); });
  assert.equal(writes.length, 2, "no write touched the dead stream");
});

test("NB-15: a live stream's write failure still reaches the caller that owns it", () => {
  // The chooser relies on the throw to close rather than escape its resize
  // listener, so "guarded" must not mean "swallowed everywhere".
  const input = { isTTY: true, setRawMode() {}, resume() {}, pause() {}, on() {}, off() {} };
  const output = {
    isTTY: true, columns: 80, rows: 24, destroyed: false,
    on() {}, off() {},
    write(text: string) { if (String(text).includes("frame")) throw new Error("refused"); return true; },
  };
  const terminal = openTerminal({ input: input as never, output: output as never });
  assert.throws(() => terminal.draw(["a frame"]));
  terminal.restore(); // its codes name no frame; the exit hook returns.
});

test("NB-15: a draw that throws cannot escape through the app's input listener", () => {
  const terminal = fakeTerminal();
  terminal.draw = () => { throw new Error("stream is gone"); };
  terminal.repaint = () => { throw new Error("stream is gone"); };
  const h = harness({}, terminal);
  // feed() ends in draw(); if the throw escaped it would surface here -- the
  // way it surfaced as an uncaughtException through the real data listener.
  assert.doesNotThrow(() => h.app.feed(Buffer.from("still typing")));
  h.app.feed(ENTER);
  assert.deepEqual(h.prompts, ["still typing"], "the session state still advances");
});
