/** The actual login/package launcher at controlled child events; no credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(process.env.OMA_LOGIN_SOURCE ?? new URL('../src/login.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function world({ spawnError, directoryError } = {}) {
  const child = new EventEmitter(), launches = [], directories = [];
  const deps = {
    './pi-runtime.js': { PI_AGENT_DIR_ENV: 'PI_CODING_AGENT_DIR',
      resolvePiRuntime: () => ({ executable: '/fixture/node', args: ['engine.js'], agentDir: '/fixture/engine' }),
      piIsolationEnv: () => ({ PI_CODING_AGENT_DIR: '/fixture/engine', PI_CODING_AGENT_SESSION_DIR: '/fixture/history' }) },
    "@oma/process/async": { spawnInteractive(...args) { if (spawnError) throw spawnError; launches.push(args); return child; } },
    '../user-files.js': { ensureOwnedUserDirectory(target) { directories.push(target); if (directoryError) throw directoryError; } },
    'node:path': path, '@oma/domain/deployment': { DEPLOYMENT_LAYOUT: { settingsPreload: 'apps/oma/dist/entry/pi-settings-preload.js' } },
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  const options = { stateRoot: '/fixture/data/demo', libdir: '/fixture/install', fence: 17,
    env: { HOME: '/fixture/home', PATH: '/usr/bin', PI_CODING_AGENT_DIR: '/outside', PI_CODING_AGENT_EXTRA: 'outside' } };
  return { ...module.exports, directory: { ensureOwnedDirectory: deps['../user-files.js'].ensureOwnedUserDirectory }, child, launches, directories, options };
}
for (const packages of [false, true]) {
  const label = packages ? 'package' : 'login';
  for (const event of ['exit', 'error', 'disconnect']) test(`engine ${label}: ${event} alone does not finish or release the caller`, async () => {
    const w = world(); let returned = false;
    const done = w.runEngineLogin(w.directory, { ...w.options, ...(packages ? { packages: { store: '/fixture/packages', args: ['update', 'npm:x'] } } : {}) })
      .then(value => { returned = true; return value; });
    if (event === 'error') w.child.emit(event, new Error('fixture child error'));
    else w.child.emit(event, 0, null);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(returned, false);
    w.child.emit('close', 0, null);
    assert.equal(await done, event === 'error' ? 1 : 0);
  });
  test(`engine ${label}: the explicit store, arguments, environment and fence belong to this invocation`, async () => {
    const w = world(), done = w.runEngineLogin(w.directory, { ...w.options,
      ...(packages ? { packages: { store: '/fixture/packages', args: ['install', 'npm:x'] } } : {}) });
    const [executable, argv, cwd, env, fence] = w.launches[0];
    assert.equal(executable, '/fixture/node');
    assert.deepEqual(Array.from(argv), packages ? ['engine.js', 'install', 'npm:x'] : ['engine.js']);
    assert.equal(cwd, packages ? '/fixture/packages' : '/fixture/engine');
    assert.deepEqual(w.directories, [cwd]);
    assert.equal(env.PI_CODING_AGENT_DIR, cwd); assert.equal(env.PI_CODING_AGENT_EXTRA, undefined);
    assert.equal(env.HOME, '/fixture/home'); assert.equal(fence, 17);
    w.child.emit('close', 0, null); assert.equal(await done, 0);
  });
}
for (const [code, signal, expected] of [[7, null, 7], [null, 'SIGTERM', 1], [null, null, 1]])
  test(`engine close: ${code}/${signal} is not a successful package change`, async () => {
    const w = world(), done = w.runEngineLogin(w.directory, w.options);
    w.child.emit('close', code, signal); assert.equal(await done, expected);
  });
for (const packages of [false, true]) test(`engine ${packages ? 'package' : 'login'}: metadata preparation failure cannot spawn a child`, async () => {
  const problem = new Error('fixture directory refused'), w = world({ directoryError: problem });
  // NB-09: the failure is a rejection of the declared Promise<number>, never
  // a synchronous throw.
  await assert.rejects(() => w.runEngineLogin(w.directory, { ...w.options,
    ...(packages ? { packages: { store: '/fixture/packages', args: ['install', 'npm:x'] } } : {}) }), error => error === problem);
  assert.deepEqual(w.directories, [packages ? '/fixture/packages' : '/fixture/engine']); assert.equal(w.launches.length, 0);
});
test('engine spawn: refusal creates no child owner', async () => {
  const problem = new Error('fixture spawn refusal'), w = world({ spawnError: problem });
  await assert.rejects(() => w.runEngineLogin(w.directory, w.options), error => error === problem); assert.equal(w.launches.length, 0);
});
