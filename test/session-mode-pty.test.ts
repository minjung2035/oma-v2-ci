/** Actual terminal ownership of the birth-only chooser. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const hex = (value: string): string => Buffer.from(value).toString("hex");
for (const [input, expected] of [["\r", "society"], ["\x1b[B\r", "personal"], ["\x1b", "cancel"], ["\x03", "cancel"]]) {
  test(`session mode real PTY: ${JSON.stringify(input)} returns ${expected}`, { timeout: 20000 }, () => {
    const run = spawnSync("python3", [join(process.cwd(), "test/fixtures/pty-harness.py"), JSON.stringify({
      argv: [process.execPath, join(process.cwd(), "test/fixtures/session-mode-pty.mjs")], ready: hex("Mode is fixed for this session."),
      steps: [{ write: hex(input!), wait: 0.5 }],
    })], { encoding: "utf8", timeout: 15000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout), output = Buffer.from(result.output, "hex").toString();
    assert.equal(result.exited, true, output); assert.equal(result.code, 0, output);
    assert.equal(result.echo, true); assert.equal(result.icanon, true);
    assert.match(output, /Society \(default\)/); assert.match(output, /Personal/);
    assert.ok(output.includes(`MODE_RESULT=${expected}`));
    assert.ok(output.indexOf("\x1b[?1049l") < output.indexOf("MODE_RESULT="));
  });
}
