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
    const steps = ending.startsWith("reload-") ? [{ write: hex("First\r"), wait: 4 },
      ...(ending === "reload-failure" ? [{ write: hex("/fixture-reload-failure "), wait: 0.2 }, { write: hex("\r"), wait: 0.5 }] : []),
      { write: hex("/reload\r"), wait: 1 },
      ...(ending === "reload-update" ? [{ write: hex("Second 한글 ✅\r"), wait: 4 }, { write: hex("\x04"), wait: 3 }] : [])]
      : ending === "kill" || ending.startsWith("retry-") ? [{ write: hex("First\r"), wait: 4 }] : [
      ...(ending === "resume" ? [{ write: hex("/resume\r"), wait: 1 }, { write: hex("\x1b"), wait: 0.5 }] : []),
      ...(ending === "mail" ? [] : [{ write: hex("/new\r"), wait: 0.2 },
        { write: hex("\x15!touch forbidden\r"), wait: 0.2 },
        { write: hex("\x15First\r"), wait: 0.3 }]),
      { write: hex("Second 한글 ✅\r"), wait: 4 },
      { write: hex("\x18"), wait: 0.5 }, { resize: [30, 100], wait: 0.3 },
      { write: hex("\x18"), wait: 0.3 }, { write: hex("\x04"), wait: 3 },
    ];
    const run = spawnSync("python3", [join(fixtures, "pty-harness.py"), JSON.stringify({
      argv: [process.execPath, join(fixtures, "open-tui-pty.mjs"), side, ending], ready: hex("OPEN_TUI_READY"), steps,
    })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    const output = Buffer.from(result.output, "hex").toString("utf8");
    assert.equal(result.exited, true, output.slice(-6000));
    assert.equal(result.code, 0, output.slice(-6000));
    assert.equal(result.echo, true); assert.equal(result.icanon, true);
    assert.ok(output.includes("\x1b[?1049l"));
    assert.ok(output.includes("╭"), "the original rounded Open TUI editor must be installed");
    // SIGKILL at settlement may precede the UI's scheduled render.
    if (ending === "normal") assert.ok(output.includes("FIRST_RESPONSE_COMPLETE"));
    assert.doesNotMatch(output, /OMA_PI_BOUNDARY_V1|PRIVATE_THINKING_SENTINEL/);
    // Open TUI's own header, named for oma, with oma's key among its tips.
    assert.match(output, /oma.{0,40}v0\.1\.0/); assert.match(output, /Let's build something great/);
    assert.match(output, /Ctrl\+X oma settings/);
    const facts = JSON.parse(readFileSync(side, "utf8"));
    assert.equal(facts.requests, ending.startsWith("retry-") ? 7 : ending === "kill" || ending === "reload-failure" ? 2 : 3);
    if (ending === "reload-update") assert.match(output, /Reloaded keybindings/);
    if (ending === "reload-failure") assert.match(output, /Interactive reload failed:[\s\S]*SOCIETY_RELOAD_FAILURE/);
    if (ending === "normal") { assert.equal(facts.panels, 1); assert.equal(facts.settled, 2); }
    if (ending === "resume") { assert.ok(facts.sessionQueries >= 1); assert.equal(facts.panels, 1); assert.equal(facts.settled, 2); }
  });
}
