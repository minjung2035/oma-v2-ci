/** V28A (WP28, D05): the TUI says what happened, with the real app over a real
 * Principal mailbox. A message stays "not yet delivered to the Principal's
 * session" until a batch carrying it settles; opening it in the TUI writes
 * nothing and claims neither presentation nor acknowledgement. Unknown status
 * stays unknown, and a configured model is not shown as the running one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TuiApp, type AppPorts } from "../src/tui/app.js";
import type { Terminal } from "../src/tui/screen.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "../src/tui/sources/mail.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

const ESC = String.fromCharCode(27);
const CTRL_X = Buffer.from([0x18]);
const RIGHT = Buffer.from(`${ESC}[C`);
const ENTER = Buffer.from("\r");

function terminal(): Terminal & { frames: string[][] } {
  const frames: string[][] = [];
  return { frames, columns: 110, rows: 20, draw(lines) { frames.push([...lines]); }, onKeys() {}, onResize() {}, restore() {} };
}

test("V28A: a message the TUI shows is still waiting for the Principal's session, and opening it changes nothing", () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "oma-v28a-"));
  try {
    const mailbox = principalMailbox(stateRoot);
    mkdirSync(mailbox.newDir, { recursive: true });
    mkdirSync(mailbox.curDir, { recursive: true });
    const id = "m-00000000-0000-4000-8000-0000000000c1-0";
    writeFileSync(join(mailbox.newDir, id), "From: worker-a\nSubject: API 선택 필요\nX-OMA-Kind: question\n\n어느 API를 쓸까요?\n");
    const before = statSync(join(mailbox.newDir, id)).mtimeMs;
    const screen = terminal();
    const ports: AppPorts = {
      configFields: () => [], extensions: () => [],
      dashboard: () => ({ ...unknownDashboard(), unread: unreadCount(mailbox), principalModel: { configured: "review", session: "standard" } }),
      mail: () => readMailbox(mailbox), body: path => readBody(path),
      setField: () => ({ kind: "saved" }), setExtension: () => {}, submitPrompt: () => ({ kind: "accepted" }), quit: () => {},
    };
    const app = new TuiApp(ports, screen, 262144);
    app.refresh(); app.draw();
    const last = () => (screen.frames.at(-1) ?? []).join("\n");
    app.feed(CTRL_X);
    const dashboard = last();
    assert.match(dashboard, /Mail\s+1건 Principal 세션에 전달 대기/);
    assert.doesNotMatch(dashboard, /\bunread\b/, "the count was worded as the Human's reading");
    // No observation is shown as unknown with its reason, never as 0 or idle.
    assert.match(dashboard, /Active\s+unknown \(/);
    assert.match(dashboard, /Pending\s+unknown \(/);
    // The configured model is not the running one.
    assert.match(dashboard, /review \(설정값 · 다음 세션부터 · 현재 세션은 standard로 시작\)/);
    app.feed(RIGHT); app.feed(RIGHT);
    assert.match(last(), /● Principal 세션에 아직 전달되지 않음 · 여기서 여는 것은 전달·확인이 아닙니다/);
    app.feed(ENTER);
    assert.match(last(), /어느 API를 쓸까요\?/, "the message did not open");
    // Opening it wrote nothing: still new, nothing in cur, same file.
    assert.deepEqual(readdirSync(mailbox.newDir), [id]);
    assert.deepEqual(readdirSync(mailbox.curDir), []);
    assert.equal(statSync(join(mailbox.newDir, id)).mtimeMs, before);
    assert.equal(unreadCount(mailbox), 1);
  } finally { rmSync(stateRoot, { recursive: true, force: true }); }
});
