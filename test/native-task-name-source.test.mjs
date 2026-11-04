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
import { controlPipe } from "@oma/native/control-socket";
import { currentDarwinAuditToken, identifyDarwinCoalition } from "@oma/native/audit-session";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { prepareSeatbelt } from "@oma/platform-mac/seatbelt";
import { launchDarwinJobScope } from "@oma/platform-mac/job-scope";
import { observeDarwinJobScope, acquireDarwinJobScope } from "@oma/platform-mac/job-recovery";

test("001. Actual inherited task-name source survives Seatbelt and Node; user ports and own-task names remain distinct", { timeout: 45000 }, async t => {
  if (process.platform !== "darwin") return assert.throws(currentDarwinAuditToken, { code: "UNSUPPORTED_PROFILE" });
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
  const node = realpathSync(process.execPath), nodeScript = `const {spawnSync}=require('node:child_process');
    for(const mode of ['--query','--self','--forged']){const r=spawnSync(process.argv[1],[mode,process.argv[2]],{encoding:'utf8'});
      if(r.status!==0)throw new Error(JSON.stringify(r));process.stdout.write(r.stdout);}`;
  const target = { executable, argv: ["--after-sandbox", String(unrelated.pid), node, executable, nodeScript],
    env: { HOME: root, TMPDIR: root }, cwd: root, timeoutMs: 15000, stdoutBytes: 16384, stderrBytes: 8192 };
  const recipe = prepareSeatbelt(target, { readable: [], writable: [{ path: root, kind: "directory" }], denied: [],
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
  const rows = result.stdout.toString().trim().split("\n").map(JSON.parse); t.diagnostic(JSON.stringify(rows));
  assert.equal(rows.length, 4);
  for (const row of rows.slice(0, 2)) {
    assert.equal(row.kind, "name"); assert.equal(row.kobjectType, 20); assert.equal(row.auditStatus, 0); assert.equal(row.auditWords, 8);
    assert.deepEqual(row.token, token); assert.notEqual(row.bootstrapStatus, 0); assert.notEqual(row.registeredPortsStatus, 0);
    assert.notEqual(row.dyldInfoStatus, 0); assert.notEqual(row.unrelatedNameStatus, 0);
    assert.equal(row.ownCoalitionBytes, 40);
    if (row.hostCoalitionBytes === 40) { assert.equal(row.hostCoalition, host.coalitionId); assert.notEqual(row.hostCoalition, row.ownCoalition); }
  }
  assert.equal(rows[2].kind, "name"); assert.equal(rows[2].kobjectType, 20); assert.equal(rows[2].token[5], rows[2].pid);
  assert.equal(rows[2].hostCoalition, rows[2].ownCoalition, "a genuine own-task name cannot establish expected Broker identity");
  assert.deepEqual(rows[3], { kind: "rejected", kobjectStatus: 0, kobjectType: 0, queryAttempted: false });
  assert.deepEqual(journal.entries(), []);
});
