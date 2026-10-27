import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { runBoundedScript } from "../scripts/bounded-script.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-bounded-script-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = join(root, "worker.mjs");
  return { root, entry, put: code => writeFileSync(entry, code) };
}
function executing(pid) {
  try { return !/[)] [ZX] /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function stopped(pids) {
  for (let attempt = 0; attempt < 100 && pids.some(executing); attempt++) await delay(20);
  for (const pid of pids) assert.equal(executing(pid), false, `owned process ${pid} still executing`);
}

test("AV-31: bounded script propagates normal and failed exit codes and returns signal listeners", async t => {
  const f = fixture(t), before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
  for (const code of [0, 7]) {
    f.put(`process.exitCode = ${code};`);
    assert.equal(await runBoundedScript(f.entry, [], { timeoutMs: 2000 }), code);
    assert.deepEqual([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")], before);
  }
  await assert.rejects(runBoundedScript(f.entry, [], { timeoutMs: 0 }), /positive bounded/);
});

test("AV-31: timeout kills an owned functional script and its engine process group", async t => {
  const f = fixture(t), pidsFile = join(f.root, "pids");
  f.put(`import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify([process.pid, child.pid]));
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  await assert.rejects(runBoundedScript(f.entry, [], { timeoutMs: 1000, stopMs: 2000 }), /bounded lifetime/);
  await stopped(JSON.parse(readFileSync(pidsFile, "utf8")));
});

test("AV-31: interrupting the script owner kills the owned worker rather than orphaning it", async t => {
  const f = fixture(t), pidsFile = join(f.root, "pid");
  f.put(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(pidsFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
  const helper = pathToFileURL(join(import.meta.dirname, "../scripts/bounded-script.mjs")).href;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", `
    import { runBoundedScript } from ${JSON.stringify(helper)};
    try { await runBoundedScript(${JSON.stringify(f.entry)}, [], { timeoutMs: 10000 }); }
    catch { process.exitCode = 1; }`], { stdio: "ignore" });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill("SIGKILL"); });
  const closed = new Promise(resolve => parent.once("close", (code, signal) => resolve({ code, signal })));
  let pid;
  for (let attempt = 0; attempt < 100 && pid === undefined; attempt++) {
    try { pid = Number(readFileSync(pidsFile, "utf8")); } catch { await delay(20); }
  }
  assert.ok(pid > 0); parent.kill("SIGTERM");
  assert.deepEqual(await closed, { code: 1, signal: null });
  await stopped([pid]);
});
