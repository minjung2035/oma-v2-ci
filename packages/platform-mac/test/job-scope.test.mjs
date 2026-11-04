/** Physical Mac producer + shared coordinator. The journal is in memory:
 * this does not qualify durable recovery, expected Broker or installed JS. */
import test from "node:test";
import { inspect } from "node:util";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionCoordinator, ExecutionNotStarted } from "@oma/process/owned-execution";
import { launchDarwinJobScope, launchSeatbeltJobScope } from "../dist/job-scope.js";

function owner(t, published = () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-real-mac-job-"))), rows = [], trace = [];
  const journal = { entries: () => rows.map(row => ({ ...row })), reserve(slot) {
    const row = { slot, execution: "one", witness: null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; trace.push("publish"); published(); },
      retire() { trace.push("retire"); rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("unexpected startup recovery"); } };
  const runtime = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  t.after(async () => { await runtime.drain(); rmSync(root, { recursive: true }); });
  const command = argv => ({ executable: realpathSync(process.execPath), argv, env: {}, cwd: root,
    timeoutMs: 10000, stdoutBytes: 16, stderrBytes: 128 });
  return { root, rows, trace, runtime, command };
}
async function linuxRefusal() {
  const command = { executable: process.execPath, argv: [], env: {}, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 };
  await assert.rejects(launchDarwinJobScope(command), error =>
    error instanceof ExecutionNotStarted && error.cause?.code === "UNSUPPORTED_PROFILE");
}

test("004. Trusted Seatbelt preparation refuses loader overrides before any job can be created", async () => {
  for (const key of ["DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "LD_LIBRARY_PATH", "LD_PRELOAD"]) {
    const command = { executable: "/trusted/node", argv: [], env: { [key]: "/untrusted/library" }, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 };
    await assert.rejects(launchSeatbeltJobScope(command, { readable: [], writable: [], denied: [],
      executable: [{ path: command.executable, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: [key] }),
    error => error instanceof ExecutionNotStarted && error.cause?.code === "UNSUPPORTED_PROFILE");
  }
});

test("001. Actual Darwin producer joins shared capture, complete spooling and independent CID death", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return linuxRefusal();
  const f = owner(t), bytes = 1048593, spool = join(f.root, "stdout");
  const command = { ...f.command(["-e", `const fs=require('node:fs');const input=fs.readFileSync(0);fs.writeFileSync('entered',String(input.length));fs.writeFileSync(1,Buffer.alloc(${bytes},97));fs.writeFileSync(2,'done')`]),
    input: Buffer.alloc(1048601, 98), stdoutSpool: spool };
  let identity;
  const result = await f.runtime.run({ slot: "capture", launch: () => launchDarwinJobScope(command),
    prepared(_execution, witness) { identity = witness; assert.equal(existsSync(join(f.root, "entered")), false); },
    authorize() { f.trace.push("authorize"); } });
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0); assert.equal(result.stderr.toString(), "done");
  assert.equal(result.stdout.toString(), "a".repeat(16)); assert.equal(result.stdoutTruncated, true);
  assert.deepEqual(readFileSync(spool), Buffer.alloc(bytes, 97)); assert.equal(readFileSync(join(f.root, "entered"), "utf8"), "1048601");
  assert.equal(identity.kind, "darwin-resource-coalition"); assert.deepEqual(f.trace, ["publish", "authorize", "retire"]); assert.equal(f.rows.length, 0);
});

test("002. Actual Darwin blocked workload refuses fresh authority before its first user instruction", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return linuxRefusal();
  const f = owner(t), command = f.command(["-e", "require('node:fs').writeFileSync('entered','forbidden')"]);
  const revoked = new Error("fixture authority revoked");
  await assert.rejects(f.runtime.run({ slot: "refused", launch: () => launchDarwinJobScope(command),
    authorize() { f.trace.push("authorize"); throw revoked; } }), error => {
    assert.equal(error, revoked, "refusal must reach the final authority observation"); return true;
  });
  assert.equal(existsSync(join(f.root, "entered")), false); assert.deepEqual(f.trace, ["publish", "authorize", "retire"]); assert.equal(f.rows.length, 0);
});

test("003. Actual Darwin scope joins private Seatbelt setup EOF, final Node gate and common I/O", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return linuxRefusal();
  const f = owner(t), forbidden = join(f.root, "forbidden"); writeFileSync(forbidden, "HOST_CANARY");
  const target = { ...f.command(["-e", `const fs=require('node:fs');let code='unexpected';try{fs.writeFileSync('forbidden','bad')}catch(e){code=e.code}fs.writeFileSync('entered',String(fs.readFileSync(0).length));fs.writeFileSync(1,'ready');fs.writeFileSync(2,code)`]),
    env: { HOME: f.root, TMPDIR: f.root }, input: Buffer.alloc(1048601, 98) };
  const policy = { readable: [], writable: [{ path: f.root, kind: "directory" }],
    denied: [{ path: forbidden, kind: "file" }], executable: [{ path: target.executable, kind: "file" }],
    unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"], suspendExec: false };
  const result = await f.runtime.run({ slot: "sandbox", launch: () => launchSeatbeltJobScope(target, policy),
    prepared() { assert.equal(existsSync(join(f.root, "entered")), false); }, authorize() { f.trace.push("authorize"); } });
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0); assert.equal(result.stdout.toString(), "ready");
  assert.equal(result.stderr.toString(), "EPERM"); assert.equal(readFileSync(forbidden, "utf8"), "HOST_CANARY");
  assert.equal(readFileSync(join(f.root, "entered"), "utf8"), "1048601"); assert.equal(f.rows.length, 0);
});

test("005. Actual released Darwin workload abort retains its reason through complete scope and I/O return", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return linuxRefusal();
  const f = owner(t), controller = new AbortController(); let output = "";
  const command = f.command(["-e", "process.stdout.write('ready');setInterval(()=>{},1000)"]);
  const result = await f.runtime.run({ slot: "abort", signal: controller.signal,
    launch: () => launchDarwinJobScope(command, { signal: controller.signal, stdoutSink(bytes) {
      output += Buffer.from(bytes).toString(); if (output === "ready") controller.abort();
    } }), authorize() { f.trace.push("authorize"); } });
  assert.equal(output, "ready"); assert.equal(result.kind, "aborted");
  assert.deepEqual(f.trace, ["publish", "authorize", "retire"]); assert.equal(f.rows.length, 0);
});

test("006. Actual Darwin cancellation after witness publication joins unopened setup and all pipe returns", { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return linuxRefusal();
  const controller = new AbortController(), f = owner(t, () => controller.abort());
  const command = { ...f.command(["-e", "require('node:fs').writeFileSync('entered','forbidden')"]), input: Buffer.alloc(1048601, 98) };
  await assert.rejects(f.runtime.run({ slot: "cancel-setup", signal: controller.signal,
    launch: () => launchDarwinJobScope(command, { signal: controller.signal }),
    authorize() { throw new Error("cancelled setup reached authority"); } }), error => {
      if (error.code !== "CANCELLED_BEFORE_COMMIT") t.diagnostic(inspect(error, { depth: 12, maxArrayLength: 24 }));
      return error.code === "CANCELLED_BEFORE_COMMIT";
    });
  assert.equal(existsSync(join(f.root, "entered")), false);
  assert.deepEqual(f.trace, ["publish", "retire"]); assert.equal(f.rows.length, 0);
});
