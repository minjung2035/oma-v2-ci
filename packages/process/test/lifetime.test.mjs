import test from "node:test";
import assert from "node:assert/strict";
import { startProcess, cleanupAll, withAsyncCleanup } from "@oma/process/async";

const command = argv => ({ executable: process.execPath, argv, env: {}, timeoutMs: null,
  stdoutBytes: 4096, stderrBytes: 4096 });

test("001. A child executes the frozen command rather than later caller mutations", async () => {
  const source = command(["-e", "process.stdout.write(process.argv[1])", "accepted bytes"]);
  const task = startProcess(source);
  source.argv[2] = "changed bytes";
  const result = await task.result;
  await task.closed;
  assert.equal(result.kind, "exited");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString(), "accepted bytes");
});

test("002. Cancellation is idempotent and the owner observes the actual child close", async () => {
  const task = startProcess(command(["-e", "setInterval(() => {}, 1000)"]));
  task.cancel();
  task.cancel();
  const result = await task.result;
  await task.closed;
  assert.equal(result.kind, "aborted");
  assert.notEqual(result.exitCode, 0);
});

test("003. Owned-child cleanup waits for the effect and retains every cleanup failure beside the primary", async () => {
  const events = [], primary = new Error("original effect"), first = new Error("first cleanup"), last = new Error("last cleanup");
  let reject;
  const work = withAsyncCleanup(() => {
    events.push("effect"); return new Promise((_resolve, fail) => { reject = fail; });
  }, () => cleanupAll([
    () => { events.push("first"); throw first; },
    () => { events.push("independent"); },
    () => { events.push("last"); throw last; },
  ]));
  assert.deepEqual(events, ["effect"], "cleanup cannot precede the original effect settlement");
  reject(primary);
  await assert.rejects(work, error => {
    assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], primary);
    assert.ok(error.errors[1] instanceof AggregateError); assert.deepEqual(error.errors[1].errors, [first, last]); return true;
  });
  assert.deepEqual(events, ["effect", "first", "independent", "last"]);
});

test("004. Owned-child cleanup preserves a successful value and returns its owners once", async () => {
  const value = {}, events = [];
  assert.equal(await withAsyncCleanup(async () => value, () => cleanupAll([
    () => { events.push("one"); }, () => { events.push("two"); },
  ])), value);
  assert.deepEqual(events, ["one", "two"]);
});
