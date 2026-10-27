import test from "node:test";
import assert from "node:assert/strict";
import { runProcessSync } from "@oma/process/run";
const command = input => ({ executable: process.execPath,
  argv: ["-e", "process.stdin.on('data', bytes => process.stdout.write(bytes))"],
  env: { PATH: "/usr/bin:/bin" }, input, timeoutMs: 5000, stdoutBytes: 65536, stderrBytes: 65536 });
test("P0 process: UTF-8 string stdin works with native Buffer output capture", () => {
  const input = "literal bytes 한글\n\u0000tail";
  const result = runProcessSync(command(input));
  assert.equal(result.kind, "exited", JSON.stringify(result));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.from(input, "utf8"));
  assert.equal(result.stderr.length, 0);
});
test("P0 process: binary stdin remains exact and independently copied", () => {
  const input = Uint8Array.from([0, 255, 254, 128, 10, 65]);
  const result = runProcessSync(command(input));
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.from(input));
  let observed;
  const copied = runProcessSync(command(input), (_exe, _argv, options) => {
    observed = options.input;
    if (Buffer.isBuffer(options.input)) options.input[0] = 42;
    return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  assert.equal(copied.kind, "exited"); assert.ok(Buffer.isBuffer(observed)); assert.notEqual(observed, input);
  assert.equal(input[0], 0);
});
test("P0 process: string input is encoded before the native encoding option is interpreted", () => {
  const input = "value\n";
  let observed;
  const result = runProcessSync(command(input), (_exe, _argv, options) => {
    observed = options.input;
    return { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  });
  assert.equal(result.kind, "exited"); assert.ok(Buffer.isBuffer(observed));
  assert.deepEqual(observed, Buffer.from(input));
});
