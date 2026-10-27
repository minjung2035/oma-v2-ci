import * as restartPolicy from "@oma/process/restart-policy";
import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
// DR27/P0-4: production supervision over fake children, private channels and time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync('apps/oma/src/runtime/broker-supervisor.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
async function world() {
  const children = [], timers = new Set(), readers = [], messages = [];
  const module = { exports: {} };
  const dependencies = {
    "@oma/process/restart-policy": restartPolicy,
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

    'node:path': { join: (...parts) => parts.join('/') },
    '@oma/client/connection': { endpointListening: async () => false },
    "@oma/native/process-lock": { SOCIETY_OWNED_EXIT: 73 },
    './assets.js': { launchLocationArgv: () => [] },
    '@oma/protocol/host-channel': {
      HOST_CHANNEL_ENV: 'CHANNEL', HOST_CHANNEL_FD: 3,
      HostChannelReader: class { constructor(accept) { this.accept = accept; readers.push(this); } push() {} },
      encodeHostMessage: value => JSON.stringify(value),
    },
    "@oma/process/async": {
      SOCIETY_FENCE_ENV: 'FENCE', SOCIETY_FENCE_FD: 4,
      spawnSupervisedService() {
        const channel = Object.assign(new EventEmitter(), { write() { return true; } });
        const child = Object.assign(new EventEmitter(), { pid: 100 + children.length, exitCode: null, signalCode: null,
          stdio: [null, null, null, channel], stderr: null, kills: [], kill(signal) { this.kills.push(signal); return true; } });
        children.push(child); return child;
      },
    },
  };
  new Script(code).runInNewContext({ module, exports: module.exports, process: { env: {} }, performance: { now: () => 0 },
    setTimeout(run, ms) { const timer = { run, ms, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(dependencies, name)) return sessionHandoffMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(dependencies, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(dependencies, name)) return deploymentMeaning;
 assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  const handle = await module.exports.superviseBroker({ node: 'fake', libdir: '/fake', society: 'demo', stateRoot: '/state', runRoot: '/run', configPath: '/config', onEvent: message => messages.push(message) });
  return { handle, children, timers, readers, messages,
    exit(index = 0) { const child = children[index]; child.exitCode = 1; child.emit('exit', 1, null); },
    tick() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
  };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function completed(promise) {
  let outcome;
  promise.then(value => { outcome = { value }; }, error => { outcome = { error }; });
  await flush();
  assert.ok(outcome, 'the observed event did not settle its owner');
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

test('broker owner: a crashed child can restart and report readiness normally', async () => {
  const w = await world(); let ready = 0; w.handle.onReady(() => ready++);
  w.readers[0].accept({ kind: 'ready' }); assert.equal(ready, 1);
  w.exit(); assert.equal(w.timers.size, 1); w.tick(); assert.equal(w.children.length, 2);
  w.readers[1].accept({ kind: 'ready' }); assert.equal(ready, 2);
  const stopping = w.handle.stop(); w.exit(1); await completed(stopping);
});
test('broker owner: stop returns the pending restart timer and fences its callback', async () => {
  const w = await world(); w.exit(); const old = [...w.timers][0];
  await completed(w.handle.stop()); assert.equal(w.timers.size, 0, 'ended supervisor retained its restart timer');
  old.run(); assert.equal(w.children.length, 1);
});
test('broker owner: every concurrent stop waits for the same actual child exit', async () => {
  const w = await world(); let firstDone = false, secondDone = false;
  const first = w.handle.stop().then(() => { firstDone = true; });
  const second = w.handle.stop().then(() => { secondDone = true; });
  await flush(); assert.equal(firstDone, false); assert.equal(secondDone, false, 'second stop mistook the stop request for death');
  assert.deepEqual(w.children[0].kills, ['SIGTERM']);
  w.exit(); await completed(Promise.all([first, second])); assert.equal(firstDone, true); assert.equal(secondDone, true);
});
test('broker owner: stop settles registration and returns its timer before actual exit', async () => {
  const w = await world(); w.readers[0].accept({ kind: 'ready' }); let value;
  const registered = w.handle.register('session-a', 200).then(result => { value = result; });
  const stopping = w.handle.stop(); await flush();
  assert.equal(value, null, 'registration outlived the authority that requested it'); assert.equal(w.timers.size, 0);
  w.readers[0].accept({ kind: 'credential', sessionHandle: 'session-a', credential: 'fake' });
  w.exit(); await completed(Promise.all([registered, stopping])); assert.equal(value, null);
});
test('broker owner: superseding and answered registration return their timers', async () => {
  const w = await world(); w.readers[0].accept({ kind: 'ready' });
  const first = w.handle.register('first', 200), second = w.handle.register('second', 201);
  assert.equal(await completed(first), null); assert.equal(w.timers.size, 1);
  w.readers[0].accept({ kind: 'credential', sessionHandle: 'first', credential: 'old' });
  w.readers[0].accept({ kind: 'credential', sessionHandle: 'second', credential: 'new' });
  assert.equal(await completed(second), 'new'); assert.equal(w.timers.size, 0);
  const stopping = w.handle.stop(); w.exit(); await completed(stopping);
});

test('broker owner: an already-consumed restart callback cannot start another generation', async () => {
  const w = await world(); w.exit(); const old = [...w.timers][0]; w.tick();
  assert.equal(w.children.length, 2);
  old.run(); assert.equal(w.children.length, 2, 'old restart callback acquired a second child');
  const stopping = w.handle.stop(); w.exit(1); await completed(stopping);
});
test('broker owner: a failed registration write returns its timer and permits a later request', async () => {
  const w = await world(); w.readers[0].accept({ kind: 'ready' });
  const channel = w.children[0].stdio[3], write = channel.write;
  channel.write = () => { throw new Error('injected channel write failure'); };
  assert.equal(await completed(w.handle.register('failed', 200)), null);
  assert.equal(w.timers.size, 0);
  channel.write = write;
  const next = w.handle.register('next', 201);
  w.readers[0].accept({ kind: 'credential', sessionHandle: 'failed', credential: 'old' });
  w.readers[0].accept({ kind: 'credential', sessionHandle: 'next', credential: 'new' });
  assert.equal(await completed(next), 'new'); assert.equal(w.timers.size, 0);
  const stopping = w.handle.stop(); w.exit(); await completed(stopping);
});
test('broker owner: death returns a registration and old readiness cannot authorize its successor', async () => {
  const w = await world(); let ready = 0; w.handle.onReady(() => ready++);
  w.readers[0].accept({ kind: 'ready' }); assert.equal(ready, 1);
  const registered = w.handle.register('old', 200); w.exit();
  assert.equal(await completed(registered), null); assert.equal(w.timers.size, 1);
  w.tick(); w.readers[0].accept({ kind: 'ready' });
  assert.equal(ready, 1, 'old generation notified readiness for its successor');
  assert.equal(await completed(w.handle.register('next', 201)), null);
  const stopping = w.handle.stop();
  w.readers[1].accept({ kind: 'ready' });
  assert.equal(ready, 1, 'a stopped owner notified readiness');
  assert.equal(await completed(w.handle.register('stopped', 202)), null);
  assert.equal(w.timers.size, 0); w.exit(1); await completed(stopping);
});
