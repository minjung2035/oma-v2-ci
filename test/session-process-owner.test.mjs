/** Actual process-owner source with a controlled native spawn; no process is started. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { deadline } from "@oma/process/deadline";

const code = ts.transpileModule(readFileSync(process.env.OMA_ASYNC_PROCESS_SOURCE ?? "packages/process/src/async.ts", 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, inheritedFence, fencedStdio } from "@oma/process/fence";

function world() {
  const calls = [], child = {};
  class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const deps = {
    'node:child_process': { spawn(...args) { calls.push(args); return child; } },
    'node:perf_hooks': { performance: { now: () => 0 } }, './command.js': {}, '@oma/domain/errors': { StoreError },
    './deadline.js': { deadline },
    // The output-spool import is real; no spec in this harness names a spool
    // path, so opening or writing one is a harness bug, not a code path.
    'node:fs': { constants: { O_WRONLY: 1, O_CREAT: 64, O_TRUNC: 512, O_NOFOLLOW: 256, O_RDONLY: 0 },
      openSync() { throw new Error('no spool path was declared in this harness'); },
      closeSync() {}, writeSync() { throw new Error('no spool path was declared in this harness'); } },
    "./fence.js": { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, inheritedFence, fencedStdio },
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports,
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  return { ...module.exports, calls, child };
}
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
