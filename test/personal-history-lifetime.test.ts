/** Real Linux process/lock boundaries with fixture children, never Pi or a provider. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { personalBirth, runPersonalSession } from "#oma-test/app/runtime/personal-session";
import { ProcessLock } from "@oma/native/process-lock";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { PI_PACKAGE } from "@oma/engine/pi-runtime";

const fixtureChild = `
const fs = require('node:fs'), path = require('node:path');
const directory = process.argv[process.argv.indexOf('--packages') + 1];
const lock = fs.fstatSync(3, { bigint: true });
fs.writeFileSync(path.join(directory, 'ready'), JSON.stringify({ dev: String(lock.dev), ino: String(lock.ino), ipc: process.connected }));
process.send({ type: 'switch', session: '/fixture/next.jsonl' });
const watchdog = setTimeout(() => process.exit(83), 15000);
const poll = setInterval(() => {
  if (!fs.existsSync(path.join(directory, 'finish'))) return;
  clearTimeout(watchdog); clearInterval(poll); process.exit(0);
}, 10);
`;
function fixture(): { directory: string; lockPath: string; options: Parameters<typeof runPersonalSession>[0] } {
  const directory = mkdtempSync(join(tmpdir(), "oma-personal-history-"));
  const dataRoot = join(directory, "data"), libdir = join(directory, "install"), packages = join(directory, "signals");
  mkdirSync(packages); mkdirSync(dataRoot);
  const entry = join(libdir, DEPLOYMENT_LAYOUT.entries.personal), engine = join(libdir, "node_modules", PI_PACKAGE);
  mkdirSync(join(libdir, "apps", "oma", "dist", "entry"), { recursive: true }); mkdirSync(engine, { recursive: true });
  const toolsPreload = join(libdir, DEPLOYMENT_LAYOUT.interactiveToolsPreload);
  mkdirSync(dirname(toolsPreload), { recursive: true });
  writeFileSync(toolsPreload, "// fixture engine has no interactive tool imports\n");
  writeFileSync(entry, fixtureChild); writeFileSync(join(engine, "package.json"), JSON.stringify({ name: PI_PACKAGE, bin: { pi: "fixture.js" } }));
  writeFileSync(join(engine, "fixture.js"), "// resolver fixture; never executed\n");
  const { root } = personalBirth(dataRoot, directory);
  return { directory, lockPath: join(root, "history.lock"), options: { root, dataRoot, libdir, packages, env: { PATH: "/usr/bin:/bin" } } };
}
async function ready(file: string): Promise<{ dev: string; ino: string; ipc: boolean }> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return JSON.parse(readFileSync(file, "utf8")) as { dev: string; ino: string; ipc: boolean }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (Date.now() >= deadline) throw new Error("fixture writer did not become ready");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function returned(lockPath: string): Promise<ProcessLock> {
  const deadline = Date.now() + 20000;
  for (;;) {
    const lock = ProcessLock.tryAcquire(lockPath);
    if (lock !== null) return lock;
    if (Date.now() >= deadline) throw new Error("fixture writer did not release its inherited lock");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
test("Personal history actual process: inherited inode, concurrent admission and next wait for writer close",
  { skip: process.platform !== "linux", timeout: 25000 }, async t => {
    const { directory, lockPath, options } = fixture(), run = runPersonalSession(options);
    t.after(async () => {
      writeFileSync(join(options.packages, "finish"), "finish\n");
      try { await run; } finally { rmSync(directory, { recursive: true, force: true }); }
    });
    const child = await ready(join(options.packages, "ready")), inode = statSync(lockPath, { bigint: true });
    assert.equal(child.dev, String(inode.dev)); assert.equal(child.ino, String(inode.ino)); assert.equal(child.ipc, true);
    assert.equal(ProcessLock.tryAcquire(lockPath), null, "the direct child is still a history writer");
    await assert.rejects(runPersonalSession(options), { code: "BROKER_UNAVAILABLE" });
    let didReturn = false; void run.then(() => { didReturn = true; });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(didReturn, false, "a switch message does not release the outgoing writer");
    writeFileSync(join(options.packages, "finish"), "finish\n");
    const ended = await run; assert.equal(ended.code, 0); assert.equal(ended.next?.session, "/fixture/next.jsonl");
    const next = ProcessLock.tryAcquire(lockPath); assert.ok(next, "history becomes available after actual child close"); next.close();
  });
test("Personal history actual process: inherited lock survives an exited parent until the fixture writer ends",
  { skip: process.platform !== "linux", timeout: 25000 }, async t => {
    const { directory, lockPath, options } = fixture(), parentEntry = join(directory, "parent.mjs");
    writeFileSync(parentEntry, `
import { existsSync } from 'node:fs';
import { runPersonalSession } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/runtime/personal-session")).href)};
const options = ${JSON.stringify(options)};
void runPersonalSession(options).catch(() => process.exit(84));
const deadline = setTimeout(() => process.exit(85), 10000);
const poll = setInterval(() => {
  if (!existsSync(${JSON.stringify(join(options.packages, "ready"))})) return;
  clearTimeout(deadline); clearInterval(poll); process.exit(0);
}, 10);
`);
    const parent = spawn(process.execPath, [parentEntry], { cwd: directory, env: { PATH: "/usr/bin:/bin" }, stdio: "ignore" });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      parent.once("error", reject); parent.once("close", (code, signal) => resolve({ code, signal }));
    });
    t.after(async () => {
      writeFileSync(join(options.packages, "finish"), "finish\n");
      try { await closed; (await returned(lockPath)).close(); }
      finally { rmSync(directory, { recursive: true, force: true }); }
    });
    const end = await closed; assert.deepEqual(end, { code: 0, signal: null });
    await ready(join(options.packages, "ready"));
    assert.equal(ProcessLock.tryAcquire(lockPath), null, "parent exit cannot release the live writer's descriptor");
    await assert.rejects(runPersonalSession(options), { code: "BROKER_UNAVAILABLE" });
    writeFileSync(join(options.packages, "finish"), "finish\n");
    (await returned(lockPath)).close();
  });
