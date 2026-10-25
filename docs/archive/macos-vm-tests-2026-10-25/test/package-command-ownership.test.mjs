/** Actual package-command owners, with only engine/store/service effects controlled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import { withAsyncCleanup } from "@oma/native/cleanup";

function world(platform, { command = 'update', args = [command, 'npm:fixture'], code = 0, failure, cleanupFailure, synced = true, hostOnly = false, lockFailure, contended = false } = {}) {
  const file = platform === 'darwin' ? 'apps/oma/src/entry/oma-mac.ts' : 'apps/oma/src/entry/oma-society.ts';
  const source = readFileSync(process.env.OMA_PACKAGE_SOURCE ?? file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const name = platform === 'darwin' ? 'packages' : 'piPackages';
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} is not in ${file}`);
  const compiled = ts.transpileModule(`${declaration.getText(parsed)}\n${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText.replaceAll('import.meta.url', '"file:///fixture/apps/oma/dist/entry/oma-mac.js"');
  const calls = [], output = [], primary = new Error(`fixture ${failure} failed`);
  let held = false, returns = 0, pending;
  const step = async name => {
    assert.equal(held, true, `${name} ran without the package owner`);
    calls.push(name);
    if (failure === name) throw primary;
    if (failure === `pending-${name}`) await new Promise(resolve => { pending = resolve; });
  };
  const lock = { descriptor: 17, fence: 17, assertHeld() { assert.equal(held, true); calls.push('assert-held'); },
    close() { calls.push('return'); returns++; held = false; if (cleanupFailure) throw cleanupFailure; }, release() { this.close(); } };
  const packageDirectories = Object.freeze({}); // Directory effects belong to the controlled index boundary.
  const run = new Script(compiled, { filename: file }).runInNewContext({
    ...path, fileURLToPath(url) { if (failure === 'location') throw primary; return fileURLToPath(url); },
    URL, withAsyncCleanup, packageDirectories, engineLoginDirectory: {}, home: '/fixture/home', exports: {},
    process: { env: {}, stdout: { write(line) { output.push(line); } }, exit(value) { throw { exit: value }; } },
    ensureDirectory() { calls.push('directory'); },
    ensureOwnedDirectory(directory, ownedFrom, mode) {
      calls.push('directory');
      // The store's boundary is the data root -- never the store itself or
      // the user's tree above it.
      assert.equal(directory, '/fixture/packages');
      assert.equal(ownedFrom, '/fixture/home', 'the owned boundary is the data root, never the store itself');
      assert.equal(mode, 0o700);
    },
    ensureUserDirectory(directory) { calls.push(`directory:${directory}`); if (failure === `directory:${directory}`) throw primary; },
    ensureOwnedUserDirectory(directory, ownedFrom) {
      calls.push(`directory:${directory}`);
      assert.equal(ownedFrom, '/fixture/home', 'the owned boundary is the app home, never the slot itself');
      if (failure === `directory:${directory}`) throw primary;
    },
    ProcessLock: { tryAcquire() { calls.push('take'); if (lockFailure) throw lockFailure; if (contended) return null; held = true; return lock; } },
    tryHoldSociety() { held = true; calls.push('take'); return lock; },
    packageStoreDir: () => '/fixture/packages',
    readPackageIndex() { assert.equal(held, true); calls.push('before'); if (failure === 'before') throw primary; return []; },
    async runEngineLogin(_directoryOwner, options) { assert.equal(options.fence, 17); await step('engine'); return code; },
    async writePackageIndex(_store, directories) { assert.equal(directories, packageDirectories); await step('index'); return []; },
    stageLocalPackage(_store, source) { assert.equal(held, true); calls.push('stage'); if (failure === 'stage') throw primary; return 'local/staged'; },
    pruneLocalStage() { assert.equal(held, true); calls.push('prune'); if (failure === 'prune') throw primary; },
    packageListLines() { assert.equal(held, true); return []; },
    reconcilePersonalSettings(options) { assert.equal(held, true); calls.push('personal');
      assert.equal(options.dataRoot, '/fixture/home'); if (failure === 'personal') throw primary; },
    applyPackageChange() { assert.equal(held, true); calls.push('roles'); if (failure === 'roles') throw primary; return { ok: synced, said: [] }; },
    packageActivation: decision => decision.command === 'install' ? 'npm:fixture' : undefined,
    async call(method) { assert.equal(method, 'packages.sync'); await step('sync'); return { ok: synced }; },
    randomUUID: () => 'fixture-key', humanStream: () => ({ write() {} }),
    say(_line, value) { throw { exit: value }; }, fail(_line, value) { throw { exit: value }; },
    codeFor: () => 1, exitFor: () => 1, errorWords: String,
  });
  const decision = { kind: 'run', command, args, ...(hostOnly ? { hostOnly: true } : {}) };
  return { calls, output, primary, get held() { return held; }, get returns() { return returns; }, resolve() { pending(); },
    run: () => platform === 'darwin' ? run(decision) : run('/fixture/home', 'project', decision) };
}
for (const platform of ['linux', 'darwin']) {
  test(`Package owner ${platform}: a successful change refreshes the shared index and existing Personal preferences before returning its lock`, async () => {
    const w = world(platform); await assert.rejects(w.run(), error => error.exit === 0);
    assert.deepEqual(w.calls, platform === 'darwin'
      ? ['directory:/fixture/home/packages', 'directory:/fixture/home/run', 'take', 'engine', 'assert-held', 'index', 'prune', 'personal', 'sync', 'return']
      : ['directory', 'take', 'before', 'engine', 'index', 'prune', 'roles', 'personal', 'return']);
    assert.equal(w.returns, 1); assert.equal(w.held, false);
  });
  for (const failure of platform === 'darwin' ? ['location', 'engine', 'index', 'prune', 'personal', 'sync'] : ['before', 'engine', 'index', 'prune', 'roles', 'personal'])
    test(`Package owner ${platform}: ${failure} failure returns the acquired lock and is not success`, async () => {
      const w = world(platform, { failure }); await assert.rejects(w.run(), error => error === w.primary);
      assert.equal(w.returns, 1); assert.equal(w.held, false); assert.equal(w.calls.at(-1), 'return');
      assert.equal(w.calls.some(call => call === 'sync' && failure !== 'sync'), false);
    });
  for (const target of ['engine', 'index', ...(platform === 'darwin' ? ['sync'] : [])])
    test(`Package owner ${platform}: pending ${target} retains ownership until the effect answers`, async () => {
      const w = world(platform, { failure: `pending-${target}` }), done = assert.rejects(w.run(), error => error.exit === 0);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(w.held, true); assert.equal(w.returns, 0); assert.equal(w.calls.at(-1), target);
      w.resolve(); await done; assert.equal(w.returns, 1);
    });
  for (const options of [{ code: 7 }, { command: 'list', args: ['list'] }, { args: ['install', '--help'] }, { args: ['install', '-h'] }])
    test(`Package owner ${platform}: ${JSON.stringify(options)} does not reinterpret a non-change as extension selection`, async () => {
      const w = world(platform, options); await assert.rejects(w.run(), error => error.exit === (options.code ?? 0));
      for (const effect of ['index', 'prune', 'personal', 'roles', 'sync']) assert.equal(w.calls.includes(effect), false, effect);
      assert.equal(w.returns, 1);
    });
  test(`Package owner ${platform}: failed project application remains nonzero after host preferences are reconciled`, async () => {
    const w = world(platform, { synced: false }); await assert.rejects(w.run(), error => error.exit === 1);
    assert.ok(w.calls.includes('personal')); assert.equal(w.returns, 1);
  });
}
test('Package owner darwin: explicit host-only refreshes the same store without selecting or synchronizing Society', async () => {
  const w = world('darwin', { hostOnly: true }); await assert.rejects(w.run(), error => error.exit === 0);
  assert.deepEqual(w.calls, ['directory:/fixture/home/packages', 'directory:/fixture/home/run', 'take', 'engine', 'assert-held', 'index', 'prune', 'personal', 'return']);
  assert.match(w.output.join(''), /Society packages were not synchronized/); assert.equal(w.returns, 1);
});
for (const failure of ['location', 'engine', 'index', 'personal'])
  test(`Package owner darwin: host-only ${failure} failure is not a successful local change`, async () => {
    const w = world('darwin', { hostOnly: true, failure }); await assert.rejects(w.run(), error => error === w.primary);
    assert.equal(w.returns, 1); assert.equal(w.calls.includes('sync'), false); assert.deepEqual(w.output, []);
  });
for (const options of [{ code: 7 }, { command: 'list', args: ['list'] }, { args: ['install', '--help'] }])
  test(`Package owner darwin: host-only non-change ${JSON.stringify(options)} does not claim a refresh`, async () => {
    const w = world('darwin', { ...options, hostOnly: true }); await assert.rejects(w.run(), error => error.exit === (options.code ?? 0));
    assert.deepEqual(w.output, []); assert.equal(w.calls.includes('sync'), false); assert.equal(w.returns, 1);
  });
for (const directory of ['/fixture/home/packages', '/fixture/home/run'])
  test(`Package owner darwin: host-only ${directory} preparation failure has no lock or engine effect`, async () => {
    const w = world('darwin', { hostOnly: true, failure: `directory:${directory}` });
    await assert.rejects(w.run(), error => error === w.primary);
    assert.equal(w.returns, 0); assert.equal(w.held, false); assert.equal(w.calls.includes('take'), false); assert.deepEqual(w.output, []);
  });
for (const contended of [false, true]) test(`Package owner darwin: host-only lock ${contended ? 'contention' : 'failure'} never starts the engine`, async () => {
  const problem = new Error('fixture lock failure'), w = world('darwin', { hostOnly: true, contended, ...(contended ? {} : { lockFailure: problem }) });
  await assert.rejects(w.run(), error => contended ? error.exit === 1 : error === problem);
  assert.equal(w.returns, 0); assert.equal(w.held, false); assert.equal(w.calls.includes('engine'), false); assert.deepEqual(w.output, []);
});
for (const failure of [undefined, 'location', 'engine', 'index', 'personal'])
  test(`Package owner darwin: host-only ${failure ?? 'completed local effect'} beside failed lock return retains its actual outcomes`, async () => {
    const cleanupFailure = new Error('fixture close failed'), w = world('darwin', { hostOnly: true, failure, cleanupFailure });
    await assert.rejects(w.run(), error => {
      if (failure === undefined) return error === cleanupFailure;
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [w.primary, cleanupFailure]); return true;
    });
    assert.equal(w.returns, 1); assert.equal(w.held, false); assert.equal(w.calls.includes('sync'), false);
    if (failure === undefined) assert.match(w.output.join(''), /Society packages were not synchronized/);
    else assert.deepEqual(w.output, []);
  });
for (const failure of [undefined, 'location', 'engine', 'index', 'personal', 'sync'])
  test(`Package owner darwin: ${failure ?? 'success'} beside lock close failure retains both outcomes`, async () => {
    const cleanupFailure = new Error('fixture close failed'), w = world('darwin', { failure, cleanupFailure });
    await assert.rejects(w.run(), error => {
      if (failure === undefined) return error === cleanupFailure;
      assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [w.primary, cleanupFailure]); return true;
    });
    assert.equal(w.returns, 1); assert.equal(w.held, false);
    assert.equal(w.calls.at(-1), 'return');
  });
