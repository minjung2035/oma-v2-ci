import test from "node:test";
import assert from "node:assert/strict";
import { BrokerLifetime } from "@oma/broker/lifetime";
import { PreparationExecutor } from "@oma/process/preparation";
import type { CommandSpec } from "@oma/process/command";

function command(code: string): CommandSpec {
  return { executable: process.execPath, argv: ["-e", code], env: { PATH: process.env.PATH },
    timeoutMs: 2000, stdoutBytes: 1024, stderrBytes: 1024 };
}

test("R37: failure before configuration acquisition releases only the lock without requesting an unloaded grace policy", async () => {
  let lockCloses = 0;
  const lifetime = new BrokerLifetime({ close() { lockCloses++; } }, () => {
    throw new Error("configuration never supplied a shutdown budget");
  });
  await lifetime.shutdown();
  assert.equal(lockCloses, 1); assert.equal(lifetime.phase, "closed");
  await lifetime.shutdown(); assert.equal(lockCloses, 1);
});

// A single sequential parent keeps the deliberately sticky uncertainty test
// after the successful control. Production exposes no test-only reset/unblock.
test("R37: native preparation owns the shutdown barrier independently of a request Promise", {
  skip: process.platform !== "linux", timeout: 15000,
}, async t => {
  await t.test("known native completion precedes Store and writer-lock release", async () => {
    const executor = new PreparationExecutor();
    let storeCloses = 0; let lockCloses = 0;
    const lifetime = new BrokerLifetime({ close() { lockCloses++; } }, () => 5);
    lifetime.retainStore(() => { storeCloses++; });
    const work = executor.run(command("setTimeout(()=>process.stdout.write('complete'),200)"));
    const closing = lifetime.shutdown();
    assert.equal(storeCloses, 0); assert.equal(lockCloses, 0);
    const observation = await work;
    assert.equal(observation.kind, "exited"); assert.equal(observation.exitCode, 0);
    await closing;
    assert.equal(storeCloses, 1); assert.equal(lockCloses, 1);
    assert.equal(lifetime.phase, "closed");
  });

  await t.test("unknown preparation outcome cannot release Store or lock even after the request settles", async () => {
    const executor = new PreparationExecutor(); const controller = new AbortController();
    const work = executor.run(command("setInterval(()=>{},1000)"), controller.signal);
    controller.abort();
    const observation = await work;
    assert.notEqual(observation.kind, "exited"); assert.equal(executor.blocked, true);
    let storeCloses = 0; let lockCloses = 0;
    const lifetime = new BrokerLifetime({ close() { lockCloses++; } }, () => 5);
    lifetime.retainStore(() => { storeCloses++; });
    await assert.rejects(lifetime.shutdown(), { code: "RUN_TERMINATION_UNKNOWN" });
    assert.equal(storeCloses, 0); assert.equal(lockCloses, 0);
    assert.equal(lifetime.phase, "draining");
  });
});
