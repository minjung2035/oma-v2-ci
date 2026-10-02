/** Installed command and original TUI/tools; inference and user files are local fixtures. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "./fixtures/cleanup.js";

const hex = (value: string): string => Buffer.from(value).toString("hex");
const fixtures = join(process.cwd(), "test/fixtures");
for (const ending of ["tools", "config", "empty-extensions", "extensions", "new", "resume", "fork", "fork-ui", "fork-cancel", "reload-update", "reload-failure", "retry", "cancel", "project-seed", "project-seed-resume"]) {
  test(`Personal installed PTY: ${ending}, isolated state and restored terminal`, { timeout: 60_000 }, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-personal-pty-"));
    t.after(() => removeTree(root));
    const prompt = { write: hex("Change the temporary user config\r"), wait: 3 };
    const extensions = [{ write: hex("\x18"), wait: 0.3 }, { write: hex("\x1b[B\r"), wait: 0.3 },
      { write: hex("\r"), wait: 3 }];
    const steps = ending === "config" ? [{ write: hex("\x18"), wait: 0.3 }, { write: hex("\r"), wait: 0.3 },
      { write: hex("scripted-thinking"), wait: 0.3 }, { write: hex("\r"), wait: 0.3 }, { write: hex("\x1b[B\r"), wait: 0.5 }, prompt]
      : ending === "empty-extensions" ? [...extensions, prompt]
      : ending === "extensions" ? [prompt, ...extensions, prompt]
      : ending === "new" ? [prompt, { write: hex("/new\r"), wait: 2 }, { write: hex("\x1b[B\r"), wait: 2 }, prompt]
      : ending === "project-seed-resume" ? [prompt, { write: hex("/fixture-break-project\r"), wait: 0.5 },
        { write: hex("/resume\r"), wait: 0.8 }, { write: hex("\r"), wait: 2 }, prompt]
      : ending === "resume" ? [prompt, { write: hex("/resume\r"), wait: 0.8 }, { write: hex("\r"), wait: 2 }, prompt]
      : ending === "fork" ? [prompt, { write: hex("/fixture-fork\r"), wait: 1 }, prompt]
      : ending === "fork-ui" ? [prompt, { write: hex("/fork\r"), wait: 0.5 }, { write: hex("\r"), wait: 1 }, { write: hex("\r"), wait: 3 }]
      : ending === "fork-cancel" ? [prompt, { write: hex("/fork\r"), wait: 0.5 }, { write: hex("\x1b"), wait: 0.5 },
        { write: hex("Continue after cancelled fork\r"), wait: 3 }]
      : ending.startsWith("reload-") ? [prompt, { write: hex(`/fixture-${ending} `), wait: 0.2 }, { write: hex("\r"), wait: 0.5 }, { write: hex("/reload\r"), wait: 1 },
        ...(ending === "reload-update" ? [prompt] : [])]
      : ending === "cancel" ? [{ write: hex("Cancel this turn\r"), wait: 0.5 }, { write: hex("\x1b"), wait: 0.5 }, prompt]
      : [prompt];
    const run = spawnSync("python3", [join(fixtures, "pty-harness.py"), JSON.stringify({
      argv: [process.execPath, join(fixtures, "personal-pty.mjs"), root, ending], ready: hex("Let's build something great"),
      steps: [...steps, { write: hex("\x04"), wait: 2 }],
    })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout), output = Buffer.from(result.output, "hex").toString();
    assert.equal(result.exited, true, output.slice(-8000)); assert.equal(result.code, ending === "reload-failure" ? 1 : 0, output.slice(-8000));
    const engineExit = JSON.parse(readFileSync(join(root, "engine-exit.json"), "utf8"));
    assert.equal(engineExit.code, ending === "reload-failure" ? 1 : 0, output.slice(-8000)); assert.equal(engineExit.signal, null);
    assert.equal(result.echo, true); assert.equal(result.icanon, true);
    assert.ok(output.includes("\x1b[?1049l")); assert.match(output, /oma.{0,40}v0\.1\.0/);
    assert.match(output, /Personal/); assert.match(output, /Let's build something great/); assert.match(output, /╭/);
    assert.doesNotMatch(output, /OMA_PI_BOUNDARY_V1|SOCIETY_PROMPT_SENTINEL|PROJECT_CONTEXT_SENTINEL/);
    if (ending === "config") { assert.match(output, /Config — Personal/); assert.match(output, /Thinking Level/); }
    if (ending.includes("extensions")) assert.match(output, /Personal extension choice saved/);
    if (ending === "new") assert.match(output, /Mode is fixed for this session/);
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
