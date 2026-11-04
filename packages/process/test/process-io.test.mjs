/** Physical pipe/capture contracts. These sources prove no descendant scope:
 * actual producer terminal and stdio return remain separate observations. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, createReadStream, createWriteStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlPipe } from "@oma/native/control-socket";
import { observeProcessIO } from "../dist/async.js";

function physicalSource(t, code, extra = [], beforeCleanup = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-physical-process-io-")), raw = new Set();
  const pipe = () => { const p = controlPipe(); raw.add(p.read); raw.add(p.write); return p; };
  const close = fd => { if (raw.delete(fd)) closeSync(fd); };
  const input = pipe(), output = pipe(), errors = pipe();
  const child = spawn(process.execPath, ["-e", code], { env: {}, stdio: [input.read, output.write, errors.write, ...extra] });
  close(input.read); close(output.write); close(errors.write);
  const stdin = createWriteStream("", { fd: input.write, autoClose: true }); raw.delete(input.write);
  const stdout = createReadStream("", { fd: output.read, autoClose: true }); raw.delete(output.read);
  const stderr = createReadStream("", { fd: errors.read, autoClose: true }); raw.delete(errors.read);
  const streams = [stdin, stdout, stderr], streamClosures = streams.map(stream => new Promise(resolve => stream.once("close", resolve)));
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const producerClosed = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
  const returned = Promise.all([...streamClosures, producerClosed]);
  let stopCount = 0, reportFailure;
  child.on("error", () => {});
  const io = { stdin, stdout, stderr,
    onError(listener) { reportFailure = listener; child.once("error", error => listener(error, "spawn-failed")); },
    onExit(listener) { child.once("exit", listener); },
    onClose(listener) { void producerClosed.then(({ code, signal }) => listener(code, signal)); },
    terminate() { stopCount++; if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); },
  };
  t.after(async () => {
    beforeCleanup();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of streams) stream.destroy();
    for (const fd of [...raw]) close(fd);
    await returned; rmSync(root, { recursive: true });
  });
  return { io, root, exited, returned, child, streams, stops: () => stopCount,
    fail: error => reportFailure(error),
    command: { executable: process.execPath, argv: ["-e", code], env: {}, timeoutMs: 5000, stdoutBytes: 1024, stderrBytes: 1024 } };
}

test("001. Real pipe sources share snapshotted input, bounded capture, streaming and complete spool bytes", { timeout: 15000 }, async t => {
  const f = physicalSource(t, "const fs=require('node:fs');process.stdout.write(Buffer.concat([Buffer.from('got:'+fs.readFileSync(0)+'|'),Buffer.alloc(100003,97)]));process.stderr.write('err!')");
  const input = Buffer.from("body"), spool = join(f.root, "stdout"), command = { ...f.command, input, stdoutBytes: 8, stdoutSpool: spool };
  let streamed = 0;
  const task = observeProcessIO(command, f.io, { stdoutSink(bytes) { streamed += bytes.length; } });
  input.fill(120); command.stdoutBytes = 1;
  const result = await task.result; await task.closed;
  const expected = Buffer.concat([Buffer.from("got:body|"), Buffer.alloc(100003, 97)]);
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString(), "got:body"); assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stdoutSpooledTo, spool); assert.deepEqual(readFileSync(spool), expected);
  assert.equal(streamed, expected.length); assert.equal(result.stderr.toString(), "err!");
  assert.ok(f.streams.every(stream => stream.closed)); assert.equal(f.stops(), 0);
});

for (const lost of [false, true]) test(lost ?
  "003. A source error stays unobserved despite actual exit zero and subsequent complete FD return" :
  "002. Producer terminal cannot complete capture while a real descendant still owns inherited stdio",
{ timeout: 15000 }, async t => {
  const control = controlPipe(), owned = new Set([control.read, control.write]);
  const close = fd => { if (owned.delete(fd)) closeSync(fd); };
  const grandchild = "require('node:fs').readFileSync(3);process.stdout.write('tail')";
  const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{env:{},stdio:['ignore',1,2,3]});process.stdout.write('head');process.exit(${lost ? 0 : 7})`;
  const f = physicalSource(t, code, [control.read], () => { for (const fd of [...owned]) close(fd); }); close(control.read);
  const task = observeProcessIO(f.command, f.io); let completed = false;
  void task.result.then(() => { completed = true; });
  assert.equal((await f.exited).code, lost ? 0 : 7);
  assert.equal(completed, false); assert.equal(f.io.stdout.closed, false);
  if (lost) f.fail(Object.assign(new Error("supervisor observation lost"), { code: "BROKER_UNAVAILABLE" }));
  close(control.write);
  const result = await task.result; await task.closed;
  assert.equal(result.kind, lost ? "unobserved" : "exited"); assert.equal(result.exitCode, lost ? 0 : 7);
  assert.equal(result.stdout.toString(), "headtail"); assert.ok(f.streams.every(stream => stream.closed));
  if (lost) assert.equal(result.errorCode, "BROKER_UNAVAILABLE");
});

test("004. An already-aborted observer stops and joins its existing physical source", { timeout: 15000 }, async t => {
  const f = physicalSource(t, "setInterval(()=>{},1000)"), controller = new AbortController(); controller.abort();
  const task = observeProcessIO(f.command, f.io, { signal: controller.signal });
  assert.equal((await task.result).kind, "aborted"); await task.closed;
  assert.equal(f.stops(), 1); assert.ok(f.streams.every(stream => stream.closed));
  assert.notEqual(f.child.signalCode, null);
});

test("005. Returned output handles without complete EOF cannot become exit-zero success", { timeout: 15000 }, async t => {
  const f = physicalSource(t, "setTimeout(()=>{},100)");
  const task = observeProcessIO(f.command, f.io);
  f.io.stdout.destroy(); // Simulate a reader ending before its complete stream.
  const result = await task.result; await task.closed;
  assert.equal(f.child.exitCode, 0); assert.equal(f.io.stdout.closed, true);
  assert.equal(f.io.stdout.readableEnded, false); assert.equal(result.kind, "unobserved");
});
