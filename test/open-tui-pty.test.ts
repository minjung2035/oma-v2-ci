import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixtures = join(process.cwd(), "test/fixtures");
const python = spawnSync("python3", ["-c", "import pty, termios"]).status === 0;
const hex = (text: string): string => Buffer.from(text).toString("hex");
for (const ending of ["normal", "resume", "kill", "mail", "retry-recover", "retry-exhaust", "reload-update", "reload-failure"]) {
  test(`Open TUI: actual Principal tools, queued input, panel and ${ending} terminal restoration`, {
    skip: python ? false : "python3 pty unavailable", timeout: 60_000,
  }, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-open-tui-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const side = join(root, "facts.json");
    // `/new` and `!touch` are Pi's own and reach no model; the prompts are OMA's.
    // Each write waits on the screen marker its response draws (the settle
    // marker the fixture prints, the panel footer, the redrawn transcript)
    // rather than a fixed pause that can expire mid-draw under load. A missed
    // expect still proceeds like a short wait; the screen assertions below
    // check the same things either way.
    const step = (write: string, marker: string, wait = 0.3, timeout = 8) =>
      ({ write: hex(write), wait, expect: hex(marker), expect_timeout: timeout });
    // Engine work (settle, restart, retry) can take >10s under parallel load;
    // those markers get a wider window than redraw-only steps.
    const settled = (write: string, marker: string, wait = 0.3) => step(write, marker, wait, 25);
    const steps = ending.startsWith("reload-") ? [settled("First\r", "RUN_SETTLED_1"),
      ...(ending === "reload-failure" ? [{ write: hex("/fixture-reload-failure "), wait: 0.2 }, step("\r", "Society reload failure prepared", 0.2)] : []),
      step("/reload\r", ending === "reload-failure" ? "Interactive reload failed" : "Reloaded keybindings", 0.5, 15),
      ...(ending === "reload-update" ? [settled("Second 한글 ✅\r", "RUN_SETTLED_2"), { write: hex("\x04"), wait: 0.3 }] : [])]
      : ending === "kill" || ending.startsWith("retry-") ? [settled("First\r", "RUN_SETTLED_1")] : [
      ...(ending === "resume" ? [step("/resume\r", "No sessions in current folder", 0.2),
        step("\x1b", "Your ideas, in motion", 0.2)] : []),
      // `/new` only queues a keystroke; the session birth is slow and emits no
      // marker of its own, so the queue drains into the next real marker
      // (`$ touch forbidden`, then the fixture's settle line).
      ...(ending === "mail" ? [] : [{ write: hex("/new\r"), wait: 0.5 },
        step("\x15!touch forbidden\r", "$ touch forbidden", 0.2, 20),
        settled("\x15First\r", "RUN_SETTLED_1")]),
      settled("Second 한글 ✅\r", "RUN_SETTLED_2"),
      // B2: `/thinking hide` is OMA's exact command; the setting is already
      // hidden, so the deterministic set confirms the state without ever
      // revealing the sentinel that `/thinking show` would draw.
      step("/thinking hide\r", "Thinking blocks: hidden", 0.2),
      step("\x18", "Ctrl+X Close", 0.2), { resize: [30, 100], wait: 0.3 },
      step("\x18", "SECOND_RESPONSE_COMPLETE", 0.2), { write: hex("\x04"), wait: 0.3 },
    ];
    const run = spawnSync("python3", [join(fixtures, "pty-harness.py"), JSON.stringify({
      argv: [process.execPath, join(fixtures, "open-tui-pty.mjs"), side, ending], ready: hex("OPEN_TUI_READY"), steps,
    })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    const output = Buffer.from(result.output, "hex").toString("utf8");
    assert.equal(result.exited, true, `${result.expectMissed} expects missed; ${output.slice(-6000)}`);
    assert.equal(result.code, 0, output.slice(-6000));
    assert.equal(result.echo, true); assert.equal(result.icanon, true);
    assert.ok(output.includes("\x1b[?1049l"));
    assert.ok(output.includes("╭"), "the original rounded Open TUI editor must be installed");
    // SIGKILL at settlement may precede the UI's scheduled render.
    if (ending === "normal") assert.ok(output.includes("FIRST_RESPONSE_COMPLETE"));
    assert.doesNotMatch(output, /OMA_PI_BOUNDARY_V1|PRIVATE_THINKING_SENTINEL/);
    // Open TUI's own header, named for oma, with oma's key among its tips.
    assert.match(output, /oma.{0,40}v0\.1\.0/); assert.match(output, /Your ideas, in motion/);
    assert.match(output, /Ctrl\+X oma settings/);
    // B1: the compact row — the tool's display name and its control row; the
    // wire name `oma_mail_send` never reaches the screen (a renderer throw
    // would surface it through Pi's call fallback, so this covers both).
    assert.match(output, /mail send/);
    assert.match(output, /Done in [0-9.]+(m )?s/);
    assert.doesNotMatch(output, /oma_mail_send/);
    // B2: the intercepted command answered on the real screen.
    if (ending !== "kill" && !ending.startsWith("retry-") && !ending.startsWith("reload-"))
      assert.match(output, /Thinking blocks: hidden/);
    // B3: in the mail ending the second prompt was typed while the delivery
    // owned the run, so OMA's own queue showed it above the editor.
    if (ending === "mail") {
      assert.match(output, /Queued \(1\)/);
      assert.match(output, /1\. Second 한글/);
    }
    const facts = JSON.parse(readFileSync(side, "utf8"));
    assert.equal(facts.requests, ending.startsWith("retry-") ? 7 : ending === "kill" || ending === "reload-failure" ? 2 : 3);
    if (ending === "reload-update") assert.match(output, /Reloaded keybindings/);
    if (ending === "reload-failure") assert.match(output, /Interactive reload failed:[\s\S]*SOCIETY_RELOAD_FAILURE/);
    if (ending === "normal") { assert.equal(facts.panels, 1); assert.equal(facts.settled, 2); }
    if (ending === "resume") { assert.ok(facts.sessionQueries >= 1); assert.equal(facts.panels, 1); assert.equal(facts.settled, 2); }
  });
}
