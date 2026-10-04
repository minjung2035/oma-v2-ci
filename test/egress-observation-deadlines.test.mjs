// DR29: production egress reader and monotonic alarm over controlled time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';
import ts from 'typescript';
import { FrameParser, encodeFrame } from '../dist/src/frame.js';
import { StoreError } from '../dist/src/domain/errors.js';
const functionText = (file, name) => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node); return node.getText(source).replace(/^export /, '');
};
// fix/fp: alarm lives in protocol/alarm.ts; pi-rpc.js only re-exports it.
const code = ts.transpileModule(functionText('src/protocol/alarm.ts', 'alarm') + '\n' +
  functionText('src/runtime/egress-forwarder.ts', 'oneFrame') + '\nexports.read = oneFrame;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function world(milliseconds) {
  const timers = new Set(), exports = {}; let now = 0, destroys = 0;
  const socket = Object.assign(new EventEmitter(), { destroy() { destroys++; this.emit('close'); } });
  new Script(code).runInNewContext({ exports, FrameParser, StoreError, Promise, Number, RangeError,
    performance: { now: () => now },
    setTimeout(run, ms) { assert.ok(ms > 0 && ms <= 0x7fffffff); const timer = { run, ms, at: now + ms, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  const pending = exports.read(socket, 4096, milliseconds);
  return { pending, socket, timers, destroys: () => destroys,
    fire() { const timer = [...timers][0]; timers.delete(timer); now = timer.at; timer.run(); return timer; } };
}
test('DR29: a long egress observation cannot clamp to one millisecond or synthesize an empty successful response', async () => {
  const w = world(0x7fffffff + 5000); let settled = false; void w.pending.then(() => { settled = true; });
  assert.equal(w.fire().ms, 0x7fffffff); await Promise.resolve(); assert.equal(settled, false);
  assert.equal([...w.timers][0].ms, 5000);
  w.socket.emit('data', encodeFrame({ ok: true, result: { placeholder: 'controlled' } }));
  assert.deepEqual(await w.pending, { ok: true, result: { placeholder: 'controlled' } });
  assert.equal(w.timers.size, 0); assert.equal(w.destroys(), 1);
});
test('DR29: egress deadline and socket loss remain unknown and return their timer exactly once', async () => {
  for (const event of ['timeout', 'error', 'close']) {
    const w = world(5000);
    if (event === 'timeout') w.fire(); else w.socket.emit(event, new Error('connection lost'));
    await assert.rejects(w.pending, { code: 'BROKER_UNAVAILABLE' });
    assert.equal(w.timers.size, 0); assert.equal(w.destroys(), 1);
  }
});
test('DR29: invalid egress budgets fail before scheduling a native timer', async () => {
  for (const milliseconds of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const w = world(milliseconds); await assert.rejects(w.pending, error => error instanceof RangeError);
    assert.equal(w.timers.size, 0); assert.equal(w.destroys(), 1);
  }
});
