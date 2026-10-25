import test from "node:test";
import assert from "node:assert/strict";
import { startProcess } from "@oma/process/async";

const command = argv => ({ executable: process.execPath, argv, env: {}, timeoutMs: null,
  stdoutBytes: 4096, stderrBytes: 4096 });

test("a child executes the frozen command rather than later caller mutations", async () => {
  const source = command(["-e", "process.stdout.write(process.argv[1])", "accepted bytes"]);
  const task = startProcess(source);
  source.argv[2] = "changed bytes";
  const result = await task.result;
  await task.closed;
  assert.equal(result.kind, "exited");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString(), "accepted bytes");
});

test("cancellation is idempotent and the owner observes the actual child close", async () => {
  const task = startProcess(command(["-e", "setInterval(() => {}, 1000)"]));
  task.cancel();
  task.cancel();
  const result = await task.result;
  await task.closed;
  assert.equal(result.kind, "aborted");
  assert.notEqual(result.exitCode, 0);
});
