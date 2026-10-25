/** MODE-006: actual Mac CLI/attach/holder → explicit Personal birth on Linux.
 * No native VM, Keychain, real provider or user's settings are exercised. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree } from "./fixtures/cleanup.js";
const hex = (value: string): string => Buffer.from(value).toString("hex");
for (const ending of ["personal", "close"]) test(`Mac host-new real PTY: ${ending}, original terminal returned`, { timeout: 60_000 }, t => {
  const root = mkdtempSync(join(tmpdir(), "oma-host-new-pty-"));
  t.after(() => removeTree(root));
  const result = spawnSync("python3", [join(process.cwd(), "test/fixtures/pty-harness.py"), JSON.stringify({
    argv: [process.execPath, join(process.cwd(), "test/fixtures/mac-new-handoff-pty.mjs"), root, ending], ready: hex("frame"),
    // The writes ride on drawn markers (the explicit Personal handoff, the
    // installed editor, the scripted reply) instead of fixed pauses; a missed
    // expect still proceeds after expect_timeout like a short wait.
    steps: ending === "personal" ? [
      { write: hex("P"), wait: 0.3, expect: hex("host-personal-requested"), expect_timeout: 8 },
      { write: hex("q"), wait: 0.5, expect: hex("Your ideas, in motion"), expect_timeout: 15 },
        { write: hex("Confirm the new host session\r"), wait: 0.3, expect: hex("HOST_NEW_PERSONAL_COMPLETE"), expect_timeout: 8 },
      { write: hex("\x04"), wait: 2 }]
      : [{ write: hex("q"), wait: 0.5 }],
  })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const terminal = JSON.parse(result.stdout), screen = Buffer.from(terminal.output, "hex").toString();
  if (process.env.OMA_HANDOFF_PTY_CAPTURE) writeFileSync(join(process.env.OMA_HANDOFF_PTY_CAPTURE, `${ending}.json`), JSON.stringify(terminal));
  assert.equal(terminal.exited, true, screen.slice(-8000)); assert.equal(terminal.code, 0, screen.slice(-8000));
  assert.equal(terminal.echo, true); assert.equal(terminal.icanon, true);
  assert.doesNotMatch(screen, /oma — New session/);
  if (ending === "personal") {
    assert.match(screen, /host-personal-requested/);
    const returned = screen.indexOf("\x1b[?1049l"), personal = screen.indexOf("oma — Personal");
    assert.ok(returned >= 0 && personal > returned, "guest terminal must return before the Personal screen");
    assert.match(screen, /HOST_NEW_PERSONAL_COMPLETE/); assert.match(screen, /Personal/);
  }
  const facts = JSON.parse(readFileSync(join(root, "facts.json"), "utf8"));
  assert.equal(facts.starts, 1); assert.equal(facts.attaches, 1);
  assert.equal(facts.births, ending === "personal" ? 1 : 0); assert.equal(facts.requests, ending === "personal" ? 1 : 0);
});
