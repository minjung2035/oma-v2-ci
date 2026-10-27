/** Controlled process/lock boundaries; no engine, provider, VM or user session. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { constants } from 'node:os';
import { Script } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('apps/oma/src/runtime/personal-session.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT'];
const options = { root: '/fixture/data/.personal/id', dataRoot: '/fixture/data', libdir: '/fixture/install', packages: '/fixture/packages' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
function world({ fault, spawnError, lockError, closeError, contended = false, platform = 'linux' } = {}) {
  const host = new EventEmitter(), child = new EventEmitter(), launches = [], operations = [];
  host.env = { HOME: '/fixture/home', PATH: '/usr/bin:/bin', OMA_ACTOR: 'principal', PI_SESSION: 'old', PI_OFFLINE: '1' };
  host.execPath = '/fixture/node'; host.platform = platform;
  child.exitCode = child.signalCode = null; child.signals = [];
  child.kill = signal => { child.signals.push(signal); return true; };
  child.finish = (code = 0, signal = null) => {
    child.exitCode = code; child.signalCode = signal;
    child.emit('exit', code, signal); child.emit('close', code, signal);
  };
  const lease = { descriptor: 73, closed: 0,
    assertHeld(name) { operations.push(['held', name]); if (lockError) throw lockError; },
    close() { this.closed++; operations.push(['release']); if (closeError) throw closeError; } };
  const spawn = (...args) => { launches.push(args); operations.push(['spawn']); if (spawnError) throw spawnError; return child; };
  const deps = {
    'node:path': path, 'node:crypto': { randomUUID: () => 'fixture-id' }, 'node:os': { constants },
    '@oma/domain/errors': { StoreError }, "@oma/process/host-loss": { HOST_LOSS_SIGNALS: signals },
    '@oma/domain/session-mode': { isSessionMode: value => value === 'personal' || value === 'society' },
    '@oma/domain/deployment': { DEPLOYMENT_LAYOUT: { interactiveToolsPreload: 'packages/engine/dist/pi-compat/interactive-tool-setup.js', entries: { personal: 'apps/oma/dist/entry/pi-personal.js' } } },
    "@oma/process/async": { spawnSessionInteractive: spawn, stopOwnedChild(value) { assert.equal(value, child); child.kill('SIGKILL'); } },
    '@oma/native/process-lock': { ProcessLock: { tryAcquire() { return contended ? null : lease; } } },
    './user-files.js': { ensureOwnedUserDirectory() {} },
    './session-mode.js': { readSessionBirth: () => ({ mode: 'personal', cwd: '/fixture/cwd', history: '/fixture/history' }) },
    '@oma/engine/pi-runtime': { PI_AGENT_DIR_ENV: 'PI_CODING_AGENT_DIR', resolvePiRuntime: () => ({ agentDir: '/fixture/engine' }) },
  };
  fault?.({ host, child, lease });
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, process: host,
    require(name) { assert.ok(Object.hasOwn(deps, name), `Personal must use its process owner, not ${name}`); return deps[name]; } });
  return { ...module.exports, host, child, lease, launches, operations };
}
function watch(promise) {
  const observation = { returned: false };
  observation.done = promise.then(value => { observation.returned = true; return value; }, error => { observation.returned = true; throw error; });
  return observation;
}
function released(w) {
  assert.equal(w.lease.closed, 1);
  for (const name of signals) assert.equal(w.host.listenerCount(name), 0, name);
}

test('Personal child: a mode handoff has one valid target and waits for actual writer exit', async () => {
  const w = world(), run = watch(w.runPersonalSession(options));
  for (const message of [{ type: 'switch', mode: 'invalid' }, { type: 'switch', mode: null },
    { type: 'switch', mode: 'society', session: '/fixture/history.jsonl' },
    { type: 'switch', mode: 'society', society: 'fixture' }]) w.child.emit('message', message);
  w.child.emit('message', { type: 'switch', mode: 'society' }); await flush();
  assert.equal(run.returned, false); assert.equal(w.lease.closed, 0);
  w.child.finish(); const ended = await run.done;
  assert.equal(ended.next.mode, 'society'); released(w);
});
test('Personal child: common process owner receives saved cwd, history descriptor and clean environment', async () => {
  const w = world(), run = w.runPersonalSession({ ...options, resume: '/fixture/history/saved.jsonl' });
  const [executable, argv, cwd, env, descriptor] = w.launches[0];
  assert.equal(executable, '/fixture/node'); assert.equal(cwd, '/fixture/cwd'); assert.equal(descriptor, 73);
  assert.deepEqual(Array.from(argv), ['--import', '/fixture/install/packages/engine/dist/pi-compat/interactive-tool-setup.js', '/fixture/install/apps/oma/dist/entry/pi-personal.js', '--root', options.root,
    '--data-root', options.dataRoot, '--libdir', options.libdir, '--packages', options.packages, '--resume', '/fixture/history/saved.jsonl']);
  assert.equal(env.HOME, '/fixture/home'); assert.equal(env.PATH, '/usr/bin:/bin'); assert.equal(env.PI_OFFLINE, '1');
  assert.equal(env.PI_CODING_AGENT_DIR, '/fixture/engine'); assert.equal(env.OMA_ACTOR, undefined); assert.equal(env.PI_SESSION, undefined);
  assert.equal(w.operations[0][0], 'held'); w.child.finish(); assert.equal((await run).code, 0); released(w);
});
for (const event of ['exit', 'disconnect', 'error']) test(`Personal child: ${event} does not release history or admit the next engine`, async () => {
  const w = world(), observed = watch(w.runPersonalSession(options));
  const refused = event === 'error' ? assert.rejects(observed.done, /injected child error/) : undefined;
  w.child.emit('message', { type: 'switch', session: '/fixture/next.jsonl' });
  if (event === 'error') w.child.emit(event, new Error('injected child error'));
  else w.child.emit(event, 0, null);
  await flush(); assert.equal(observed.returned, false); assert.equal(w.lease.closed, 0);
  w.child.finish();
  if (refused) await refused;
  else assert.equal((await observed.done).next.session, '/fixture/next.jsonl');
  released(w);
});
for (const [code, signal, status] of [[7, null, 7], [null, 'SIGTERM', 143], [null, null, 1]])
  test(`Personal child: close ${code}/${signal} cannot authorize a queued switch`, async () => {
    const w = world(), run = w.runPersonalSession(options);
    w.child.emit('message', { type: 'switch' }); w.child.finish(code, signal);
    const ended = await run; assert.equal(ended.code, status); assert.equal(ended.next, undefined); released(w);
  });
test('Personal child: only the first valid switch is accepted', async () => {
  const w = world(), run = w.runPersonalSession(options);
  for (const message of [null, [], { type: 'other' }, { type: 'switch', session: 42 }, { type: 'switch', extra: true }])
    w.child.emit('message', message);
  w.child.emit('message', { type: 'switch', session: '/fixture/first.jsonl' });
  w.child.emit('message', { type: 'switch', session: '/fixture/second.jsonl' });
  w.child.finish(); assert.equal((await run).next.session, '/fixture/first.jsonl'); released(w);
});
test('Personal child: a society switch is one target and never both', async () => {
  const w = world(), run = w.runPersonalSession(options);
  for (const message of [{ type: 'switch', session: '/fixture/x.jsonl', society: 'two-targets' }, { type: 'switch', society: 42 },
    { type: 'switch', society: 'named', extra: true }])
    w.child.emit('message', message);
  w.child.emit('message', { type: 'switch', society: 'fixture-society' });
  w.child.finish();
  const ended = await run;
  assert.equal(ended.next.society, 'fixture-society'); assert.equal(ended.next.session, undefined); released(w);
});
test('Personal child: a society switch on a failed exit is not a handoff', async () => {
  const w = world(), run = w.runPersonalSession(options);
  w.child.emit('message', { type: 'switch', society: 'fixture-society' });
  w.child.finish(1);
  assert.equal((await run).next, undefined); released(w);
});
test('Personal child: all host-loss signals forward while the history writer is alive', async () => {
  const w = world(), run = w.runPersonalSession(options);
  for (const name of signals) w.host.emit(name);
  assert.deepEqual(w.child.signals, signals); assert.equal(w.lease.closed, 0);
  w.child.finish(); await run; released(w);
});
for (const kind of ['throw', 'false']) test(`Personal child: signal ${kind} remains a failure until actual close`, async () => {
  const w = world({ fault({ child }) { child.kill = () => { if (kind === 'throw') throw new Error('injected signal'); return false; }; } });
  const observed = watch(w.runPersonalSession(options)), refused = assert.rejects(observed.done,
    kind === 'throw' ? /injected signal/ : { code: 'BROKER_UNAVAILABLE' });
  w.host.emit('SIGTERM'); await flush(); assert.equal(observed.returned, false); assert.equal(w.lease.closed, 0);
  w.child.finish(); await refused; released(w);
});
test('Personal child: a signal never targets a child whose exit is already observed', async () => {
  const w = world(), run = w.runPersonalSession(options);
  w.child.exitCode = 0; w.child.emit('exit', 0, null); w.host.emit('SIGTERM');
  assert.deepEqual(w.child.signals, []); assert.equal(w.lease.closed, 0);
  w.child.finish(); await run; released(w);
});
for (const kind of ['message', 'signal']) test(`Personal child: partial ${kind} listener acquisition requests cleanup but keeps the lease until close`, async () => {
  const problem = new Error('injected listener acquisition');
  const w = world({ fault({ child, host }) {
    const target = kind === 'message' ? child : host, on = target.on;
    target.on = function (name, listener) { on.call(this, name, listener); if (name === (kind === 'message' ? 'message' : 'SIGINT')) throw problem; return this; };
  } });
  const observed = watch(w.runPersonalSession(options)), refused = assert.rejects(observed.done, error => error === problem);
  await flush(); assert.deepEqual(w.child.signals, ['SIGKILL']); assert.equal(observed.returned, false); assert.equal(w.lease.closed, 0);
  w.child.finish(); await refused; released(w);
});
for (const kind of ['spawn', 'lock']) test(`Personal child: ${kind} failure before handoff releases its one lease`, async () => {
  const problem = new Error(`injected ${kind}`), w = world({ spawnError: kind === 'spawn' ? problem : undefined, lockError: kind === 'lock' ? problem : undefined });
  const run = w.runPersonalSession(options);
  if (w.launches.length > 0 && kind === 'lock') w.child.finish();
  await assert.rejects(run, error => error === problem); released(w);
  if (kind === 'lock') assert.equal(w.launches.length, 0);
});
test('Personal child: contention refuses before any child exists', async () => {
  const w = world({ contended: true });
  await assert.rejects(w.runPersonalSession(options), { code: 'BROKER_UNAVAILABLE' });
  assert.equal(w.launches.length, 0); assert.equal(w.lease.closed, 0);
});
test('Personal child: failed signal-listener return still attempts every listener and the lease', async () => {
  const problem = new Error('injected listener return');
  const w = world({ fault({ host }) { const off = host.off; host.off = function (name, listener) { off.call(this, name, listener); if (name === 'SIGTERM') throw problem; return this; }; } });
  const run = w.runPersonalSession(options), refused = assert.rejects(run, error => error === problem);
  w.child.finish(); await refused; released(w);
});
test('Personal child: primary spawn and lease cleanup failures are both retained', async () => {
  const primary = new Error('injected spawn'), cleanup = new Error('injected lease return'), w = world({ spawnError: primary, closeError: cleanup });
  await assert.rejects(w.runPersonalSession(options), error => error.name === 'AggregateError' && error.errors[0] === primary && error.errors[1] === cleanup);
  released(w);
});
test('Personal child: Mac credential marker is owned by this launch, not inherited', async () => {
  const w = world({ platform: 'darwin' }), run = w.runPersonalSession(options);
  assert.equal(w.launches[0][3].OMA_PERSONAL_KEYCHAIN, '1'); w.child.finish(); await run; released(w);
});
