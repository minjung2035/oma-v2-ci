import test from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { openTerminal } from "../src/tui/screen.js";
import { DEPLOYMENT_LAYOUT } from "../src/domain/deployment.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

/** Runs the worker to a boundary, kills it there with SIGKILL, and returns. The
 * process is killed for real; nothing here simulates a crash.
 */
async function killAt(workerRoot: string, point: string): Promise<void> {
  const worker = resolve(root, "dist/test/fixtures/surface-crash-worker.js");
  const child = fork(worker, [workerRoot, point], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  try {
    await new Promise<void>((resolveRun, reject) => {
      let reached = false;
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`checkpoint timeout: ${point}: ${stderr}`)); }, 10000);
      child.on("message", (message: { reached?: string }) => {
        if (message.reached !== point) return;
        reached = true;
        child.kill("SIGKILL");
      });
      child.on("exit", (_code, signal) => {
        clearTimeout(timeout);
        if (signal === "SIGKILL" && reached) resolveRun();
        else reject(new Error(`worker ended without reaching ${point}: ${stderr}`));
      });
    });
  } finally { child.kill("SIGKILL"); }
}

for (const point of ["before-write", "after-write"] as const) {
  test(`T111 real SIGKILL at ${point} leaves a configuration a next start can load`, async () => {
    const workerRoot = scratch(`oma-proc-${point}-`);
    try {
      mkdirSync(join(workerRoot, "dist", "src"), { recursive: true });
      writeFileSync(join(workerRoot, DEPLOYMENT_LAYOUT.extension), "export {};\n");
      await killAt(workerRoot, point);

      // Whatever the kill interrupted, the file on disk is a whole, valid
      // configuration: either the value before the edit or the value after it,
      // never a partial render and never a temporary file left in place.
      const path = join(workerRoot, "config.json");
      const loaded = loadConfig(path);
      assert.ok([8, 12].includes(loaded.quota.societyAgents),
        `societyAgents was ${loaded.quota.societyAgents}, which is neither the old nor the new value`);
      if (point === "after-write") assert.equal(loaded.quota.societyAgents, 12);

      const strays = readdirSync(workerRoot).filter(name => name !== "config.json" && name !== "dist");
      assert.deepEqual(strays, [], `a temporary artefact survived the kill: ${strays.join(", ")}`);
    } finally { rmSync(workerRoot, { recursive: true, force: true }); }
  });
}

test("T112 the terminal owner takes and restores raw mode on a real TTY", () => {
  // A pseudo-terminal, not a pipe: this is the branch a pipe never reaches.
  const probe = resolve(root, "dist/test/fixtures/tty-probe.js");
  const run = spawnSync("script", ["-qec", `${process.execPath} ${probe}`, "/dev/null"], {
    encoding: "utf8", timeout: 20000,
  });
  assert.equal(run.status, 0, `pty probe failed: ${run.stderr || run.stdout}`);
  const report = /OMA_TTY_REPORT (\{.*\})/.exec(run.stdout ?? "");
  assert.ok(report, `probe produced no report: ${run.stdout}`);
  const observed = JSON.parse(report[1]!) as {
    isTTY: boolean; rawEnabled: boolean; rawRestored: boolean;
    columns: number; rows: number; keys: string[]; pasted: string[];
    pasteOn: boolean; pasteOff: boolean;
  };
  assert.equal(observed.isTTY, true, "the probe must run under a real terminal");
  assert.equal(observed.rawEnabled, true, "raw mode must be taken so keys arrive unbuffered");
  assert.equal(observed.rawRestored, true, "raw mode must be released again, even on an abrupt end");
  assert.ok(observed.columns > 0 && observed.rows > 0, "a real terminal reports a size");
  // The keys the probe typed arrive as the panel's vocabulary, through a pty,
  // and a pasted block arrives as one key rather than as its keystrokes.
  assert.deepEqual(observed.keys, ["panel", "right", "paste", "escape"]);
  assert.deepEqual(observed.pasted, ["a\nb"], "a paste through a real terminal must stay one input");
  // Asking for bracketed paste is what makes that true, so the owner must take
  // the mode at the device and give it back with the rest.
  assert.equal(observed.pasteOn, true, "bracketed paste mode was never requested");
  assert.equal(observed.pasteOff, true, "bracketed paste mode was left on after restore");
});

test("T112 a non-TTY stream never attempts raw mode", () => {
  let rawCalls = 0;
  const input = { isTTY: false, resume() {}, pause() {}, on() {},
    setRawMode() { rawCalls += 1; } } as unknown as NodeJS.ReadStream;
  const written: string[] = [];
  const output = { columns: 80, rows: 24, write(text: string) { written.push(text); return true; }, on() {} } as unknown as NodeJS.WriteStream;
  const terminal = openTerminal({ input, output });
  terminal.draw(["a"]);
  terminal.restore();
  assert.equal(rawCalls, 0, "a pipe has no raw mode to take");
  assert.ok(written.length > 0);
  // Every terminal mode the owner takes is given back, in the reverse order:
  // a stream left in bracketed paste mode makes the next program's input
  // arrive wrapped in markers it never asked for.
  const stream = written.join("");
  const ESC = String.fromCharCode(27);
  assert.ok(stream.includes(`${ESC}[?2004h`), "bracketed paste mode was never requested");
  assert.ok(stream.indexOf(`${ESC}[?2004l`) > stream.indexOf(`${ESC}[?2004h`),
    "bracketed paste mode was not released after it was taken");
});
