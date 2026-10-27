/** Birth-only selection: real decoder and terminal, no engine or provider. */
import { test as nodeTest } from 'node:test';
const test = (name, run) => nodeTest(name, { timeout: 3000 }, run);
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Script } from 'node:vm';
import * as tui from '@earendil-works/pi-tui';
import ts from 'typescript';
import { workspaceSource } from './fixtures/workspace-source.mjs';

function world({ tty = true, columns = 80, rows = 24, fault } = {}) {
  const host = new EventEmitter(), input = new EventEmitter(), output = new EventEmitter();
  const raw = [], bytes = [], timers = new Set(); let pauses = 0, now = 0;
  Object.assign(input, { isTTY: tty, setRawMode(value) { raw.push(value); }, resume() {}, pause() { pauses++; } });
  Object.assign(output, { isTTY: tty, columns, rows, write(value) { bytes.push(value); return true; } });
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} }; cache.set(file, module.exports);
    new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports,
      Buffer, TextDecoder, process: host, performance: { now: () => now },
      setTimeout(run) { const timer = { run }; timers.add(timer); return timer; },
      clearTimeout(timer) { timers.delete(timer); },
      require(name) { return name === '@earendil-works/pi-tui' ? tui : load(name.startsWith('@oma/')
        ? workspaceSource(name) : resolve(dirname(file), name.replace(/\.js$/, '.ts'))); },
    });
    return module.exports;
  }
  const w = { host, input, output, raw, bytes, timers,
    get pauses() { return pauses; },
    advance() { now += 1000; },
    send(text) { input.emit('data', Buffer.from(text)); },
    tick() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
  };
  fault?.(w);
  const chooser = load('packages/tui/src/session-mode.ts');
  w.result = chooser.chooseSessionMode({ input, output });
  return w;
}
function returned(w) {
  assert.equal(w.raw.at(-1), false, 'raw mode returned');
  assert.equal(w.pauses, 1, 'one terminal return');
  assert.equal(w.timers.size, 0, 'pending key timer returned');
  for (const owner of [w.input, w.output, w.host]) assert.deepEqual(owner.eventNames(), [], 'listeners returned');
}
function failOnce(target, name, when = () => true) {
  const original = target[name], error = new Error(`injected ${name}`); let armed = true;
  target[name] = function (...args) {
    const result = original.apply(this, args);
    if (armed && when(...args)) { armed = false; throw error; }
    return result;
  };
  return error;
}
const contains = (error, expected) => error === expected || error?.errors?.some(e => contains(e, expected));

test('mode selector: non-TTY defaults without terminal or listeners', async () => {
  const w = world({ tty: false }); assert.equal(await w.result, 'society');
  assert.deepEqual(w.raw, []); assert.deepEqual(w.bytes, []); assert.equal(w.pauses, 0);
});
for (const [keys, expected] of [['\r', 'society'], ['\x1b[B\r', 'personal'], ['\x1b[A\r', 'personal'], ['\x1b[B\x1b[A\r', 'society']]) {
  test(`mode selector: ${JSON.stringify(keys)} selects ${expected}`, async () => {
    const w = world(); w.send(keys); assert.equal(await w.result, expected); returned(w);
  });
}
for (const [kind, act] of [
  ['escape', w => { w.send('\x1b'); w.tick(); }], ['interrupt', w => w.send('\x03')], ['eof key', w => w.send('\x04')],
  ['input end', w => w.input.emit('end')], ['input close', w => w.input.emit('close')], ['output close', w => w.output.emit('close')],
  ...['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].map(signal => [signal, w => w.host.emit(signal)]),
]) test(`mode selector: ${kind} cancels and returns the terminal`, async () => {
  const w = world(); let settled = false; void w.result.then(() => { settled = true; });
  act(w); await Promise.resolve(); assert.equal(settled, true, 'cancellation must settle, not hang');
  assert.equal(await w.result, null); returned(w);
});
test('mode selector: fragmented cursor key replaces timer and fences its stale callback', async () => {
  const w = world(); w.send('\x1b'); const old = [...w.timers][0];
  w.send('[B'); old.run(); w.send('\r');
  assert.equal(await w.result, 'personal'); returned(w);
});
test('mode selector: selection consumes no later key in the same read', async () => {
  const w = world(); let reads = 0;
  Object.defineProperty(w.output, 'columns', { get() { reads++; return 80; } });
  w.send('\r\x1b[B\r\x03');
  assert.equal(await w.result, 'society'); assert.equal(reads, 0, 'no display work after terminal return'); returned(w);
});
test('mode selector: cancellation owns even an already queued timer', async () => {
  const w = world(); w.send('\x1b'); const old = [...w.timers][0]; w.host.emit('SIGTERM');
  const count = w.bytes.length; old.run(); assert.equal(w.bytes.length, count);
  assert.equal(await w.result, null); returned(w);
});
test('mode selector: pasted keystrokes never select a mode', async () => {
  const w = world(); w.send('\x1b[200~\r\x1b[B\r\x1b[201~');
  assert.equal(w.raw.at(-1), true); w.advance(); w.send('\r'); assert.equal(await w.result, 'society'); returned(w);
});
for (const owner of ['input', 'output']) test(`mode selector: ${owner} failure rejects and returns all resources`, async () => {
  const w = world(), problem = new Error('stream failed');
  w[owner].emit('error', problem); await assert.rejects(w.result, error => error === problem); returned(w);
});
for (const [owner, method, when] of [['input', 'setRawMode'], ['output', 'write'], ['input', 'on'], ['host', 'on', name => name === 'SIGTERM']]) {
  test(`mode selector: acquisition failure at ${owner}.${method} returns partial ownership`, async () => {
    let problem; const w = world({ fault(w) { problem = failOnce(w[owner], method, when); } });
    await assert.rejects(w.result, error => contains(error, problem)); returned(w);
  });
}
for (const owner of ['input', 'output', 'host']) test(`mode selector: failed ${owner} listener return still restores terminal`, async () => {
  const w = world(), problem = failOnce(w[owner], 'off'); w.send('\r');
  await assert.rejects(w.result, error => contains(error, problem)); returned(w);
});
test('mode selector: resize write failure closes instead of escaping its listener', async () => {
  const w = world(); w.output.columns = 42;
  const problem = failOnce(w.output, 'write');
  assert.doesNotThrow(() => w.output.emit('resize'));
  await assert.rejects(w.result, error => contains(error, problem)); returned(w);
});
test('mode selector: small screens retain both choices without wrapping', async () => {
  const w = world({ columns: 20, rows: 4 });
  const frame = w.bytes.at(-1).replace(/^\x1b\[H/, '').split('\r\n');
  assert.ok(frame.every(line => tui.visibleWidth(line) < 20), 'line wraps into another row');
  assert.ok(frame.length <= 4); assert.match(frame.join('\n'), /Society/); assert.match(frame.join('\n'), /Personal/);
  w.send('\r'); await w.result; returned(w);
});
