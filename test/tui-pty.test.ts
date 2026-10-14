/** V28B (WP28): the product's terminal owner and key decoder in a real pty.
 * However the process ends -- the normal quit, an exit that forgot to restore,
 * a rejection after the terminal opened -- the terminal is handed back with
 * echo and line mode on and the alternate screen, hidden cursor and bracketed
 * paste undone. Input split inside a multibyte character is one key, and a
 * resize reaches the owner. The harness is Python's pty module; the code under
 * test is the product's `openTerminal` and `KeyDecoder`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("..", import.meta.url));
const fixtures = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));
const python = spawnSync("python3", ["-c", "import pty, termios"]).status === 0;
const hex = (text: string): string => Buffer.from(text, "utf8").toString("hex");
const RESTORED = "\u001b[?2004l\u001b[?25h\u001b[?1049l";

function runInPty(mode: string) {
  const work = mkdtempSync(join(tmpdir(), "oma-v28b-"));
  try {
    const side = join(work, "side.jsonl");
    const korean = hex("한");
    // The driver draws this once its keys handler is installed.
    const spec = { argv: [process.execPath, join(fixtures, "pty-terminal.mjs"), dist, side, mode], ready: hex("V28B ready"),
      steps: [{ write: korean.slice(0, 4) }, { write: korean.slice(4) }, { resize: [30, 100] }, { write: hex("q"), wait: 0.5 }] };
    const run = spawnSync("python3", [join(fixtures, "pty-harness.py"), JSON.stringify(spec)], { encoding: "utf8", timeout: 30_000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout) as { exited: boolean; code: number | null; echo: boolean; icanon: boolean; output: string };
    const notes = readFileSync(side, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    return { ...result, text: Buffer.from(result.output, "hex").toString("utf8"), notes };
  } finally { rmSync(work, { recursive: true, force: true }); }
}

for (const [mode, code] of [["normal", 0], ["exit-without-restore", 3], ["reject", 1]] as const) {
  test(`V28B: ${mode} hands the terminal back restored`, { skip: python ? false : "python3 with pty/termios is not available", timeout: 60_000 }, () => {
    const run = runInPty(mode);
    assert.equal(run.exited, true);
    assert.equal(run.code, code);
    assert.equal(run.echo, true, "echo was left off");
    assert.equal(run.icanon, true, "line mode was left off");
    // Handed back, and not taken again: what follows the last restore (an
    // error message, say) is written to the Human's own screen.
    const at = run.text.lastIndexOf(RESTORED);
    assert.ok(at >= 0, `the screen was not handed back: ${JSON.stringify(run.text.slice(-60))}`);
    assert.doesNotMatch(run.text.slice(at + RESTORED.length), /\u001b\[\?(?:1049h|25l|2004h)/, "the terminal was taken again after the restore");
    // Split inside one code point, it is still one key.
    assert.deepEqual(run.notes.filter(note => note.key).map(note => note.key), [{ kind: "char", value: "한" }, { kind: "char", value: "q" }]);
    assert.deepEqual(run.notes.find(note => note.resized), { resized: true, columns: 100, rows: 30 });
  });
}
