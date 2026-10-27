import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlReader, type PiEvent } from "@oma/protocol/jsonl";
import { PiRpcClient } from "@oma/engine/pi-rpc";
import { readBatchView } from "@oma/tool-runtime/batch-view";
import { decodeRunLease, assertValidatedRunLease } from "@oma/protocol/run-lease";
import { actorSocketPathAt, agentRootPathAt, workspacePathAt, runnerViewPathAt, runnerSessionDirPathAt } from "@oma/domain/paths";
import { SandboxModule } from "@oma/platform-linux/sandbox";
import { type SandboxHost } from "@oma/contracts/runtime";
import { StoreError } from "@oma/domain/errors";

import { PiAdapter } from "@oma/engine/pi-adapter";
import { residentOptions, prepareResident, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "@oma/protocol/delivery-boundary";
const limits = { frameBytes: 4096, idleStreamSeconds: 1, receiptWaitSeconds: 1 };
const errorCode = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test("R28: JSONL split/merge preserves LF-only boundaries and UTF-8", () => {
  const events = [{ type: "one", text: "새 메일 🙂\n" }, { type: "two", id: "2" }];
  const source = Buffer.from(events.map(event => JSON.stringify(event)).join("\n") + "\n");
  for (let split = 0; split <= source.length; split++) {
    const reader = new JsonlReader(4096); const found: PiEvent[] = [];
    reader.feed(source.subarray(0, split), event => found.push(event));
    reader.feed(source.subarray(split), event => found.push(event)); reader.finish();
    assert.deepEqual(found, events);
  }
  const reader = new JsonlReader(4096); const found: PiEvent[] = [];
  for (const byte of source) reader.feed(Buffer.from([byte]), event => found.push(event));
  reader.finish(); assert.deepEqual(found, events);
});

test("R28: oversized, malformed and partial-final JSONL poison rather than resynchronize", () => {
  for (const bytes of [Buffer.from("x".repeat(33)), Buffer.from("{bad}\n"), Buffer.from([0xff, 0x0a]),
    Buffer.from('{"type":"one"}\r{"type":"two"}\n'), Buffer.from("[]\n")]) {
    const reader = new JsonlReader(32); let dispatched = 0;
    assert.throws(() => reader.feed(bytes, () => dispatched++));
    assert.throws(() => reader.feed(Buffer.from('{"type":"later"}\n'), () => dispatched++));
    assert.equal(dispatched, 0); assert.equal(reader.pendingBytes, 0);
  }
  const partial = new JsonlReader(32);
  partial.feed(Buffer.from('{"type":"one"}'), () => assert.fail("unterminated line dispatched"));
  assert.throws(() => partial.finish());
  assert.throws(() => partial.feed(Buffer.from("\n"), () => assert.fail("poisoned reader dispatched")));
});

test("DR15 / P0-5: a well-formed line longer than the bound is skipped whole and reported; the lines around it are read", () => {
  const big = JSON.stringify({ type: "message_end", message: { role: "assistant", content: "x".repeat(200) } });
  const source = Buffer.from(`{"type":"one"}\n${big}\n{"type":"two"}\n`);
  // Every split, including ones inside the oversized line and at its LF.
  for (let split = 0; split <= source.length; split += 1) {
    const skipped: number[] = []; const found: string[] = [];
    const reader = new JsonlReader(64, bytes => { skipped.push(bytes); });
    reader.feed(source.subarray(0, split), event => found.push(event.type));
    assert.ok(reader.pendingBytes <= 64, "the reader held more than its bound");
    reader.feed(source.subarray(split), event => found.push(event.type));
    reader.finish();
    assert.deepEqual(found, ["one", "two"], `split at ${split}`);
    assert.deepEqual(skipped, [Buffer.byteLength(big)], `split at ${split}`);
  }
  // A line that is not the protocol still poisons, skipped neighbour or not.
  const reader = new JsonlReader(64, () => {});
  assert.throws(() => reader.feed(Buffer.from(`${big}\n{bad}\n`), () => {}));
  assert.throws(() => reader.feed(Buffer.from('{"type":"later"}\n'), () => {}));
  // An oversized line the stream never ends is an unterminated line at EOF.
  const open = new JsonlReader(64, () => {});
  open.feed(Buffer.from(big), () => assert.fail("a partial line dispatched"));
  assert.equal(open.midLine, true);
  assert.throws(() => open.finish());
});

test("R28: observer exceptions preserve their identity and stop later events", () => {
  const reader = new JsonlReader(128); const failure = new Error("observer failed"); let calls = 0;
  assert.throws(() => reader.feed(Buffer.from('{"type":"one"}\n{"type":"two"}\n'), () => { calls++; throw failure; }),
    error => error === failure);
  assert.equal(calls, 1);
  assert.throws(() => reader.feed(Buffer.from('{"type":"three"}\n'), () => calls++));
  assert.equal(calls, 1);
});

// Explicit I/O-fault injection only, not a fake authorization or provider fixture.
function blockStdinForTest(child: ChildProcessWithoutNullStreams): void {
  child.stdin.write = (() => false) as typeof child.stdin.write;
}

test("R28: pending stdin writes time out, reject overlap and settle on owned close", { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "close");
  const client = new PiRpcClient(child, limits); t.after(() => client.close());
  await client.send({ type: "get_state" }); // a normal command reaches the stream first
  blockStdinForTest(child);
  const pending = client.send({ type: "abort" });
  const pendingCheck = assert.rejects(pending, errorCode("DEADLINE_EXCEEDED"));
  await assert.rejects(client.send({ type: "cycle_model" }), errorCode("LIMIT_EXCEEDED"));
  await pendingCheck;
  const ended = await client.completion;
  assert.equal(ended.state, "failed");
  client.close(); client.close(); await exited;
  assert.equal(child.stdin.listenerCount("drain"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
});

test("R28: stderr is drained as counts, never retained as diagnostic body", { timeout: 5000 }, async t => {
  const secret = "PRIVATE_PROVIDER_PROMPT";
  const count = 1024;
  const child = spawn(process.execPath, ["-e", `process.stderr.write(${JSON.stringify(secret)}.repeat(${count})); setInterval(() => {}, 1000)`], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "close"); const client = new PiRpcClient(child, limits); t.after(() => client.close());
  const deadline = Date.now() + 2000;
  while (client.diagnosticMetadata.stderrBytes < Buffer.byteLength(secret) * count && Date.now() < deadline)
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  assert.equal(client.diagnosticMetadata.stderrBytes, Buffer.byteLength(secret) * count);
  assert.equal(JSON.stringify(client.diagnosticMetadata).includes(secret), false);
  client.close(); await exited;
});

test("R28: incomplete stdout line and late observer close release owned child resources", { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ["-e", "process.stdout.write('{'); setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "close"); const client = new PiRpcClient(child, limits); t.after(() => client.close());
  const unsubscribe = client.onEvent(() => assert.fail("partial JSON was dispatched"));
  const ended = await client.completion;
  assert.equal(ended.state, "failed");
  if (ended.state === "failed") assert.ok(errorCode("DEADLINE_EXCEEDED")(ended.error));
  unsubscribe(); unsubscribe(); client.close(); await exited;
});

test("R28: batch FD read rejects source overflow, invalid UTF-8 and symlink leaves", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r28-view-"));
  const id = "b-00000000-0000-4000-8000-000000000001";
  const path = join(root, `batch-${id}.json`);
  const view = { id, agent: "alice", incarnation: 1, deliveryMode: "followUp", notice: "mail", messageIds: [] };
  const bounds = { frameBytes: 4096, batchMaxMessages: 24 };
  try {
    writeFileSync(path, JSON.stringify(view)); assert.deepEqual(readBatchView(id, root, bounds), view);
    assert.equal(readBatchView(id, root, { ...bounds, frameBytes: 1 }), null);
    writeFileSync(path, Buffer.from([0xff])); assert.equal(readBatchView(id, root, bounds), null);
    rmSync(path); writeFileSync(join(root, "other.json"), JSON.stringify(view)); symlinkSync("other.json", path);
    assert.equal(readBatchView(id, root, bounds), null);
    assert.equal(readBatchView("../../outside", root, bounds), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R28: sandbox recipes bind decoded lease and private actor paths but never attest candidate execution", () => {
  const stateRoot = "/tmp/oma-r28-state"; const runRoot = "/tmp/oma-r28-run";
  const value = { actor: "alice", incarnation: 2, socketHostPath: actorSocketPathAt(runRoot, "alice", 2) };
  const lease = decodeRunLease(value, { actor: "alice", runRoot });
  assert.equal(Object.isFrozen(lease), true);
  assert.throws(() => assertValidatedRunLease({ ...lease }), errorCode("AUTH_FAILED"));
  assert.throws(() => decodeRunLease({ ...value, incarnation: 1 }, { actor: "alice", runRoot }), errorCode("AUTH_FAILED"));
  assert.throws(() => decodeRunLease(value, { actor: "bob", runRoot }), errorCode("AUTH_FAILED"));
  const host: SandboxHost = {  libdir: "/opt/oma/lib", node: "/usr/bin/node", pi: "/opt/oma/lib/pi/cli.js",
    piModeArgs: ["--mode", "rpc"], stateRoot, runRoot, limits: { frameBytes: 4096, batchMaxMessages: 24 } };
  const sandbox = new SandboxModule(host, []);
  const dirs = { workspace: workspacePathAt(stateRoot, "alice"), home: join(agentRootPathAt(stateRoot, "alice"), "home"),
    archive: join(stateRoot, "mail/archive"), workerArchive: join(stateRoot, "mail/workers"), selfMail: join(stateRoot, "mail/inboxes/alice"),
    view: runnerViewPathAt(stateRoot, "alice"), world: join(stateRoot, "world"), projectGit: join(stateRoot, "repos/project.git"), projectMirror: join(stateRoot, "repos/project-mirror.git"),
    sessions: runnerSessionDirPathAt(stateRoot, "alice") };
  const plan = sandbox.resident(lease, dirs);
  // DR18 (D-5): descriptor 3 carries the sandbox filter bubblewrap loads.
  assert.deepEqual(plan.inheritedFds, [0, 1, 2, 3]); assert.deepEqual(plan.env, {});
  assert.deepEqual(plan.argv.slice(plan.argv.indexOf("--seccomp"), plan.argv.indexOf("--seccomp") + 2), ["--seccomp", "3"]);
  // DR18 (D-8): the project's committed history, read-only, where a start made it.
  // FI-2 toolchain mounts also use --ro-bind-try; the mirror is the last one.
  const mirror = plan.argv.lastIndexOf("--ro-bind-try");
  assert.deepEqual(plan.argv.slice(mirror, mirror + 3), ["--ro-bind-try", join(stateRoot, "repos/project-mirror.git"), "/git/project-mirror.git"]);
  assert.ok(plan.argv.includes("--unshare-all")); assert.ok(plan.argv.includes("--clearenv"));
  assert.ok(plan.argv.includes(lease.socketHostPath)); assert.equal(plan.argv.includes(runRoot), false);
  assert.throws(() => sandbox.resident(lease, { ...dirs, workspace: workspacePathAt(stateRoot, "bob") }), errorCode("AUTH_FAILED"));
  assert.throws(() => sandbox.resident(value, dirs), errorCode("AUTH_FAILED"));
});

// The run is the unit, not the message. Pi retries a retryable assistant
// failure and compacts before continuing the same run, so a delivery that gave
// up at the first failed message would report a provider failure for a batch
// the engine went on to deliver. Both shapes must end at the same boundary.
for (const retried of [false, true]) {
test(`R28: Pi adapter accepts only a settled pinned boundary from its owned RPC child${retried ? ", including one the run reached after a failed message" : ""}`, { ...RESIDENT_TEST_OPTIONS, timeout: 10000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-r28-pi-"));
  try {
    const dirs = Object.fromEntries(["workspace", "sessions", "home", "archive", "workerArchive", "projectGit", "view"].map(name => {
      const path = join(root, name); mkdirSync(path, { recursive: true }); return [name, path];
    })) as Record<string, string>;
    const core = join(root, "extension.js"); const cli = join(root, "cli.js");
    writeFileSync(core, "export default function() {}\n"); writeFileSync(cli, "\n");
    const command = join(root, "fake-pi");
    writeFileSync(command, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const sessionDir = args[args.indexOf("--session-dir") + 1]; mkdirSync(sessionDir, { recursive: true });
const sessionPath = join(sessionDir, "owned.jsonl"); writeFileSync(sessionPath, '{"type":"session","version":3}\\n');
process.stdin.setEncoding("utf8"); let pending = "";
process.stdin.on("data", chunk => { pending += chunk; const lines = pending.split("\\n"); pending = lines.pop();
  for (const line of lines) { if (!line) continue; const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ type: "response", id: request.id, command: "prompt", success: true }) + "\\n");
    ${retried ? 'process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error" } }) + "\\n");' : ""}
    process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "stop" } }) + "\\n");
    const batchId = request.message.split(" ").at(-1);
    const evidence = { adapterRevision: ${JSON.stringify(PI_ADAPTER_REVISION)}, batchId, incarnation: 1, sessionPath, entryId: "0123abcd" };
    process.stdout.write(JSON.stringify({ type: "extension_ui_request", id: "notice", method: "notify", message: ${JSON.stringify(PI_BOUNDARY_PREFIX)} + JSON.stringify(evidence) }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
  }
});
process.on("SIGTERM", () => process.exit(0));
`);
    chmodSync(command, 0o700);
    const batch = { id: "b-00000000-0000-4000-8000-000000000001", agent: "alice", incarnation: 1,
      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"], sessionPath: null, deliveryMode: "followUp" as const,
      notice: "mail", indexPath: "/inbox.md" as const };
    const options = residentOptions(root, root, command);
    // The override moves coreExtension, so the preload asset the w10 spawn
    // plan names beside it must be prepared against the effective paths.
    const effective = { ...options, paths: { ...options.paths, coreExtension: core, cli } };
    prepareResident(effective);
    const adapter = new PiAdapter(residentEngineEffects, effective);
    const boundary = await adapter.deliver(batch);
    assert.deepEqual(boundary, { adapterRevision: PI_ADAPTER_REVISION, batchId: batch.id, incarnation: 1,
      sessionPath: join(options.paths.sessionDir, "owned.jsonl"), entryId: "0123abcd" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
}

for (const stage of ["stdout", "stderr", "stdin"] as const) {
  test(`DR27/P0-4: partial RPC ${stage} registration failure returns its streams and child`, { timeout: 5000 }, async t => {
    const child = spawn(process.execPath, ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = once(child, "close");
    t.after(async () => { child.kill("SIGKILL"); await exited; });
    const problem = new Error(`injected ${stage} setup failure`);
    const stream = child[stage];
    const original = stream.on;
    let injected = false;
    t.mock.method(stream, "on", function (event: string, listener: (...args: unknown[]) => void) {
      if (!injected && event === (stage === "stdin" ? "drain" : "data")) { injected = true; throw problem; }
      return Reflect.apply(original, stream, [event, listener]);
    });
    assert.throws(() => new PiRpcClient(child, limits), error => error === problem);
    assert.equal(child.killed, true, "construction never handed off the child");
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      assert.equal(stream.destroyed, true);
      assert.equal(stream.listenerCount("data"), 0);
      assert.equal(stream.listenerCount("drain"), 0);
    }
    await exited;
  });
}
