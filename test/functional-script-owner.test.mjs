import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL('../scripts/functional-surface.mjs', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/^#!.*\n/, '').replaceAll('import.meta.dirname', '"/repo/scripts"').replaceAll('import.meta.url', '"file:///repo/scripts/functional-surface.mjs"');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function world(failure) {
  const events = [], timers = new Set(); let childClosed = false;
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  const listeners = new Set();
  const process = { env: {}, exitCode: undefined };
  const stop = () => {
    events.push('kill');
    if (failure !== 'unconfirmed') { childClosed = true; child.signalCode = 'SIGKILL'; child.emit('close'); }
  };
  const dependencies = {
    'node:fs': { mkdirSync() {}, mkdtempSync: () => '/scratch', writeFileSync() {},
      readFileSync: () => JSON.stringify({ phase: 'expanded', active: ['read', 'oma_group_probe', 'oma_mail_read', 'oma_mail_send', 'oma_mail_ack', 'oma_status', ...(events.includes('opened') ? ['grep'] : [])] }),
      rmSync() { assert.equal(childClosed, true, 'workdir removed before child death'); events.push('remove'); } },
    'node:os': { tmpdir: () => '/tmp' }, 'node:path': path,
    "@oma/domain/tool-surface": { planToolSurface: value => value, encodeToolSurfacePlan: () => 'plan' },
    '@oma/engine/pi-runtime': { resolvePiRuntime: () => ({ executable: '/node', args: ['/engine'] }), piAgentDir: () => '/engine-home' },
    "@oma/process/async": { spawnOwnedRpc: () => { events.push('spawn'); return child; }, stopOwnedChild: stop },
    './bounded-script.mjs': { enterBoundedScript: async () => true },
    '@oma/engine/pi-rpc': { PiRpcClient: class {
      constructor() { if (failure === 'constructor') throw new Error('injected constructor'); }
      onEvent(handler) { listeners.add(handler); return () => { listeners.delete(handler); events.push('unsubscribe'); }; }
      async send(event) {
        if (failure === 'send') throw new Error('injected send');
        if (event.id === 'probe') for (const handler of [...listeners]) handler({ type: 'response', id: 'probe', success: true });
        else events.push('opened');
      }
      close() { events.push('rpc-close'); listeners.clear(); stop(); }
    } },
  };
  const setTimeout = (action, ms) => {
    const timer = { action, ms }; timers.add(timer);
    if (ms !== 25000) queueMicrotask(() => { if (timers.has(timer)) { timers.delete(timer); action(); } });
    return timer;
  };
  const clearTimeout = timer => timers.delete(timer);
  const logs = [];
  await new AsyncFunction('require', 'exports', 'process', 'setTimeout', 'clearTimeout', 'console', compiled)(
    name => { assert.ok(dependencies[name], name); return dependencies[name]; }, {}, process, setTimeout, clearTimeout,
    { log: value => logs.push(value), error: value => logs.push(value) });
  return { events, timers, process, logs };
}

for (const failure of [undefined, 'constructor', 'send']) test(`AV-31: surface ${failure ?? 'success'} stops and observes its child before workdir cleanup`, async () => {
  const w = await world(failure);
  assert.ok(w.events.includes('kill'));
  assert.equal(w.events.at(-1), 'remove');
  assert.equal(w.timers.size, 0);
  assert.equal(w.process.exitCode ?? 0, failure ? 1 : 0);
});

test('AV-31: surface preserves artifacts and reports failure when termination is unconfirmed', async () => {
  const w = await world('unconfirmed');
  assert.equal(w.events.includes('remove'), false);
  assert.equal(w.process.exitCode, 1);
  assert.ok(w.logs.some(value => String(value).includes('termination is unconfirmed')));
  assert.equal(w.logs.some(value => String(value).includes('probe PASS')), false);
  assert.equal(w.timers.size, 0);
});
