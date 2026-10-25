import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
/** macos-platform §4.6 (MAC-220..222, MV-12): a society's terminal session
 * holder, run as the real entry on a real pseudo-terminal, with a stand-in
 * TUI that draws only when something changes -- as the product's does. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, type Socket } from "node:net";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { hostPersonalHistoryQuery } from "#oma-test/app/platform/host/personal-histories";
import { parseHostHistoryQuery } from "@oma/protocol/host-history";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TerminalModes } from "#oma-test/app/platform/terminal-modes";
import { holdSocketNames } from "./fixtures/socket-names.js";
import {
  TerminalFrameParser, encodeTerminalFrame, encodeTerminalJson, parseTerminalJson, resizePayload, type TerminalFrame,
} from "@oma/protocol/host-guest";

const here = fileURLToPath(new URL(".", import.meta.url));
const holderEntry = join(here, "../..", DEPLOYMENT_LAYOUT.entries.guestSession);
const fakeTui = join(here, "..", "..", "test", "fixtures", "fake-tui.mjs");
const setsid = existsSync("/usr/bin/setsid");

test("DR29: actual private socket, host saved history and holder retain the live program until exit", { skip: !setsid, timeout: 15_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-real-host-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "project"), sessionRoot = join(root, ".personal", randomUUID()); mkdirSync(cwd);
  const birth = publishSessionBirth(sessionRoot, newSessionBirth(sessionRoot, "personal", cwd));
  mkdirSync(birth.history);
  writeFileSync(join(birth.history, "saved.jsonl"), JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION,
    id: randomUUID(), timestamp: "2026-10-02T00:00:00Z", cwd }) + "\n");
  const { child, socketPath, exited } = await holder(t, [process.execPath, join(process.cwd(), "test/fixtures/host-history-bridge.mjs")]);
  const screen = await Screen.attach(socketPath);
  const handled = new Set<string>();
  const responder = setInterval(() => {
    for (const frame of screen.controls.filter(frame => frame.kind === "historyQuery")) {
      const query = parseHostHistoryQuery(JSON.parse(frame.payload.toString()));
      if (handled.has(query.id)) continue;
      handled.add(query.id);
      void hostPersonalHistoryQuery(root, query).then(result => screen.socket.write(encodeTerminalJson("histories", { id: query.id, result })));
    }
  }, 10);
  t.after(() => clearInterval(responder));
  await screen.until(/frame/, "controlled program"); screen.type("H");
  await screen.until(/host-history-selected/, "observed saved history and flushed private EOF");
  assert.equal(child.exitCode, null); assert.equal(screen.control("exit"), null);
  screen.type("q"); await screen.closed;
  const end = screen.control("exit"); assert.equal(end?.code, 0); assert.equal(end?.next, "resume");
  assert.match(String(end?.history), /^oma-host-history:/); assert.equal(handled.size, 2); assert.equal(await exited, 0);
});

interface Holder { readonly child: ChildProcess; readonly socketPath: string; readonly exited: Promise<number | null>; log: string }
async function holder(t: import("node:test").TestContext, program: readonly string[] = [process.execPath, fakeTui]): Promise<Holder> {
  const dir = mkdtempSync(join(tmpdir(), "oma-session-"));
  const socketNames = holdSocketNames(dir);
  const socketPath = join(dir, "s.sock");
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ["--import", join(here, "fixtures", "socket-names.js"), holderEntry, "--socket", socketPath, "--cwd", dir, "--", ...program],
      { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...socketNames.env } });
  } catch (error) { socketNames.close(); rmSync(dir, { recursive: true, force: true }); throw error; }
  const exited = new Promise<number | null>(resolve => child.once("exit", code => resolve(code)));
  const held: Holder = { child, socketPath, exited, log: "" };
  child.stderr!.on("data", (chunk: Buffer) => { held.log += chunk.toString("utf8"); process.stderr.write(chunk); });
  t.after(async () => {
    try { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
    finally { socketNames.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  for (let i = 0; i < 100 && !existsSync(socketPath); i++) await new Promise(r => setTimeout(r, 20));
  assert.ok(existsSync(socketPath), "the holder listens");
  return held;
}

/** One screen: what it has been shown, and the control frames it received. */
class Screen {
  readonly socket: Socket;
  shown = "";
  readonly controls: TerminalFrame[] = [];
  readonly closed: Promise<void>;
  private readonly parser = new TerminalFrameParser();
  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      for (const frame of this.parser.feed(chunk)) {
        if (frame.kind === "output") this.shown += frame.payload.toString("latin1");
        else this.controls.push(frame);
      }
    });
    this.closed = new Promise(resolve => socket.once("close", () => resolve()));
  }
  static async attach(path: string, options: { takeover?: true; size?: [number, number] } = {}): Promise<Screen> {
    const socket = connect(path);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    const screen = new Screen(socket);
    socket.write(encodeTerminalJson("attach", options.takeover === true ? { takeover: true } : {}));
    const [columns, rows] = options.size ?? [100, 30];
    socket.write(encodeTerminalFrame("resize", resizePayload(columns, rows)));
    return screen;
  }
  type(text: string): void { this.socket.write(encodeTerminalFrame("input", Buffer.from(text, "latin1"))); }
  async until(pattern: RegExp, what: string): Promise<void> {
    for (let i = 0; i < 150; i++) { if (pattern.test(this.shown)) return; await new Promise(r => setTimeout(r, 20)); }
    assert.fail(`${what}: never shown; the screen has ${JSON.stringify(this.shown.slice(-300))}`);
  }
  control(kind: string): Record<string, unknown> | null {
    const frame = this.controls.find(item => item.kind === kind);
    return frame === undefined ? null : parseTerminalJson(frame.payload, Object.keys(JSON.parse(frame.payload.toString("utf8")) as object));
  }
}

test("§4.6: the modes a screen needs are followed across read boundaries", () => {
  const modes = new TerminalModes();
  modes.feed(Buffer.from("hello \u001b[?10"));
  modes.feed(Buffer.from("49h\u001b[?25l\u001b"));
  modes.feed(Buffer.from("[?2004h text"));
  assert.equal(modes.replay(), "\u001b[?1049h\u001b[?2004h\u001b[?25l");
  assert.equal(modes.undo(), "\u001b[?2004l\u001b[?25h\u001b[?1049l", "a leaving screen is put back, alternate screen last");
  modes.feed(Buffer.from("\u001b[?2004l\u001b[?25h\u001b[?1049l"));
  assert.equal(modes.replay(), "");
});

test("P0V-109 (G12-05): a program's mouse reporting, cursor keys and synchronized output are put back when its screen leaves", () => {
  const modes = new TerminalModes();
  modes.feed(Buffer.from("\u001b[?1;1000;1006h\u001b[?2026h\u001b[?7l\u001b[?47h\u001b[?1004h"));
  assert.equal(modes.undo(), "\u001b[?1l\u001b[?7h\u001b[?1000l\u001b[?1004l\u001b[?1006l\u001b[?2026l\u001b[?1049l");
  assert.equal(modes.replay(), "\u001b[?1049h\u001b[?1h\u001b[?7l\u001b[?1000h\u001b[?1004h\u001b[?1006h\u001b[?2026h");
  // A mode the program turned back is nothing to put back; one not followed is left alone.
  modes.feed(Buffer.from("\u001b[?1000l\u001b[?7h\u001b[?12h"));
  assert.equal(modes.undo(), "\u001b[?1l\u001b[?1004l\u001b[?1006l\u001b[?2026l\u001b[?1049l");
});

test("MAC-221/MV-12: a screen that leaves does not stop the program; one that comes back gets its modes and the whole screen", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath } = await holder(t);
  const first = await Screen.attach(socketPath);
  await first.until(/frame \d+ 100x30/, "the first screen's size");
  first.type("a");
  await first.until(/typed:a/, "input reaching the program");
  const pid = /pid (\d+)/.exec(first.shown)![1];
  first.socket.destroy();
  await first.closed;

  // Same size: the kernel reports no resize, so only the redraw request can
  // make a program that draws on change draw again.
  const second = await Screen.attach(socketPath);
  await second.until(/frame \d+ 100x30 pid \d+/, "the whole screen drawn again");
  assert.match(second.shown, /^\u001b\[\?1049h\u001b\[\?2004h\u001b\[\?25l/, "the modes come first");
  assert.equal(/pid (\d+)/.exec(second.shown)![1], pid, "the same program, still running");
  second.socket.destroy();
});

test("MAC-220: one screen at a time; a takeover tells the one it replaces", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath } = await holder(t);
  const first = await Screen.attach(socketPath);
  await first.until(/frame/, "the first screen");
  const second = await Screen.attach(socketPath);
  await second.closed;
  assert.deepEqual(second.control("refused"), { code: "ATTACH_CONFLICT", message: "this society is shown on another screen" });
  const third = await Screen.attach(socketPath, { takeover: true, size: [90, 20] });
  await third.until(/frame \d+ 90x20/, "the screen that took over");
  await first.closed;
  assert.deepEqual(first.control("detached"), { reason: "taken-over" });
  third.socket.destroy();
});

test("MAC-221: the program's end reaches the attached screen, and the holder ends with it", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath, exited } = await holder(t);
  const screen = await Screen.attach(socketPath);
  await screen.until(/frame/, "the screen");
  screen.type("q");
  await screen.closed;
  assert.match(screen.shown, /\u001b\[\?1049l$/, "the program's own restore reached the screen before its end");
  assert.deepEqual(screen.control("exit"), { code: 0, signal: null });
  assert.equal(await exited, 0);
  assert.equal(existsSync(socketPath), false, "the socket is gone with it");
});

for (const failure of [false, true]) test(`MODE-006: a real holder does not send the queued host-new request before actual program exit; failure=${failure}`, { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath, child, exited } = await holder(t);
  const screen = await Screen.attach(socketPath); await screen.until(/frame/, "the screen");
  screen.type("N"); await screen.until(/host-new-requested/, "the private request was written");
  assert.equal(child.exitCode, null); assert.equal(screen.control("exit"), null);
  if (failure) { screen.type("F"); await screen.until(/host-new-requested/, "the still-live screen"); }
  screen.type("q"); await screen.closed;
  assert.deepEqual(screen.control("exit"), failure ? { code: 7, signal: null } : { code: 0, signal: null, next: "new" });
  assert.equal(await exited, failure ? 7 : 0);
});

test("Session mode: real guest holder carries Personal to the host only after writer exit", { skip: !setsid }, async t => {
  const { socketPath, child, exited } = await holder(t);
  const screen = await Screen.attach(socketPath); await screen.until(/frame/, "the screen");
  screen.type("P"); await screen.until(/host-personal-requested/, "the mode request was written");
  assert.equal(child.exitCode, null); assert.equal(screen.control("exit"), null);
  screen.type("q"); await screen.closed;
  assert.deepEqual(screen.control("exit"), { code: 0, signal: null, next: "new", mode: "personal" });
  assert.equal(await exited, 0);
});

test("MAC-221: output the program wrote just before it ended reaches the screen before the end does", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath } = await holder(t);
  const screen = await Screen.attach(socketPath);
  await screen.until(/frame/, "the screen");
  screen.type("Q");
  await screen.closed;
  assert.ok(screen.shown.endsWith(`${"x".repeat(1024)}END\u001b[?1049l`), "the whole last burst arrived");
  assert.deepEqual(screen.control("exit"), { code: 0, signal: null });

  const { socketPath: other } = await holder(t);
  const late = await Screen.attach(other);
  await late.until(/frame/, "the second screen");
  late.type("D");
  await late.closed;
  assert.match(late.shown, /LATE$/, "what was still being written when the program ended arrived before the end");
  assert.deepEqual(late.control("exit"), { code: 0, signal: null });
});

test("§4.6: a connection that does not begin with attach is dropped and the program is untouched", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { socketPath, child } = await holder(t);
  const socket = connect(socketPath);
  await new Promise<void>(resolve => socket.once("connect", resolve));
  socket.write(encodeTerminalFrame("input", Buffer.from("q")));
  await new Promise<void>(resolve => socket.once("close", () => resolve()));
  const screen = await Screen.attach(socketPath);
  await screen.until(/frame/, "the program, still there");
  assert.equal(child.exitCode, null);
  screen.socket.destroy();
});

test("MAC-320 / P0V-81: a holder asked to stop, by any signal that asks, asks its program to end and ends with its status", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { HOST_LOSS_SIGNALS } = await import("@oma/process/host-loss");
  for (const signal of HOST_LOSS_SIGNALS) {
    const { child, exited } = await holder(t);
    await new Promise(r => setTimeout(r, 300));
    child.kill(signal);
    assert.equal(await exited, 7, `${signal}: the program's own SIGTERM handling did not decide the end`);
  }
});

test("P0V-80 / §4.6: a holder that dies hangs up its program, which holds no side of the terminal but its own", { skip: setsid ? false : "util-linux setsid is not available" }, async t => {
  const { child, socketPath, exited } = await holder(t);
  const screen = await Screen.attach(socketPath);
  await screen.until(/pid \d+/, "the program's pid");
  const pid = Number(/pid (\d+)/.exec(screen.shown)![1]);
  t.after(() => { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } });
  const held = readdirSync(`/proc/${pid}/fd`).map(fd => { try { return readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { return ""; } });
  assert.ok(!held.includes("/dev/ptmx"), `the program holds its terminal's master side: ${held.join(" ")}`);
  child.kill("SIGKILL");
  await exited;
  for (let i = 0; i < 150 && existsSync(`/proc/${pid}`); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(existsSync(`/proc/${pid}`), false, "the program outlived the holder of its terminal");
  screen.socket.destroy();
});

test("DR18 D-1: the program speaks product text, and what it writes for diagnosis goes to the holder's log, not the screen", { skip: !setsid }, async t => {
  const held = await holder(t, ["/bin/sh", "-c",
    // A screen sees what is written after it attaches, so this keeps writing.
    'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do printf "surface:%s|" "$OMA_PRODUCT_TEXT"; echo "diagnosis /var/lib/oma" >&2; sleep 0.2; done']);
  const screen = await Screen.attach(held.socketPath);
  await screen.until(/surface:1\|/, "the product-text marker");
  for (let i = 0; i < 150 && !held.log.includes("diagnosis /var/lib/oma"); i++) await new Promise(r => setTimeout(r, 20));
  assert.match(held.log, /diagnosis \/var\/lib\/oma/, "the program's stderr is the holder's, which is the guest's log");
  assert.doesNotMatch(screen.shown, /diagnosis/, "and never the screen");
  screen.socket.destroy();
});
