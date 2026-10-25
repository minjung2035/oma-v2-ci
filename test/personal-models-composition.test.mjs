/** Mac Personal credential wiring at controlled boundaries; no Keychain, VM or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
const source = ts.transpileModule(readFileSync('apps/oma/src/runtime/personal-models.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function world({ platform = 'darwin', marker = '1', launchError, listError, createError, closeError } = {}) {
  const calls = [], model = {}, credentials = { async list() { calls.push(['list']); if (listError) throw listError; return []; } };
  const client = { async close() { calls.push(['close']); if (closeError) throw closeError; } };
  const deps = {
    'node:path': path, '@oma/domain/errors': { StoreError },
    '@oma/platform-mac/keychain-client': { KeychainClient: { async launch(libdir) {
      calls.push(['launch', libdir]); if (launchError) throw launchError; return client;
    } } },
    './keychain-credentials.js': { keychainCredentials(...args) { calls.push(['credentials', ...args]); return credentials; } },
    '@oma/engine/engine-auth': { async createEngineModelRuntime(agentDir, credentials) {
      const options = { credentials, modelsPath: path.join(agentDir, 'models.json'), allowModelNetwork: false };
      calls.push(['models', options]); if (createError) throw createError; return model;
    } },
  };
  const module = { exports: {} };
  new Script(source).runInNewContext({ module, exports: module.exports, process: { platform, env: { OMA_PERSONAL_KEYCHAIN: marker } },
    require(name) { assert.ok(Object.hasOwn(deps, name), name); if (name !== 'node:path' && name !== '@oma/domain/errors' && name !== '@oma/engine/engine-auth') calls.push(['import', name]); return deps[name]; } });
  return { ...module.exports, calls, model, credentials, client };
}
test('Personal models: Linux never loads host Keychain or a second model runtime', async () => {
  const w = world({ platform: 'linux' }); assert.equal(await w.personalModels('/lib', '/engine'), undefined);
  assert.deepEqual(w.calls, []);
});
for (const marker of ['', '0', 'true']) test(`Personal models: invalid host marker ${JSON.stringify(marker)} fails before helper acquisition`, async () => {
  const w = world({ marker }); await assert.rejects(w.personalModels('/lib', '/engine'), { code: 'INVALID_REQUEST' });
  assert.deepEqual(w.calls, []);
});
test('Personal models: existing engine models and one Keychain writer owner, without model discovery network', async () => {
  const w = world(), owned = await w.personalModels('/bundle/Resources/install', '/host/engine');
  assert.equal(owned.modelRuntime, w.model);
  const credential = w.calls.find(item => item[0] === 'credentials');
  assert.equal(credential[1], w.client); assert.equal(credential[2], 'engine-managed'); assert.equal(credential[3], '/host/engine/oma-credentials.lock');
  const options = w.calls.find(item => item[0] === 'models')[1];
  assert.equal(options.credentials, w.credentials); assert.equal(options.modelsPath, '/host/engine/models.json'); assert.equal(options.allowModelNetwork, false);
  assert.ok(w.calls.findIndex(item => item[0] === 'list') < w.calls.findIndex(item => item[0] === 'models'));
  assert.equal(w.calls.some(item => item[0] === 'close'), false); await owned.close();
  assert.equal(w.calls.filter(item => item[0] === 'close').length, 1);
});
for (const stage of ['launch', 'list', 'create']) test(`Personal models: ${stage} failure returns only resources acquired, with no alternative credentials`, async () => {
  const problem = new StoreError('BROKER_UNAVAILABLE', 'fixture failure'), w = world({ [`${stage}Error`]: problem });
  await assert.rejects(w.personalModels('/lib', '/engine'), error => error === problem);
  assert.equal(w.calls.filter(item => item[0] === 'close').length, stage === 'launch' ? 0 : 1);
  if (stage !== 'create') assert.equal(w.calls.some(item => item[0] === 'models'), false);
});
test('Personal models: setup and cleanup failures both remain visible', async () => {
  const problem = new Error('fixture model setup'), cleanup = new Error('fixture close'), w = world({ createError: problem, closeError: cleanup });
  await assert.rejects(w.personalModels('/lib', '/engine'), error => error.name === 'AggregateError' && error.errors[0] === problem && error.errors[1] === cleanup);
});
