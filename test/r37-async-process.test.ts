import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProcess, runProcess, stopOwnedChild } from "@oma/process/async";
import { runProcessSync } from "@oma/process/run";
import { PreparationExecutor } from "@oma/process/preparation";
import type { CommandSpec } from "@oma/process/command";

// These are test budgets, not new production defaults or measured performance.
function command(code: string, overrides: Partial<CommandSpec> = {}): CommandSpec {
  return { executable: process.execPath, argv: ["-e", code], env: { PATH: process.env.PATH },
    timeoutMs: 2000, stdoutBytes: 1024, stderrBytes: 1024, ...overrides };
}

test("R37: command argv, environment and input bytes are snapshotted before awaiting", { timeout: 10000 }, async () => {
  const argv = ["-e", "let x=[];process.stdin.on('data',b=>x.push(b));process.stdin.on('end',()=>process.stdout.write(process.env.TAG+':'+Buffer.concat(x)))"];
  const env = { TAG: "original" };
  const input = Buffer.from("body");
  const task = startProcess({ ...command(""), argv, env, input });
  argv[1] = "process.exit(77)"; env.TAG = "changed"; input.fill(120);
  const result = await task.result; await task.closed;
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString(), "original:body");
});

test("R37: child preparation yields the event loop without claiming a latency improvement", { timeout: 10000 }, async () => {
  const task = startProcess(command("setTimeout(()=>process.stdout.write('done'),200)"));
  let yielded = false;
  await new Promise<void>(resolve => setImmediate(() => { yielded = true; resolve(); }));
  assert.equal(yielded, true);
  assert.equal((await task.result).stdout.toString(), "done"); await task.closed;
});

test("R37: stdout overflow is bounded and cannot be a successful observation", { timeout: 10000 }, async () => {
  const task = startProcess(command("process.stdout.write(Buffer.alloc(4096,65))", { stdoutBytes: 8 }));
  const result = await task.result; await task.closed;
  assert.equal(result.kind, "output-limited"); assert.equal(result.stdout.length, 8); assert.equal(result.stdoutTruncated, true);
});

test("R37: explicit diagnostic stderr discard still drains without unbounded retention", { timeout: 10000 }, async () => {
  const task = startProcess(command("process.stderr.write(Buffer.alloc(4096,66));process.stdout.write('ok')", { stderrBytes: 8, stderrOverflow: "discard" }));
  const result = await task.result; await task.closed;
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
  assert.equal(result.stderr.length, 8); assert.equal(result.stderrTruncated, true); assert.equal(result.stdout.toString(), "ok");
});

test("R37: a command making progress is never cut by the silence window; one that says nothing stalls honestly", { timeout: 10000 }, async () => {
  // Progress resets the window: 4 chunks 120ms apart under a 300ms window
  // live; the same gap ending after the last byte ends the command stalled.
  const progress = await runProcess(command(
    "let n=0; const t=setInterval(()=>{process.stdout.write('tick'); if(++n===4){clearInterval(t);process.exit(0);}},120)",
    { silenceMs: 300, timeoutMs: 5000 }));
  assert.equal(progress.kind, "exited");
  assert.equal(progress.stdout.toString(), "tick".repeat(4));

  const stalled = await runProcess(command(
    "process.stdout.write('one'); setInterval(()=>{},1000)",
    { silenceMs: 250, timeoutMs: 5000 }));
  assert.equal(stalled.kind, "stalled", "silence past the window is a stall, distinct from the timeout and from refusal");
  assert.equal(stalled.stdout.toString(), "one");
});

test("R37: output past the in-memory budget spills whole -- the file holds every byte, the head stays in the result", { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-r37-spill-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spool = join(dir, "stdout.bin");
  const result = await runProcess(command("process.stdout.write(Buffer.alloc(4096,66))", { stdoutBytes: 8, stdoutSpool: spool }));
  assert.equal(result.kind, "exited", "overflow to a spill file is not an output-limit refusal");
  assert.equal(result.stdoutSpooledTo, spool);
  assert.equal(result.stdout.length, 8, "the retained head is the bounded prefix");
  assert.equal(result.stdoutTruncated, true);
  const whole = readFileSync(spool);
  assert.equal(whole.length, 4096);
  assert.ok(whole.subarray(0, 8).equals(result.stdout), "the file's head is the retained head");
  assert.ok(whole.every(byte => byte === 66), "the file holds the stream complete");
});

test("R37: a spilled stream also keeps the silence window honest -- progress to the file is progress", { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-r37-spill-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const spool = join(dir, "stdout.bin");
  const result = await runProcess(command(
    "let n=0; const t=setInterval(()=>{process.stdout.write(Buffer.alloc(4096,65)); if(++n===4){clearInterval(t);process.exit(0);}},120)",
    { stdoutBytes: 8, stdoutSpool: spool, silenceMs: 400, timeoutMs: 5000 }));
  assert.equal(result.kind, "exited");
  assert.equal(readFileSync(spool).length, 4 * 4096);
});

test("R37: the synchronous runner refuses a silence window it cannot observe, and spills descriptor-direct", () => {
  assert.throws(() => runProcessSync(command("", { silenceMs: 1000 })), TypeError);
  const dir = mkdtempSync(join(tmpdir(), "oma-r37-spool-"));
  try {
    const spool = join(dir, "out.bin");
    const result = runProcessSync(command("process.stdout.write(Buffer.alloc(4096,67))", { stdoutBytes: 8, stdoutSpool: spool }));
    assert.equal(result.kind, "exited");
    assert.equal(result.stdoutSpooledTo, spool);
    assert.equal(result.stdout.length, 0, "the descriptor-direct file keeps nothing in memory");
    assert.equal(readFileSync(spool).length, 4096);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("R37: a failed second spill open leaks no descriptor and keeps the open's own error", { skip: process.platform !== "linux", timeout: 10000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-r37-spool-"));
  try {
    const spec = command("process.stdout.write('x')", {
      stdoutSpool: join(dir, "out.bin"),
      // The parent directory does not exist: the second open fails ENOENT.
      stderrSpool: join(dir, "missing", "err.bin"),
    });
    const fdCount = () => readdirSync("/proc/self/fd").length;
    assert.throws(() => runProcessSync(spec),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      "the failed open's own error still reaches the caller");
    const baseline = fdCount();
    for (let i = 0; i < 16; i++) assert.throws(() => runProcessSync(spec));
    assert.equal(fdCount(), baseline,
      "every failed call returns the descriptor the first open made -- the pre-fix leak grew one fd per call");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("R37: identical stdout and stderr spill paths are refused -- the second O_TRUNC would erase the first stream", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-r37-spool-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shared = join(dir, "shared.bin");
  const spec = command("process.stdout.write('out'); process.stderr.write('err')",
    { stdoutSpool: shared, stderrSpool: shared });
  assert.throws(() => runProcessSync(spec), TypeError,
    "one file cannot be both streams' spill -- both records would claim a file only one stream survived into");
  assert.throws(() => startProcess(spec), TypeError,
    "the asynchronous runner shares the same spec validation");
});

test("R37: timeout and abort never synthesize exit-zero success", { timeout: 10000 }, async () => {
  const timed = startProcess(command("setInterval(()=>{},1000)", { timeoutMs: 100 }));
  const timedResult = await timed.result;
  assert.ok(timedResult.kind === "timed-out" || timedResult.kind === "unobserved"); await timed.closed;
  const controller = new AbortController();
  const aborted = startProcess(command("setInterval(()=>{},1000)"), { signal: controller.signal });
  controller.abort();
  const abortedResult = await aborted.result;
  assert.ok(abortedResult.kind === "aborted" || abortedResult.kind === "unobserved"); await aborted.closed;
});

test("R37: pre-abort returns without attempting even an unavailable executable", async () => {
  const controller = new AbortController(); controller.abort();
  const task = startProcess(command("", { executable: "/nonexistent/oma-r37-no-executable" }), { signal: controller.signal });
  assert.equal((await task.result).kind, "aborted"); await task.closed;
});

test("R37: native spawn failure and known nonzero exit remain different observations", { timeout: 10000 }, async () => {
  const absent = await runProcess(command("", { executable: "/nonexistent/oma-r37-no-executable" }));
  assert.equal(absent.kind, "spawn-failed");
  const failed = await runProcess(command("process.exit(7)"));
  assert.equal(failed.kind, "exited"); assert.equal(failed.exitCode, 7);
});

test("R37: command validation rejects invalid budgets and NUL arguments before spawn", () => {
  assert.throws(() => startProcess(command("", { timeoutMs: 0 })), RangeError);
  assert.throws(() => startProcess(command("", { stdoutBytes: Number.MAX_SAFE_INTEGER, stderrBytes: 1 })), RangeError);
  assert.throws(() => startProcess(command("", { argv: ["bad\0argument"] })), TypeError);
});

test("R37: one preparation slot rejects concurrent work and releases after known exit", { skip: process.platform !== "linux", timeout: 10000 }, async () => {
  const executor = new PreparationExecutor();
  const first = executor.run(command("setTimeout(()=>process.stdout.write('first'),200)"));
  await assert.rejects(executor.run(command("process.stdout.write('second')")), { code: "REF_STATE_UNKNOWN" });
  assert.equal((await first).kind, "exited"); assert.equal(executor.blocked, false);
  assert.equal((await executor.run(command("process.stdout.write('next')"))).stdout.toString(), "next");
});

test("R37: an uncertain native outcome keeps the preparation owner blocked", { skip: process.platform !== "linux", timeout: 10000 }, async () => {
  const executor = new PreparationExecutor(); const controller = new AbortController();
  const first = executor.run(command("setInterval(()=>{},1000)"), controller.signal);
  controller.abort();
  assert.notEqual((await first).kind, "exited"); assert.equal(executor.blocked, true);
  await assert.rejects(executor.run(command("process.exit(0)")), { code: "REF_STATE_UNKNOWN" });
});


for (const slot of [5, 3]) {
  test(`DR27/P0-4: sandbox descriptor ${slot} setup failure retains its original error and releases the child`, { timeout: 5000 }, async t => {
    // Exercise the actual spawn/transfer owner with local pipes, not bubblewrap
    // or a manager. No deployment rootfs or provider is used here.
    const child = childProcess.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"],
      { stdio: ["pipe", "pipe", "pipe", "pipe", "ignore", "pipe"] });
    const exited = once(child, "close");
    t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); child.kill("SIGKILL"); await exited; });
    const channel = child.stdio[slot] as import("node:stream").Writable;
    const problem = new Error(`injected descriptor ${slot} write failure`);
    t.mock.method(channel, "end", () => { throw problem; });
    t.mock.method(childProcess, "spawn", () => child);
    syncBuiltinESMExports();
    assert.throws(() => spawnSandboxed(["bwrap", "--seccomp", "3", "--", "/bin/true"], {}, new Uint8Array([0])), error => error === problem);
    assert.equal(child.killed, true, "a transfer failure never hands the child to a caller");
    for (const stream of child.stdio) if (stream) assert.equal(stream.destroyed, true);
    await exited;
  });
}

test("DR27/P0-4: failed stream return still attempts every other child resource", { timeout: 5000 }, async t => {
  const child = childProcess.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "close");
  const problem = new Error("injected stream return failure");
  const destroy = child.stdin.destroy;
  const fault = t.mock.method(child.stdin, "destroy", function () { destroy.call(child.stdin); throw problem; });
  t.after(async () => { fault.mock.restore(); child.kill("SIGKILL"); await exited; });
  assert.throws(() => stopOwnedChild(child), error => error instanceof AggregateError && error.errors[0] === problem);
  assert.equal(child.killed, true);
  assert.equal(child.stdout.destroyed, true); assert.equal(child.stderr.destroyed, true);
  fault.mock.restore();
  await exited;
});
