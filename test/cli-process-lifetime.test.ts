/** DR27 / P0-4: a tool owns its CLI until close, not until a sum-of-phases timer. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { runCliProcess, type CliRun } from "../src/extension/cli-process.js";

const run = (script: string, more: Partial<CliRun> = {}) => runCliProcess({
  node: process.execPath, cli: "-e", args: [script], cwd: process.cwd(), env: {}, grant: null, ...more,
});

test("DR27: an ordinary CLI has no outer phase-sum timer and returns its own answer", async t => {
  const timers: number[] = [];
  const original = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => {
    timers.push(ms); return original(fn, ms, ...args);
  });
  const result = await run("setTimeout(() => { process.stdout.write('receipt'); process.exitCode = 2; }, 150);");
  assert.deepEqual(result, { code: 2, stdout: "receipt", stderr: "", finished: true });
  assert.deepEqual(timers, [], "only the CLI's individual phases may own their observation timers");
});

test("DR27/P0: cancellation waits for actual close even when the child handles TERM and exits zero", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-cancel-"));
  const ready = join(root, "ready"), ended = join(root, "ended");
  const controller = new AbortController();
  const done = run(`
    const fs = require('node:fs');
    process.on('SIGTERM', () => setTimeout(() => {
      fs.writeFileSync(${JSON.stringify(ended)}, 'closed'); process.exit(0);
    }, 150));
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 1000);
  `, { signal: controller.signal });
  try {
    const deadline = performance.now() + 5000;
    while (!existsSync(ready) && performance.now() < deadline) await pause(10);
    assert.ok(existsSync(ready));
    controller.abort();
    const result = await done;
    assert.equal(readFileSync(ended, "utf8"), "closed", "a signal request is not child death");
    assert.equal(result.code, 0);
    assert.equal(result.finished, false, "a cancelled CLI's zero exit is not an operation receipt");
  } finally { controller.abort(); await done; rmSync(root, { recursive: true, force: true }); }
});

test("DR27: an already aborted call does not start a child", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-aborted-"));
  const marker = join(root, "effect");
  try {
    const result = await run(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'effect')`, { signal: AbortSignal.abort() });
    assert.equal(result.finished, false); assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const stream of ["stdout", "stderr"] as const) test(`DR27: ${stream} remains bounded without a whole-task deadline`, async () => {
  const result = await run(`process.${stream}.write(Buffer.alloc(1024 * 1024 + 1)); setTimeout(() => {}, 10000);`);
  assert.equal(result.finished, false);
  assert.ok(Buffer.byteLength(result[stream]) <= 1024 * 1024);
});

test("DR27/P0: a spawn failure is observed and an invalid phase timer cannot become a 1ms timer", async () => {
  const missing = await run("", { node: "/no-such-oma-test-node" });
  assert.equal(missing.finished, false);
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648])
    assert.throws(() => run("", { timeoutMs }), /positive timer-safe integer/);
});
