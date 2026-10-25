/** Platform-injected settings preparation only: no engine, credential or VM. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import { ProcessLock } from "@oma/native/process-lock";

// The engine package is ESM-only: a CommonJS require inside the harness cannot
// resolve it, so the real module is imported here and handed to the sandboxed
// bridge -- its semantics stay the engine's own, only the resolution is the test's.
const piPackage = await import('@earendil-works/pi-coding-agent');
const require = createRequire(import.meta.url);
function load(file, platform, replacements = {}) {
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(resolve(file)).href));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports, Buffer,
    process: { platform }, require(name) {
      if (Object.hasOwn(replacements, name)) return replacements[name];
      return require(name.startsWith('.') ? resolve((file.startsWith('packages/') || file.startsWith('apps/oma/')) ? dirname(file).replace('/src', '/dist') : 'dist/' + dirname(file), name) : name);
    } });
  return module.exports;
}
function fixture(t, platform, transform = value => value) {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-engine-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const metadata = transform(load('apps/oma/src/runtime/user-files.ts', platform));
  // The locked writer keeps the same seam: its imports of the file metadata
  // are what the transform wraps, not the module's own internals.
  const locked = load('apps/oma/src/runtime/locked-files.ts', platform, { './user-files.js': metadata });
  // The settings bridge is part of the platform surface under test: it is
  // transpiled with the same fake platform and the same file metadata so a
  // darwin assertion is not silently satisfied by the host's linux branch.
  const files = load('apps/oma/src/engine/settings-files.ts', platform,
    { '../runtime/locked-files.js': locked, '../runtime/user-files.js': metadata }).engineSettingsFiles;
  const bridge = load('packages/engine/src/pi-compat/settings.ts', platform,
    { '@earendil-works/pi-coding-agent': piPackage });
  const runtime = load('packages/engine/src/pi-runtime.ts', platform);
  const presentation = load('packages/engine/src/pi-presentation.ts', platform,
    { "@oma/engine": runtime, './pi-compat/settings.js': bridge });
  const api = { ...runtime, preparePiRetry: dir => runtime.preparePiRetry(files, dir),
    preparePiInteractive: dir => presentation.preparePiInteractive(files, dir) };
  return { root, api, path: join(root, 'settings.json'), metadata };
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const released = root => {
  const lock = ProcessLock.tryAcquire(join(root, 'oma-settings.lock'));
  assert.ok(lock, 'settings writer lock returned'); lock.close();
};
for (const platform of ['linux', 'darwin']) {
  test(`engine settings ${platform}: the engine directory belongs to the existing host layout`, t => {
    const { api, root } = fixture(t, platform);
    assert.equal(api.piAgentDir(join(root, 'personal')), join(root, platform === 'darwin' ? 'engine' : '.engine'));
  });
  test(`engine settings ${platform}: defaults, choices, one retry owner and repeatable preparation`, t => {
    const w = fixture(t, platform), { api, root, path } = w;
    fs.writeFileSync(path, JSON.stringify({ theme: 'dark', hideThinkingBlock: false, defaultModel: 'fixture',
      retry: { maxRetries: 99, baseDelayMs: 50, maxAgentDelayMs: 200, provider: { maxRetries: 9, timeoutMs: 321 } } }));
    api.preparePiRetry(root); api.preparePiInteractive(root);
    const result = json(path);
    assert.equal(result.theme, 'dark'); assert.equal(result.hideThinkingBlock, false); assert.equal(result.defaultModel, 'fixture');
    assert.deepEqual(result.retry, { enabled: true, maxRetries: 5, baseDelayMs: 50, maxAgentDelayMs: 200,
      provider: { maxRetries: 0, timeoutMs: 321 } });
    assert.equal(json(join(root, 'open-tui.json')).telemetry.enabled, false);
    const before = fs.readFileSync(path, 'utf8'); api.preparePiRetry(root); api.preparePiInteractive(root);
    assert.equal(fs.readFileSync(path, 'utf8'), before); released(root);
    fs.rmSync(path); api.preparePiRetry(root);
    assert.deepEqual(json(path).retry, { enabled: true, maxRetries: 5, baseDelayMs: 1000, maxAgentDelayMs: 8000,
      provider: { maxRetries: 0 } });
  });
  test(`engine settings ${platform}: invalid bytes are preserved and the writer is returned`, t => {
    const { api, root, path } = fixture(t, platform);
    for (const bytes of ['{', 'null', '[]', '{"retry":[]}', '{"retry":{"provider":null}}', Buffer.from([255]), ' '.repeat(1048577)]) {
      fs.writeFileSync(path, bytes);
      assert.throws(() => api.preparePiRetry(root));
      assert.deepEqual(fs.readFileSync(path), Buffer.from(bytes)); released(root);
    }
  });
  for (const [kind, link] of [['symlink', fs.symlinkSync], ['hardlink', fs.linkSync]]) {
    test(`engine settings ${platform}: ${kind} is refused without changing the other name`, t => {
      const { api, root, path } = fixture(t, platform), target = join(root, 'other.json');
      fs.writeFileSync(target, '{}'); link(target, path);
      assert.throws(() => api.preparePiRetry(root));
      assert.equal(fs.readFileSync(path, 'utf8'), '{}'); assert.equal(fs.readFileSync(target, 'utf8'), '{}'); released(root);
    });
  }
  test(`engine settings ${platform}: every interactive settings file enforces its own single name`, t => {
    const { api, root } = fixture(t, platform);
    for (const name of ['themes/oma.json', 'settings.json', 'keybindings.json', 'open-tui.json']) {
      const dir = join(root, name.replaceAll('/', '-')), target = join(dir, 'other.json'), settings = join(dir, name);
      fs.mkdirSync(dirname(settings), { recursive: true }); fs.writeFileSync(target, '{}'); fs.linkSync(target, settings);
      assert.throws(() => api.preparePiInteractive(dir), { code: 'UNSUPPORTED_PROFILE' }, name);
      assert.equal(fs.readFileSync(settings, 'utf8'), '{}'); assert.equal(fs.readFileSync(target, 'utf8'), '{}');
      released(dirname(settings));
    }
  });
  test(`engine settings ${platform}: lock contention preserves settings until its owner returns`, t => {
    const { api, root, path } = fixture(t, platform); fs.writeFileSync(path, '{"theme":"light"}');
    const lock = ProcessLock.acquire(join(root, 'oma-settings.lock'));
    try {
      assert.throws(() => api.preparePiRetry(root), { code: 'BROKER_UNAVAILABLE' });
      assert.equal(fs.readFileSync(path, 'utf8'), '{"theme":"light"}');
    } finally { lock.close(); }
    api.preparePiRetry(root); assert.equal(json(path).theme, 'light'); released(root);
  });
}
for (const platform of ['linux', 'darwin']) test(`engine settings ${platform}: read IO is not defaults and releases the lock`, t => {
  const problem = Object.assign(new Error('injected read'), { code: 'EIO' }); let armed = true;
  const { api, root, path } = fixture(t, platform, metadata => ({ ...metadata, readUserFile(...args) {
    if (armed) { armed = false; throw problem; } return metadata.readUserFile(...args);
  } }));
  fs.writeFileSync(path, '{"theme":"light"}');
  assert.throws(() => api.preparePiRetry(root), error => error === problem);
  assert.equal(fs.readFileSync(path, 'utf8'), '{"theme":"light"}'); released(root);
  api.preparePiRetry(root); assert.equal(json(path).theme, 'light');
});
for (const platform of ['linux', 'darwin']) for (const after of [false, true])
  test(`engine settings ${platform}: ${after ? 'visible' : 'pre-replace'} failure is retried from saved bytes`, t => {
    const problem = Object.assign(new Error('injected replacement'), { code: 'EIO' }); let armed = true, writes = 0;
    const { api, root, path } = fixture(t, platform, metadata => ({ ...metadata, replaceUserFile(...args) {
      writes++;
      if (armed) { armed = false; if (after) metadata.replaceUserFile(...args); throw problem; }
      return metadata.replaceUserFile(...args);
    } }));
    fs.writeFileSync(path, '{"theme":"light"}');
    assert.throws(() => api.preparePiRetry(root), error => error === problem); released(root);
    assert.equal(json(path).retry?.maxRetries, after ? 5 : undefined);
    api.preparePiRetry(root); assert.equal(json(path).theme, 'light'); assert.equal(json(path).retry.maxRetries, 5);
    assert.equal(writes, after ? 1 : 2, 'visible commit is not replayed'); released(root);
  });
