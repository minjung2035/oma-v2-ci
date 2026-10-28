import { decodePackageIndex } from "#oma-test/app/runtime/packages/index";
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
import { withCleanup, withAsyncCleanup } from "@oma/native/cleanup";
import { workspaceEntryForSource } from "./fixtures/workspace-source.mjs";
import { StoreError, primaryFailure, normalizeStorageFailure, errorCodeOf } from "@oma/domain/errors";

const require = createRequire(import.meta.url);
function load(file, replacements = {}, platform = 'linux') {
  const source = fs.readFileSync(process.env.OMA_CLEANUP_SOURCE_TARGET === file ? process.env.OMA_CLEANUP_SOURCE : file, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(resolve(file)).href));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports, Buffer, URL, AggregateError, performance,
    process: { platform, arch: process.arch }, require(name) {
      if (Object.hasOwn(replacements, name)) return replacements[name];
      if (name.startsWith('.') && (file.startsWith('packages/') || file.startsWith('apps/oma/')))
        return require(workspaceEntryForSource(join(dirname(file), name).replace(/\.js$/, '.ts')));
      return require(name.startsWith('.') ? resolve('dist', dirname(file), name) : name);
    } });
  return module.exports;
}
const cleanup = load("packages/native/src/cleanup.ts");
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
  const api = load('packages/native/src/process-lock.ts', {
    'node:fs': { ...fs, openSync: () => 17, closeSync(fd) { assert.equal(fd, 17); returned++; throw secondary; },
      fstatSync() { if (failure === 'stat') throw primary; return { isFile: () => failure !== 'shape', nlink: 1n, dev: 1n, ino: 2n }; } },
    "./linux.js": { lockFileDescriptor() { if (failure === 'flock') throw primary; return { kind: failure === 'contended-close' ? 'contended' : 'held' }; } },
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
  const api = load('packages/native/src/process-lock.ts', {
    'node:fs': { ...fs, openSync: () => 17, closeSync() { returned++; throw secondary; },
      fstatSync: () => ({ isFile: () => true, nlink: 1n, dev: 1n, ino: 2n }) },
    "./linux.js": { lockFileDescriptor: () => ({ kind: 'held' }) },
  });
  const lock = api.ProcessLock.tryAcquire('/fixture/lock');
  assert.throws(() => lock.close(), error => error === secondary); assert.doesNotThrow(() => lock.close());
  assert.equal(returned, 1); assert.throws(() => lock.descriptor, { code: 'BROKER_UNAVAILABLE' });
});

for (const operation of ['openDirectory', 'openRegularBeneath']) for (const succeeds of [false, true])
  test(`Owned cleanup contained: ${operation} ${succeeds ? 'untransferred result is closed' : 'primary observation survives'} when its pin close fails`, () => {
    const returned = [];
    const api = load("packages/native/src/files.ts", {
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
  const api = load("packages/native/src/files.ts", {
    'node:fs': { ...fs, openSync: () => 11, closeSync() { throw secondary; } },
    koffi: { errno: () => 0, load: () => ({ func: signature => signature.startsWith('long syscall') ? () => 19 : () => 0 }) },
  });
  assert.throws(() => api.withinDirectory('/record', () => { throw primary; }), both);
});

for (const operation of ['openDirectory', 'openRegularBeneath'])
  test(`Owned cleanup contained: ${operation} retains both failed descriptor returns`, () => {
    const returned = [], last = new Error('fixture result close failed');
    const api = load("packages/native/src/files.ts", {
      'node:fs': { ...fs, openSync: path => path === '/' ? 11 : 19,
        fstatSync: () => ({ isFile: () => true }), closeSync(fd) { returned.push(fd); throw fd === 19 ? last : secondary; } },
      koffi: { errno: () => 0, load: () => ({ func: signature => signature.startsWith('long syscall')
        ? () => operation === 'openDirectory' ? 19 : 13 : () => 0 }) },
    });
    assert.throws(() => operation === 'openDirectory' ? api.openDirectory('/fixture') : api.openRegularBeneath(7, 'file'),
      error => both(error, secondary, last));
    assert.deepEqual(returned, [operation === 'openDirectory' ? 11 : 13, 19]);
  });

test('Contained lookup retries transient Linux races without losing real descriptor ownership or confinement', { skip: process.platform !== 'linux' }, t => {
  const root = fixture(t), inside = join(root, 'inside'), outside = join(root, 'outside');
  fs.mkdirSync(inside); fs.mkdirSync(outside);
  fs.writeFileSync(join(inside, 'data'), 'contained bytes');
  fs.writeFileSync(join(outside, 'sentinel'), 'outside untouched');
  fs.symlinkSync('data', join(inside, 'inside-link'));
  fs.symlinkSync(outside, join(inside, 'escape'));
  const real = require('koffi');
  let fault = null, injectedErrno = 0;
  const api = load('packages/native/src/files.ts', {
    koffi: {
      errno: () => injectedErrno || real.errno(),
      load(...arguments_) {
        const library = real.load(...arguments_);
        return { func(signature) {
          const actual = library.func(signature);
          if (!signature.startsWith('long syscall')) return actual;
          return (...arguments_) => {
            if (fault && arguments_[0] === 437 && arguments_[4] === fault.name) {
              if (++fault.calls > 64) throw new Error('contained lookup did not stop retrying');
              if (fault.remaining > 0) {
                --fault.remaining; injectedErrno = fault.code; return -1;
              }
            }
            injectedErrno = 0;
            return actual(...arguments_);
          };
        } };
      },
    },
  });
  const held = api.openDirectory(inside);
  const refuse = (name, code) => {
    let unexpected;
    try { assert.throws(() => { unexpected = api.openBeneath(held, name, fs.constants.O_RDONLY); }, { code }); }
    finally { if (unexpected !== undefined) fs.closeSync(unexpected); }
  };
  try {
    fault = { name: 'data', code: 11, remaining: 2, calls: 0 };
    const file = api.openBeneath(held, 'data', fs.constants.O_RDONLY);
    try { assert.equal(fs.readFileSync(file, 'utf8'), 'contained bytes'); }
    finally { fs.closeSync(file); }
    assert.throws(() => fs.fstatSync(file), { code: 'EBADF' });
    for (const name of ['inside-link', 'escape/sentinel']) {
      fault = { name, code: 11, remaining: 2, calls: 0 };
      refuse(name, 'STORE_CORRUPT');
    }
    fault = { name: 'data', code: 11, remaining: Infinity, calls: 0 };
    refuse('data', 'EAGAIN');
    fault = { name: 'data', code: 13, remaining: 1, calls: 0 };
    refuse('data', 'EACCES');
    assert.equal(fs.readFileSync(join(outside, 'sentinel'), 'utf8'), 'outside untouched');
    assert.equal(fs.readFileSync(join(inside, 'data'), 'utf8'), 'contained bytes');
  } finally { fs.closeSync(held); }
});
for (const file of ['apps/oma/src/runtime/personal-settings.ts', 'apps/oma/src/engine/settings-files.ts'])
  for (const failed of [false, true]) test(`Owned cleanup settings ${file}: ${failed ? 'read failure plus' : 'only'} writer close failure is not success`, t => {
    const root = fixture(t); let returned = 0, writes = 0;
    // fix/fp moved pi-runtime's lock+replace behind the shared lockedUserReplace
    // (src/runtime/locked-files.ts). The contract under test is unchanged, so
    // pi-runtime gets the real primitive loaded with the same controlled
    // internals instead of stubs it no longer calls.
    const internals = {
      '@oma/native/process-lock': { ProcessLock: { acquire: take, tryAcquire: take } },
      './user-files.js': { ensureUserDirectory() {}, ensureOwnedUserDirectory() {}, readUserFile() { if (failed) throw primary; return null; }, replaceUserFile() { writes++; } },
      './packages/index.js': { decodePackageIndex, readPackageIndex: () => [], reconciledEntries: entries => entries },
    };
    const locked = load('apps/oma/src/runtime/locked-files.ts', internals);
    const files = load('apps/oma/src/engine/settings-files.ts', { '../runtime/locked-files.js': locked,
      '../runtime/user-files.js': internals['./user-files.js'] }).engineSettingsFiles;
    const api = file.endsWith('personal-settings.ts') ? load(file, internals) : { engineSettingsFiles: files };
    function take() { return { assertHeld() {}, close() { returned++; throw secondary; } }; }
    assert.throws(() => file.endsWith('personal-settings.ts')
      ? api.updatePersonalSettings({ dataRoot: root, libdir: root, packages: root }) : api.engineSettingsFiles.withOwnedFile(root, 'settings.json', () => '{}\n'),
    error => failed ? both(error) : error === secondary);
    assert.equal(returned, 1); assert.equal(writes, failed ? 0 : 1);
  });
for (const failed of [false, true]) test(`Owned cleanup Keychain: controlled ${failed ? 'store failure plus' : 'only'} lock close failure retains exact outcome`, async () => {
  let returned = 0, writes = 0;
  const writer = load('packages/process/src/writer.ts', {
    '@oma/native/process-lock': { ProcessLock: { tryAcquire: () => ({ descriptor: 17, assertHeld() {}, close() { returned++; throw secondary; } }) } },
  });
  const api = load('apps/oma/src/runtime/keychain-credentials.ts', {
    './user-files.js': { ensureOwnedUserDirectory() {} },
    '@oma/process/writer': writer,
  });
  const store = { async get() { if (failed) throw primary; return '{}'; }, async put() { writes++; } };
  const credential = api.keychainCredentials(store, 'fixture-account', '/fixture/item.lock');
  await assert.rejects(credential.modify('fixture', () => ({ type: 'api_key', key: 'fixture-only' })), error => failed ? both(error) : error === secondary);
  assert.equal(returned, 1); assert.equal(writes, failed ? 0 : 1);
});
