/** Physical expected-peer source candidate; no product authority is granted. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { Socket } from "node:net";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { controlPipe } from "@oma/native/control-socket";
import { currentDarwinAuditToken, identifyDarwinCoalition, pinInheritedDarwinPeer } from "@oma/native/audit-session";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { prepareSeatbelt } from "@oma/platform-mac/seatbelt";
import { launchDarwinJobScope } from "@oma/platform-mac/job-scope";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";
import { watchDarwinProcess } from "@oma/native/process-event";

test("001. Actual inherited task-name source survives Seatbelt and Node; user ports and own-task names remain distinct", { timeout: 45000 }, async t => {
  if (process.platform !== "darwin") return assert.throws(pinInheritedDarwinPeer, { code: "UNSUPPORTED_PROFILE" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-task-name-source-"))), executable = join(root, "source");
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const unrelatedClosed = once(unrelated, "close"); void unrelatedClosed.catch(() => {});
  let journal, owner, writer, read;
  t.after(async () => {
    let safe = false;
    try { await owner?.drain(); safe = true; }
    finally {
      journal?.close(); writer?.destroy(); if (read !== undefined) closeSync(read);
      unrelated.kill("SIGKILL"); await unrelatedClosed;
      if (safe) rmSync(root, { recursive: true }); else t.diagnostic(`Retained unconfirmed source probe evidence ${root}`);
    }
  });
  await once(unrelated, "spawn"); assert.ok(unrelated.pid > 1); assert.equal(unrelated.exitCode, null);
  const compile = spawnSync("/usr/bin/clang", ["-Wall", "-Wextra", "-Werror", fileURLToPath(new URL("./fixtures/darwin-task-name-source.c", import.meta.url)), "-lproc", "-o", executable], { encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr);
  const token = currentDarwinAuditToken(), host = identifyDarwinCoalition(process.pid);
  const node = realpathSync(process.execPath), libdir = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const fixture = new URL("./fixtures/darwin-task-name-node.mjs", import.meta.url).href;
  const nodeScript = `import(${JSON.stringify(fixture)}).catch(e=>{console.error(e);process.exitCode=1;});`;
  const target = { executable, argv: ["--after-sandbox", String(unrelated.pid), node, executable, nodeScript],
    env: { HOME: root, TMPDIR: root }, cwd: root, timeoutMs: 15000, stdoutBytes: 16384, stderrBytes: 8192 };
  const recipe = prepareSeatbelt(target, { readable: [{ path: libdir, kind: "directory" }], mapped: [{ path: libdir, kind: "directory" }],
    writable: [{ path: root, kind: "directory" }], denied: [],
    executable: [executable, node].map(path => ({ path, kind: "file" })), unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"] });
  const pipe = controlPipe(); read = pipe.read; writer = new Socket({ fd: pipe.write, readable: false, writable: true });
  const returned = once(writer, "close"), drained = new Promise((yes, no) => { writer.once("error", no); writer.once("close", yes); });
  void drained.catch(() => {}); void returned.catch(() => {});
  writer.end(recipe.privateInputs[0].bytes);
  ExecutionJournal.initialize(root); journal = ExecutionJournal.open(root, DARWIN_EXECUTION_JOURNAL_VERSION);
  owner = new ExecutionCoordinator(journal, observeDarwinJobScope, acquireDarwinJobScope);
  const result = await owner.run({ slot: "candidate", launch: async () => {
    try { return await launchDarwinJobScope({ ...recipe.command, executable, argv: [...token.map(String), ...recipe.command.argv] }, { files: [{ target: 3, fd: read }] }); }
    finally { closeSync(read); read = undefined; }
  }, authorize() {} });
  await drained; await returned;
  assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0, result.stderr.toString());
  const allRows = result.stdout.toString().trim().split("\n").map(JSON.parse); t.diagnostic(JSON.stringify(allRows));
  assert.equal(allRows.length, 7);
  const rows = allRows.filter(row => row.kind !== undefined); assert.equal(rows.length, 4);
  assert.deepEqual(allRows.find(row => row.nativeSource)?.nativeSource,
    { token, coalitionId: host.coalitionId, alive: true, frozen: true, afterClose: false });
  assert.deepEqual(allRows.filter(row => row.nativeRefusal).map(row => row.nativeRefusal), ["self", "fake"]);
  for (const row of rows.slice(0, 2)) {
    assert.equal(row.kind, "name"); assert.equal(row.kobjectType, 20); assert.equal(row.auditStatus, 0); assert.equal(row.auditWords, 8);
    assert.deepEqual(row.token, token); assert.notEqual(row.bootstrapStatus, 0); assert.notEqual(row.registeredPortsStatus, 0);
    assert.notEqual(row.dyldInfoStatus, 0); assert.notEqual(row.unrelatedNameStatus, 0);
    assert.equal(row.ownCoalitionBytes, 40);
    assert.equal(row.hostCoalitionBytes, 40, "expected-peer admission needs a positively observed source coalition");
    assert.equal(row.hostCoalition, host.coalitionId); assert.notEqual(row.hostCoalition, row.ownCoalition);
  }
  assert.equal(rows[2].kind, "name"); assert.equal(rows[2].kobjectType, 20); assert.equal(rows[2].token[5], rows[2].pid);
  assert.equal(rows[2].hostCoalition, rows[2].ownCoalition, "a genuine own-task name cannot establish expected Broker identity");
  // Public SDK IPC_OTYPE_UNKNOWN is ~0u; IPC_OTYPE_NONE (0) is distinct.
  assert.deepEqual(rows[3], { kind: "rejected", kobjectStatus: 0, kobjectType: 0xffffffff, queryAttempted: false });
  assert.deepEqual(journal.entries(), []);
});

for (const change of ["exec", "death"]) test(`002. Actual held source capability cannot hide Host ${change} from fresh generation and the original watch`, { timeout: 30000 }, async t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-source-revoke-"))), executable = join(root, "source");
  const children = [], readers = []; let watch;
  t.after(async () => {
    try {
      for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await Promise.all(children.map(({ closed }) => closed));
    } finally { try { watch?.close(); } finally { for (const reader of readers) reader.close(); rmSync(root, { recursive: true }); } }
  });
  const owned = (file, argv, stdio) => {
    const child = spawn(file, argv, { stdio }); let stderr = "";
    child.stderr.on("data", bytes => { stderr += bytes; });
    const closed = new Promise((yes, no) => { child.once("error", no); child.once("close", (code, signal) => yes({ code, signal, stderr })); });
    void closed.catch(() => {}); children.push({ child, closed }); return { child, closed };
  };
  const lines = stream => { const reader = createInterface({ input: stream }); readers.push(reader); return reader; };
  const compile = spawnSync("/usr/bin/clang", ["-Wall", "-Wextra", "-Werror",
    fileURLToPath(new URL("./fixtures/darwin-task-name-source.c", import.meta.url)), "-lproc", "-o", executable], { encoding: "utf8", timeout: 30000 });
  assert.equal(compile.status, 0, compile.stderr);
  const replacement = `const {currentDarwinAuditToken}=await import('@oma/native/audit-session');
    process.stdout.write(JSON.stringify(currentDarwinAuditToken())+'\\n');setInterval(()=>{},1000);`;
  const script = `const {currentDarwinAuditToken}=await import('@oma/native/audit-session');
    process.send(currentDarwinAuditToken());process.once('message',()=>process.execve(process.execPath,
      [process.execPath,'--input-type=module','-e',${JSON.stringify(replacement)}],{}));`;
  const source = owned(process.execPath, ["--input-type=module", "-e", script], ["ignore", "pipe", "pipe", "ipc"]);
  const sourceLines = lines(source.child.stdout), [original] = await once(source.child, "message");
  assert.equal(original[5], source.child.pid); watch = watchDarwinProcess(source.child.pid);
  const held = owned(executable, ["--hold", String(source.child.pid)], ["pipe", "pipe", "pipe"]);
  const observations = lines(held.child.stdout), [beforeLine] = await once(observations, "line"), before = JSON.parse(beforeLine);
  assert.equal(before.kobjectStatus, 0); assert.equal(before.kobjectType, 20); assert.equal(before.auditStatus, 0);
  assert.deepEqual(before.token, original); assert.equal(before.generationBytes, 56); assert.equal(before.pidVersion, original[7]);
  let replacementToken;
  if (change === "exec") {
    const changed = once(sourceLines, "line"); source.child.send("exec"); replacementToken = JSON.parse((await changed)[0]);
    assert.equal(replacementToken[5], original[5]); assert.notEqual(replacementToken[7], original[7]);
  } else { source.child.kill("SIGKILL"); const closed = await source.closed; assert.equal(closed.signal, "SIGKILL"); }
  const deadline = performance.now() + 5000;
  while (watch.state() === "live" && performance.now() < deadline) await delay(5);
  assert.equal(watch.state(), change === "exec" ? "changed" : "exited");
  const afterLine = once(observations, "line"); held.child.stdin.end(Buffer.from([1]));
  const after = JSON.parse((await afterLine)[0]), returned = await held.closed;
  assert.equal(returned.code, 0, returned.stderr); assert.equal(returned.signal, null);
  if (change === "exec") { assert.equal(after.generationBytes, 56); assert.equal(after.pidVersion, replacementToken[7]); }
  assert.equal(after.generationBytes === 56 && after.pidVersion === original[7], false,
    "the old capability must never substitute for a fresh matching kernel generation");
  t.diagnostic(JSON.stringify({ change, before, after }));
});
