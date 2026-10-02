/** Actual process-owner source with a controlled native spawn; no process is started. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(process.env.OMA_ASYNC_PROCESS_SOURCE ?? 'src/process/async.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function world() {
  const calls = [], child = {};
  class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const deps = {
    'node:child_process': { spawn(...args) { calls.push(args); return child; } },
    'node:perf_hooks': { performance: { now: () => 0 } }, './command.js': {}, '../domain/errors.js': { StoreError },
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  return { ...module.exports, calls, child };
}
test('Guest terminal process: host-new request pipe is separate from screen and Society authority', () => {
  const w = world(); w.spawnInTerminal('/fixture/node', [], '/fixture/cwd', {}, 73);
  const [executable, argv, options] = w.calls[0];
  assert.equal(executable, '/usr/bin/setsid'); assert.deepEqual(Array.from(argv), ['--ctty', '--', '/fixture/node']);
  assert.deepEqual(Array.from(options.stdio), [73, 73, 'inherit', 'pipe']);
  assert.equal(options.shell, false); assert.equal(options.detached, undefined);
});
test('Human session process: terminal, history lock and IPC have fixed separate descriptors', () => {
  const w = world(), argv = ['--fixture'], env = { HOME: '/fixture/home' };
  assert.equal(w.spawnSessionInteractive('/fixture/node', argv, '/fixture/cwd', env, 73), w.child);
  argv[0] = 'changed'; env.HOME = 'changed';
  const [executable, savedArgv, options] = w.calls[0];
  assert.equal(executable, '/fixture/node'); assert.deepEqual(Array.from(savedArgv), ['--fixture']);
  assert.equal(options.cwd, '/fixture/cwd'); assert.equal(options.env.HOME, '/fixture/home');
  assert.equal(options.shell, false); assert.equal(options.detached, undefined);
  assert.deepEqual(Array.from(options.stdio), ['inherit', 'inherit', 'inherit', 73, 'ipc']);
});
for (const descriptor of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined])
  test(`Human session process: invalid history descriptor ${descriptor} refuses before spawn`, () => {
    const w = world();
    assert.throws(() => w.spawnSessionInteractive('/fixture/node', [], '/fixture/cwd', {}, descriptor), { code: 'UNSUPPORTED_PROFILE' });
    assert.equal(w.calls.length, 0);
  });
for (const [executable, argv, cwd, env] of [
  ['node', [], '/fixture', {}], ['/fixture/node', ['bad\0arg'], '/fixture', {}],
  ['/fixture/node', [], 'relative', {}], ['/fixture/node', [], '/fixture', { HOME: undefined }],
  ['/fixture/node', [], '/fixture', { HOME: 'bad\0value' }],
]) test(`Human session process: direct-spawn validation rejects ${JSON.stringify([executable, argv, cwd, env])}`, () => {
  const w = world();
  assert.throws(() => w.spawnSessionInteractive(executable, argv, cwd, env, 73), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(w.calls.length, 0);
});
