/** Actual cleanup/lock/settings owners; effects are local fixtures or controlled.
 * No credential, native Mac, VM, service manager or provider is exercised. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import { withCleanup, withAsyncCleanup } from '../dist/src/process/cleanup.js';
import { StoreError, primaryFailure, normalizeStorageFailure, errorCodeOf } from '../dist/src/domain/errors.js';

const require = createRequire(import.meta.url);
function load(file, replacements = {}, platform = 'linux') {
  const source = fs.readFileSync(process.env.OMA_CLEANUP_SOURCE_TARGET === file ? process.env.OMA_CLEANUP_SOURCE : file, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(resolve(file)).href));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports, Buffer, URL, AggregateError,
    process: { platform, arch: process.arch }, require(name) {
      if (Object.hasOwn(replacements, name)) return replacements[name];
      return require(name.startsWith('.') ? resolve('dist', dirname(file), name) : name);
    } });
  return module.exports;
}
const cleanup = load('src/process/cleanup.ts');
const primary = new StoreError('STORE_CORRUPT', 'fixture primary');
const secondary = Object.assign(new Error('fixture cleanup'), { code: 'ENOSPC' });
function both(error, ...failures) {
  const first = failures.length > 0 ? failures[0] : primary, second = failures.length > 1 ? failures[1] : secondary;
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [first, second]);
  assert.equal(primaryFailure(error), first);
  return true;
}
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-owned-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
for (const [name, run] of [['sync', cleanup.withCleanup], ['async', cleanup.withAsyncCleanup]]) {
  test(`Owned cleanup ${name}: success, primary, cleanup-only and both retain exact outcomes`, async () => {
    for (const effectFailed of [false, true]) for (const cleanupFailed of [false, true]) {
      let returned = 0;
      const effect = () => { if (effectFailed) throw primary; return 17; };
      const dispose = () => { returned++; if (cleanupFailed) throw secondary; };
      const result = Promise.resolve().then(() => run(effect, dispose));
      if (effectFailed && cleanupFailed) await assert.rejects(result, both);
      else if (effectFailed || cleanupFailed) await assert.rejects(result, error => error === (effectFailed ? primary : secondary));
      else assert.equal(await result, 17);
      assert.equal(returned, 1);
    }
  });
  test(`Owned cleanup ${name}: thrown null or undefined is still a primary failure`, async () => {
    for (const value of [null, undefined]) await assert.rejects(Promise.resolve().then(() => run(() => { throw value; }, () => { throw secondary; })), error => both(error, value));
  });
}
test('Owned cleanup async: pending effect and cleanup are both awaited', async () => {
  let settle, dispose, returned = 0, done = false;
  const effect = new Promise(resolve => { settle = resolve; });
  const cleanupResult = new Promise(resolve => { dispose = resolve; });
  const result = cleanup.withAsyncCleanup(() => effect, () => { returned++; return cleanupResult; }).then(value => { done = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, 0); assert.equal(done, false);
  settle(17); await new Promise(resolve => setImmediate(resolve)); assert.equal(returned, 1); assert.equal(done, false);
  dispose(); assert.equal(await result, 17); assert.equal(done, true);
});
test('Owned cleanup: nested secondary exhaustion cannot erase corruption or publication knowledge', () => {
  const unconfirmed = new StoreError('BROKER_UNAVAILABLE', 'fixture publication', { details: { publication: 'unconfirmed' } });
  for (const first of [primary, unconfirmed]) {
    let caught;
    try { cleanup.withCleanup(() => cleanup.withCleanup(() => { throw first; }, () => { throw secondary; }), () => { throw secondary; }); }
    catch (error) { caught = error; }
    assert.equal(primaryFailure(caught), first); assert.equal(errorCodeOf(caught), first.code);
    const normalized = normalizeStorageFailure(caught);
    assert.equal(normalized.code, first.code); assert.deepEqual(normalized.details, first.details); assert.equal(normalized.cause, caught);
  }
});

for (const failure of ['flock', 'stat', 'shape', 'contended-close']) test(`Owned cleanup ProcessLock: ${failure} returns the descriptor once without replacing the primary`, () => {
  let returned = 0;
  const api = load('src/runtime/process-lock.ts', {
    'node:fs': { ...fs, openSync: () => 17, closeSync(fd) { assert.equal(fd, 17); returned++; throw secondary; },
      fstatSync() { if (failure === 'stat') throw primary; return { isFile: () => failure !== 'shape', nlink: 1n, dev: 1n, ino: 2n }; } },
    '../leaf.js': { lockFileDescriptor() { if (failure === 'flock') throw primary; return { kind: failure === 'contended-close' ? 'contended' : 'held' }; } },
  });
  assert.throws(() => api.ProcessLock.tryAcquire('/fixture/lock'), error => {
    if (failure === 'contended-close') return error === secondary;
    if (failure === 'shape') { assert.equal(errorCodeOf(error), 'BROKER_UNAVAILABLE'); assert.equal(error.errors[1], secondary); return true; }
    return both(error);
  });
  assert.equal(returned, 1);
});
test('Owned cleanup ProcessLock: a failed close is never retried and revokes descriptor access', () => {
  let returned = 0;
  const api = load('src/runtime/process-lock.ts', {
    'node:fs': { ...fs, openSync: () => 17, closeSync() { returned++; throw secondary; },
      fstatSync: () => ({ isFile: () => true, nlink: 1n, dev: 1n, ino: 2n }) },
    '../leaf.js': { lockFileDescriptor: () => ({ kind: 'held' }) },
  });
  const lock = api.ProcessLock.tryAcquire('/fixture/lock');
  assert.throws(() => lock.close(), error => error === secondary); assert.doesNotThrow(() => lock.close());
  assert.equal(returned, 1); assert.throws(() => lock.descriptor, { code: 'BROKER_UNAVAILABLE' });
});

for (const operation of ['openDirectory', 'openRegularBeneath']) for (const succeeds of [false, true])
  test(`Owned cleanup contained: ${operation} ${succeeds ? 'untransferred result is closed' : 'primary observation survives'} when its pin close fails`, () => {
    const returned = [];
    const api = load('src/storage/contained-fs.ts', {
      'node:fs': { ...fs, openSync: path => path === '/' ? 11 : 19,
        fstatSync() { if (!succeeds) throw primary; return { isFile: () => true }; },
        closeSync(fd) { returned.push(fd); if (fd !== 19) throw secondary; } },
      koffi: { errno: () => 0, load: () => ({ func: signature => signature.startsWith('long syscall')
        ? () => { if (!succeeds && operation === 'openDirectory') throw primary; return operation === 'openDirectory' ? 19 : 13; }
        : () => 0 }) },
    });
    const run = () => operation === 'openDirectory' ? api.openDirectory('/fixture') : api.openRegularBeneath(7, 'file');
    assert.throws(run, error => succeeds ? error === secondary : both(error));
    assert.deepEqual(returned, succeeds ? [operation === 'openDirectory' ? 11 : 13, 19] : [operation === 'openDirectory' ? 11 : 13]);
  });
test('Owned cleanup contained: directory body failure survives parent close failure', () => {
  const api = load('src/storage/contained-fs.ts', {
    'node:fs': { ...fs, openSync: () => 11, closeSync() { throw secondary; } },
    koffi: { errno: () => 0, load: () => ({ func: signature => signature.startsWith('long syscall') ? () => 19 : () => 0 }) },
  });
  assert.throws(() => api.withinDirectory('/record', () => { throw primary; }), both);
});

for (const operation of ['openDirectory', 'openRegularBeneath'])
  test(`Owned cleanup contained: ${operation} retains both failed descriptor returns`, () => {
    const returned = [], last = new Error('fixture result close failed');
    const api = load('src/storage/contained-fs.ts', {
      'node:fs': { ...fs, openSync: path => path === '/' ? 11 : 19,
        fstatSync: () => ({ isFile: () => true }), closeSync(fd) { returned.push(fd); throw fd === 19 ? last : secondary; } },
      koffi: { errno: () => 0, load: () => ({ func: signature => signature.startsWith('long syscall')
        ? () => operation === 'openDirectory' ? 19 : 13 : () => 0 }) },
    });
    assert.throws(() => operation === 'openDirectory' ? api.openDirectory('/fixture') : api.openRegularBeneath(7, 'file'),
      error => both(error, secondary, last));
    assert.deepEqual(returned, [operation === 'openDirectory' ? 11 : 13, 19]);
  });

for (const failed of [false, true]) test(`Owned cleanup host temporary: ${failed ? 'failed' : 'successful'} close is never retried by discard`, () => {
  const returned = [], removed = [];
  const api = load('src/platform/host/files.ts', { 'node:fs': { ...fs, openSync: () => 17,
    closeSync(fd) { returned.push(fd); if (failed) throw secondary; }, rmSync(path) { removed.push(path); } } });
  const temporary = api.createTemporary('/fixture', 'record');
  if (failed) assert.throws(() => temporary.close(), error => error === secondary); else temporary.close();
  assert.doesNotThrow(() => temporary.close()); assert.doesNotThrow(() => api.discardTemporary(temporary));
  assert.deepEqual(returned, [17]); assert.deepEqual(removed, [temporary.path]);
});
test('Owned cleanup host temporary: discard attempts name removal even when close fails and retains both failures', () => {
  const last = new Error('fixture remove failed'), returned = [], removed = [];
  const api = load('src/platform/host/files.ts', { 'node:fs': { ...fs, openSync: () => 17,
    closeSync(fd) { returned.push(fd); throw secondary; }, rmSync(path) { removed.push(path); throw last; } } });
  const temporary = api.createTemporary('/fixture', 'record');
  assert.throws(() => api.discardTemporary(temporary), error => both(error, secondary, last));
  assert.deepEqual(returned, [17]); assert.deepEqual(removed, [temporary.path]);
});
test('Owned cleanup host temporary: a published descriptor number may be reused before abandon, never closed again', () => {
  let returned = 0, reused = false;
  const api = load('src/platform/host/files.ts', { 'node:fs': { ...fs,
    openSync: () => reused ? 23 : 17, closeSync(fd) { assert.equal(reused && fd === 17, false); returned++; },
    fsyncSync() {}, linkSync() {}, unlinkSync() {}, rmSync() {} } });
  const temporary = api.createTemporary('/fixture', 'record');
  assert.equal(api.publishTemporary(temporary, '/fixture', 'record'), 'created');
  reused = true; api.discardTemporary(temporary);
  assert.equal(returned, 2, 'one temporary and one directory, not the reused number');
});
for (const stage of ['write', 'file-flush', 'close', 'rename', 'directory-flush'])
  test(`Owned cleanup host replacement: ${stage} failure preserves its primary beside discard failure`, () => {
    const returned = [], calls = [], removed = [], last = new Error('fixture discard failed');
    const api = load('src/platform/host/files.ts', { 'node:fs': { ...fs,
      openSync(_path, flags) { return flags === fs.constants.O_RDONLY ? 23 : 17; },
      writeSync(_fd, _bytes, _at, count) { calls.push('write'); if (stage === 'write') throw primary; return count; },
      fsyncSync(fd) { calls.push(fd === 17 ? 'file-flush' : 'directory-flush');
        if (stage === (fd === 17 ? 'file-flush' : 'directory-flush')) throw primary; },
      closeSync(fd) { returned.push(fd); if (stage === 'close' && fd === 17) throw primary; },
      renameSync() { calls.push('rename'); if (stage === 'rename') throw primary; },
      rmSync(path) { removed.push(path); throw last; },
    } });
    assert.throws(() => api.replaceFile('/fixture', 'record', 'whole'), error => both(error, primary, last));
    assert.equal(returned.filter(fd => fd === 17).length, 1); assert.equal(removed.length, 1);
    assert.equal(calls.includes('rename'), ['rename', 'directory-flush'].includes(stage));
    assert.equal(returned.includes(23), stage === 'directory-flush');
  });
for (const stage of ['link', 'existing']) test(`Owned cleanup host publication: ${stage} beside removal failure is not success`, () => {
  const exists = Object.assign(new Error('fixture existing'), { code: 'EEXIST' }), returned = [], removed = [];
  const api = load('src/platform/host/files.ts', { 'node:fs': { ...fs,
    openSync: () => 17, fsyncSync() {}, closeSync(fd) { returned.push(fd); },
    linkSync() { throw stage === 'link' ? primary : exists; }, rmSync(path) { removed.push(path); throw secondary; },
  } });
  assert.throws(() => api.publishMade('/fixture/partial', '/fixture', 'record'), error => stage === 'link' ? both(error) : error === secondary);
  assert.deepEqual(returned, [17]); assert.deepEqual(removed, ['/fixture/partial']);
});
for (const operation of ['encryptArchive', 'decryptArchive']) for (const stage of ['output-open', 'read'])
  test(`Owned cleanup archive: ${operation} ${stage} failure gives back every acquired descriptor without erasing its primary`, () => {
    const returned = [];
    const api = load('src/platform/host/archive-crypto.ts', { 'node:fs': { ...fs,
      openSync(path) { if (path === '/fixture/input') return 11; if (stage === 'output-open') throw primary; return 19; },
      readSync() { throw primary; }, writeSync(_fd, _bytes, _at, count) { return count; },
      closeSync(fd) { returned.push(fd); throw secondary; },
    } });
    assert.throws(() => api[operation]('/fixture/input', '/fixture/output', Buffer.alloc(32)), error => {
      assert.equal(primaryFailure(error), primary);
      if (stage === 'output-open') return both(error);
      assert.deepEqual(error.errors[0].errors, [primary, secondary]); assert.equal(error.errors[1], secondary); return true;
    });
    assert.deepEqual(returned, stage === 'output-open' ? [11] : [19, 11]);
  });
test('Owned cleanup archive: constructor failure retains temporary discard failure', () => {
  let returned = 0;
  const api = load('src/platform/host/archive-crypto.ts', { './files.js': {
    createTemporary: () => ({ fd: 17 }), discardTemporary() { returned++; throw secondary; },
  } });
  assert.throws(() => api.sealedArchiveSink('/fixture', 'record', Buffer.alloc(0)), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(errorCodeOf(error), 'INVALID_REQUEST'); assert.equal(error.errors[1], secondary); return true;
  });
  assert.equal(returned, 1);
});
for (const stage of ['clone', 'publish', 'success']) test(`Owned cleanup stopped snapshot: ${stage} beside discard failure retains exact outcome`, async () => {
  let returned = 0, visible = false;
  const api = load('src/platform/host/snapshot.ts', {
    'node:fs': { ...fs, readdirSync: () => [] }, './files.js': {
      temporaryPath: () => '/fixture/partial', publishMade() { visible = true; if (stage === 'publish') throw primary; return 'created'; },
      discardTemporary(path) { assert.equal(path, '/fixture/partial'); returned++; throw secondary; },
    },
  });
  await assert.rejects(api.snapshotStopped({ dir: '/fixture', statePath: '/fixture/state',
    clone() { if (stage === 'clone') throw primary; } }, 'record'), error => stage === 'success' ? error === secondary : both(error));
  assert.equal(returned, 1); assert.equal(visible, stage !== 'clone');
});
for (const stage of ['read', 'close']) test(`Owned cleanup engine file: ${stage} and parent close failures preserve ordered ownership returns`, () => {
  const returned = [], last = new Error('fixture parent close failed');
  const api = load('src/runtime/pi-runtime.ts', {
    '../storage/contained-fs.js': { openDirectory: () => 11, openRegularBeneath: () => 19 },
    'node:fs': { ...fs, fstatSync: () => ({ isFile: () => true, size: 1, mtimeMs: 0 }),
      readSync(_fd, bytes) { if (stage === 'read') throw primary; bytes[0] = 65; return 1; },
      closeSync(fd) { returned.push(fd); throw fd === 19 ? secondary : last; } },
  });
  assert.throws(() => api.engineFile('/fixture', 'record', 64), error => {
    if (stage === 'close') return both(error, secondary, last);
    assert.deepEqual(error.errors[0].errors, [primary, secondary]); assert.equal(error.errors[1], last); return true;
  });
  assert.deepEqual(returned, [19, 11]);
});

for (const file of ['src/runtime/personal-settings.ts', 'src/runtime/pi-runtime.ts'])
  for (const failed of [false, true]) test(`Owned cleanup settings ${file}: ${failed ? 'read failure plus' : 'only'} writer close failure is not success`, t => {
    const root = fixture(t); let returned = 0, writes = 0;
    // fix/fp moved pi-runtime's lock+replace behind the shared lockedUserReplace
    // (src/runtime/locked-files.ts). The contract under test is unchanged, so
    // pi-runtime gets the real primitive loaded with the same controlled
    // internals instead of stubs it no longer calls.
    const internals = {
      './process-lock.js': { ProcessLock: { acquire: take, tryAcquire: take } },
      './user-files.js': { ensureUserDirectory() {}, readUserFile() { if (failed) throw primary; return null; }, replaceUserFile() { writes++; } },
      './pi-packages.js': { readPackageIndex: () => [], reconciledEntries: entries => entries },
    };
    const api = load(file, file.endsWith('pi-runtime.ts')
      ? { './locked-files.js': load('src/runtime/locked-files.ts', internals) }
      : internals);
    function take() { return { assertHeld() {}, close() { returned++; throw secondary; } }; }
    assert.throws(() => file.endsWith('personal-settings.ts')
      ? api.updatePersonalSettings({ dataRoot: root, libdir: root, packages: root }) : api.preparePiRetry(root),
    error => failed ? both(error) : error === secondary);
    assert.equal(returned, 1); assert.equal(writes, failed ? 0 : 1);
  });
for (const failed of [false, true]) test(`Owned cleanup Keychain: controlled ${failed ? 'store failure plus' : 'only'} lock close failure retains exact outcome`, async () => {
  let returned = 0, writes = 0;
  const api = load('src/platform/host/keychain.ts', {
    '../../runtime/user-files.js': { ensureUserDirectory() {} },
    '../../runtime/process-lock.js': { ProcessLock: { tryAcquire: () => ({ descriptor: 17, assertHeld() {}, close() { returned++; throw secondary; } }) } },
  });
  const store = { async get() { if (failed) throw primary; return '{}'; }, async put() { writes++; } };
  const credential = api.keychainCredentials(store, 'fixture-account', '/fixture/item.lock');
  await assert.rejects(credential.modify('fixture', () => ({ type: 'api_key', key: 'fixture-only' })), error => failed ? both(error) : error === secondary);
  assert.equal(returned, 1); assert.equal(writes, failed ? 0 : 1);
});
