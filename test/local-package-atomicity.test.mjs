// #14: actual CLI, real first install and a controlled engine failure/crash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { readPackageIndex } from '#oma-test/app/runtime/packages/index';
function unseal(path) { chmodSync(path, 0o700); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) unseal(join(path, item.name)); }

test("002. Standalone login and package listing work from HOME without admitting a project session", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-cli-home-")), home = join(root, "home"), run = join(root, "run");
  mkdirSync(home); mkdirSync(run, { mode: 0o700 });
  const engine = join(root, "test-engine.mjs");
  writeFileSync(engine, `#!${process.execPath}\nprocess.stdout.write("standalone-engine-reached\\n");\n`, { mode: 0o700 });
  try {
    for (const args of [["login"], ["pi", "list"]]) {
      const child = spawn(process.execPath, [resolve("apps/oma/dist/entry/oma.js"), ...args], { cwd: home,
        env: { HOME: home, XDG_DATA_HOME: join(home, ".local/share"), XDG_RUNTIME_DIR: run,
          PATH: process.env.PATH, LANG: "C.UTF-8", OMA_PI_COMMAND: engine }, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
      const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(status, 0, output); assert.match(output, /standalone-engine-reached/u);
    }
  } finally { unseal(root); rmSync(root, { recursive: true, force: true }); }
});
test("001. Failed and interrupted replacements preserve configured bytes/settings/index; successful replacement still installs", { timeout: 90000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'oma-cli-atomicity-'));
  for (const name of ['project', 'home', 'data', 'run']) mkdirSync(join(root, name), { mode: 0o700 });
  const source = join(root, 'hello.js'), store = join(root, 'data/oma/.packages'), record = join(root, 'engine.json');
  const files = ['local/hello.js', 'settings.json', 'oma-extensions.json'];
  const env = { HOME: join(root, 'home'), XDG_DATA_HOME: join(root, 'data'), XDG_RUNTIME_DIR: join(root, 'run'), PATH: process.env.PATH, LANG: 'C.UTF-8' };
  let enginePid;
  function cli(args, override) {
    const child = spawn(process.execPath, [resolve('apps/oma/dist/entry/oma.js'), 'pi', ...args], {
      cwd: join(root, 'project'), env: { ...env, ...(override ? { OMA_PI_COMMAND: override } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => output += bytes);
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, output }); }); });
    return { child, done };
  }
  const snapshot = () => files.map(name => readFileSync(join(store, name)));
  try {
    writeFileSync(source, 'export default function () {}\n// old accepted bytes\n');
    const installed = await cli(['install', source]).done; assert.equal(installed.status, 0, installed.output);
    const original = snapshot();
    writeFileSync(source, 'export default function () {}\n// replacement bytes\n');
    for (const mutate of [false, true]) {
      const engine = join(root, `fail-${mutate}`);
      writeFileSync(engine, `#!${process.execPath}\nimport{writeFileSync,chmodSync}from'node:fs';
        ${mutate ? `for(const file of ${JSON.stringify(files.slice(1).map(name => join(store, name)))}){chmodSync(file,0o600);writeFileSync(file,'engine partial settings/index');}` : ''}
        process.exit(7);`, { mode: 0o700 });
      const failed = await cli(['install', source], engine).done; assert.equal(failed.status, 7, failed.output);
      assert.deepEqual(snapshot(), original, `engine failure mutate=${mutate} changed configured state`);
    }
    const blocking = join(root, 'blocking-engine');
    writeFileSync(blocking, `#!${process.execPath}\nimport{writeFileSync,chmodSync}from'node:fs';
      for(const file of ${JSON.stringify(files.slice(1).map(name => join(store, name)))}){chmodSync(file,0o600);writeFileSync(file,'interrupted settings/index');}
      writeFileSync(${JSON.stringify(record)},JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);`, { mode: 0o700 });
    const interrupted = cli(['install', source], blocking);
    const deadline = Date.now() + 15000;
    while (!existsSync(record) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(record), 'controlled engine did not start'); enginePid = JSON.parse(readFileSync(record, 'utf8')).pid;
    interrupted.child.kill('SIGKILL');
    const listEngine = join(root, 'list-engine'); writeFileSync(listEngine, `#!${process.execPath}\nprocess.exit(0);`, { mode: 0o700 });
    const busy = await cli(['list'], listEngine).done;
    assert.notEqual(busy.status, 0, 'an inherited live engine lease was ignored'); assert.match(busy.output, /Another oma pi command/);
    process.kill(enginePid, 'SIGKILL'); enginePid = undefined; await interrupted.done;
    assert.throws(() => readPackageIndex(store), error => error.code === 'BROKER_UNAVAILABLE', 'a normal runtime must not consume an interrupted replacement');
    const recovered = await cli(['list'], listEngine).done; assert.equal(recovered.status, 0, recovered.output);
    assert.deepEqual(snapshot(), original, 'new owner failed to restore the exact preimage before its index read');
    const success = await cli(['install', source]).done; assert.equal(success.status, 0, success.output);
    assert.equal(readFileSync(join(store, 'local/hello.js'), 'utf8'), readFileSync(source, 'utf8'));
    assert.equal(readdirSync(store).some(name => name.startsWith('.replacement-local-')), false);
  } finally {
    if (enginePid !== undefined) { try { process.kill(enginePid, 'SIGKILL'); } catch {} }
    unseal(root); rmSync(root, { recursive: true, force: true });
  }
});
