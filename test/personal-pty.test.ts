/** Installed command and original TUI/tools; inference and user files are local fixtures. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyInstalledProduct } from "./fixtures/installation.js";
import { removeTree } from "./fixtures/cleanup.js";

const hex = (value: string): string => Buffer.from(value).toString("hex");
const fixtures = join(process.cwd(), "test/fixtures");
let installRoot: string | undefined;
before(() => {
  installRoot = realpathSync(mkdtempSync(join(tmpdir(), "oma-personal-installed-")));
  copyInstalledProduct(fileURLToPath(new URL("../../", import.meta.url)), installRoot);
});
after(() => { if (installRoot !== undefined) removeTree(installRoot); });
for (const ending of ["tools", "config", "empty-extensions", "extensions", "new", "resume", "fork", "fork-ui", "fork-cancel", "reload-update", "reload-failure", "retry", "cancel", "project-seed", "project-seed-resume", "society-bound"]) {
  test(`Personal installed PTY: ${ending}, isolated state and restored terminal`, { timeout: 60_000 }, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-personal-pty-"));
    t.after(() => removeTree(root));
    // Each write waits on the screen marker its response draws (the scripted
    // response text, a picker title, or the redrawn transcript) instead of a
    // fixed pause that can expire mid-draw under load. A missed expect still
    // proceeds after expect_timeout, and the assertions below check the same
    // screen either way. Every marker was verified against captured output:
    // transcript redraws always reprint earlier PERSONAL_RESPONSE_COMPLETE
    // lines once the first turn finished.
    const step = (write: string, marker: string, wait = 0.3, timeout = 8) =>
      ({ write: hex(write), wait, expect: hex(marker), expect_timeout: timeout });
    // Markers behind an engine birth (session chooser picks, /new, fork) can
    // take several seconds to draw under parallel load; they get a wider
    // expect window than redraw-only steps.
    const birth = (write: string, marker: string, wait = 0.3) => step(write, marker, wait, 15);
    const responseMarker = ending === "tools" ? "PERSONAL_TOOLS_COMPLETE"
      : ending.startsWith("project-seed") ? "EXTENSION_TOOL_COMPLETE" : "PERSONAL_RESPONSE_COMPLETE";
    const prompt = birth("Change the temporary user config\r", responseMarker);
    const steps = ending === "config" ? [step("\x18", "Config — Personal"), step("\r", "scripted-thinking"),
      step("scripted-thinking", "scripted-thinking"), step("\r", "Thinking Level"), step("\x1b[B\r", "minimal effort", 0.5), prompt]
      : ending === "empty-extensions" ? [step("\x18", "Config — Personal"), step("\x1b[B\r", "Your ideas, in motion"),
        step("\r", "Personal extension choice saved"), prompt]
      : ending === "extensions" ? [prompt, step("\x18", "Config — Personal"), step("\x1b[B\r", "PERSONAL_RESPONSE_COMPLETE"),
        step("\r", "Personal extension choice saved"), prompt]
      : ending === "new" ? [prompt, birth("/new\r", "Your ideas, in motion", 0.5), prompt]
      : ending === "society-bound" ? [step("/society\r", "Session mode", 0.5),
        step("\r", "Your ideas, in motion", 0.5), prompt,
        step("/society\r", "before starting a conversation", 0.5)]
      : ending === "project-seed-resume" ? [prompt, step("/fixture-break-project\r", "EXTENSION_TOOL_COMPLETE", 0.5),
        step("/resume\r", "[Personal]", 0.5), birth("\r", "PERSONAL_RESPONSE_COMPLETE", 0.5), prompt]
      : ending === "resume" ? [prompt, step("/resume\r", "[Personal]", 0.5), birth("\r", "PERSONAL_RESPONSE_COMPLETE", 0.5), prompt]
      : ending === "fork" ? [prompt, birth("/fixture-fork\r", "Forked to new session", 0.5), prompt]
      : ending === "fork-ui" ? [prompt, step("/fork\r", "Fork from Message", 0.5), birth("\r", "Forked to new session", 0.5),
        step("\r", "PERSONAL_RESPONSE_COMPLETE")]
      : ending === "fork-cancel" ? [prompt, step("/fork\r", "Fork from Message", 0.5), step("\x1b", "PERSONAL_RESPONSE_COMPLETE", 0.5),
        step("Continue after cancelled fork\r", "PERSONAL_RESPONSE_COMPLETE")]
      : ending.startsWith("reload-") ? [prompt, step(`/fixture-${ending} `, "/fixture-reload-", 0.2),
        step("\r", "PERSONAL_RESPONSE_COMPLETE", 0.5),
        birth("/reload\r", ending === "reload-failure" ? "FIXTURE_RELOAD_FAILURE" : "Reloaded keybindings", 0.5),
        ...(ending === "reload-update" ? [prompt] : [])]
      : ending === "cancel" ? [step("Cancel this turn\r", "Cancel this turn", 0.5), step("\x1b", "Operation aborted", 0.5), prompt]
      : [prompt];
    const run = spawnSync("python3", [join(fixtures, "pty-harness.py"), JSON.stringify({
      argv: [process.execPath, join(fixtures, "personal-pty.mjs"), root, ending, installRoot!], ready: hex("Your ideas, in motion"),
      steps: [...steps, { write: hex("\x04"), wait: 2 }],
    })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout), output = Buffer.from(result.output, "hex").toString();
    assert.equal(result.exited, true, `${result.expectMissed} expects missed; ${output.slice(-8000)}`);
    assert.equal(result.code, ending === "reload-failure" ? 1 : 0, output.slice(-8000));
    const engineExit = JSON.parse(readFileSync(join(root, "engine-exit.json"), "utf8"));
    assert.equal(engineExit.code, ending === "reload-failure" ? 1 : 0, output.slice(-8000)); assert.equal(engineExit.signal, null);
    assert.equal(result.echo, true); assert.equal(result.icanon, true);
    assert.ok(output.includes("\x1b[?1049l")); assert.match(output, /oma.{0,40}v0\.1\.0/);
    assert.match(output, /Personal/); assert.match(output, /Your ideas, in motion/); assert.match(output, /╭/);
    assert.doesNotMatch(output, /OMA_PI_BOUNDARY_V1|SOCIETY_PROMPT_SENTINEL|PROJECT_CONTEXT_SENTINEL/);
    if (ending === "config") { assert.match(output, /Config — Personal/); assert.match(output, /Thinking Level/); }
    if (ending.includes("extensions")) assert.match(output, /Personal extension choice saved/);
    assert.doesNotMatch(output, /Mode is fixed for this session/);
    if (ending === "society-bound") { assert.match(output, /Session mode/); assert.match(output, /before starting a conversation/); }
    if (ending.endsWith("resume")) assert.match(output, /\[Personal\]/);
    if (ending.startsWith("project-seed")) assert.match(output, /EXTENSION_TOOL_COMPLETE/);
    if (ending.startsWith("fork-")) assert.match(output, /Fork from Message/);
    if (ending === "fork-ui") assert.match(output, /Forked to new session/);
    if (ending === "fork-cancel") assert.doesNotMatch(output, /Forked to new session/);
    if (ending === "reload-update") assert.match(output, /Reloaded keybindings/);
    if (ending === "reload-failure") assert.match(output, /FIXTURE_RELOAD_FAILURE/);
    const facts = JSON.parse(readFileSync(join(root, "facts.json"), "utf8"));
    assert.equal(facts.births, ending === "new" ? 2 : 1);
  });
}
