/** Actual process-owner source with a controlled native spawn; no process is started. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, fstatSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { deadline } from '../dist/src/process/deadline.js';

const code = ts.transpileModule(readFileSync(process.env.OMA_ASYNC_PROCESS_SOURCE ?? 'src/process/async.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
// The w10 client move gave async.ts a '../client/fence.js' import. The mock
// below is the real fence.ts port: same constants, same slot layout, the same
// validation, with fstatSync bound to the real syscall.
const SOCIETY_FENCE_ENV = 'OMA_SOCIETY_FENCE_FD', SOCIETY_FENCE_FD = 4;
function inheritedFence(env = process.env) {
  const declared = env[SOCIETY_FENCE_ENV];
  if (declared === undefined) return undefined;
  if (!/^[0-9]{1,4}$/.test(declared)) throw new Error(`${SOCIETY_FENCE_ENV} is not a descriptor number`);
  const fd = Number(declared);
  let kind;
  try { kind = fstatSync(fd); }
  catch { throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not open`); }
  if (!kind.isSocket()) throw new Error(`${SOCIETY_FENCE_ENV} names descriptor ${fd}, which is not the society lease`);
  return fd;
}
function fencedStdio(base, channel, fence) {
  if (fence === undefined) return channel === 'pipe' ? [...base, channel] : [...base];
  const stdio = [...base];
  while (stdio.length < SOCIETY_FENCE_FD - 1) stdio.push('ignore');
  stdio.push(channel, fence);
  return stdio;
}
function world() {
  const calls = [], child = {};
  class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const deps = {
    'node:child_process': { spawn(...args) { calls.push(args); return child; } },
    'node:perf_hooks': { performance: { now: () => 0 } }, './command.js': {}, '../domain/errors.js': { StoreError },
    './deadline.js': { deadline },
    // The output-spool import is real; no spec in this harness names a spool
    // path, so opening or writing one is a harness bug, not a code path.
    'node:fs': { constants: { O_WRONLY: 1, O_CREAT: 64, O_TRUNC: 512, O_NOFOLLOW: 256, O_RDONLY: 0 },
      openSync() { throw new Error('no spool path was declared in this harness'); },
      closeSync() {}, writeSync() { throw new Error('no spool path was declared in this harness'); } },
    '../client/fence.js': { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, inheritedFence, fencedStdio },
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
