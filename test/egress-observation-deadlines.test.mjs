// DR29: production egress reader and monotonic alarm over controlled time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Script } from 'node:vm';
import ts from 'typescript';
import { FrameError, FrameParser, encodeFrame } from "@oma/protocol/frame";
import { StoreError } from "@oma/domain/errors";
const functionText = (file, name) => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node); return node.getText(source).replace(/^export /, '');
};
// fix/fp: alarm lives in protocol/alarm.ts; pi-rpc.js only re-exports it.
const code = ts.transpileModule(functionText('packages/protocol/src/alarm.ts', 'alarm') + '\n' +
  functionText('apps/oma/src/runtime/egress-forwarder.ts', 'oneFrame') + '\nexports.read = oneFrame;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function world(milliseconds) {
  const timers = new Set(), exports = {}; let now = 0, destroys = 0;
  const socket = Object.assign(new EventEmitter(), { destroy() { destroys++; this.emit('close'); }, pause() {} });
  new Script(code).runInNewContext({ exports, FrameError, FrameParser, StoreError, Promise, Number, RangeError, Buffer,
    performance: { now: () => now },
    setTimeout(run, ms) { assert.ok(ms > 0 && ms <= 0x7fffffff); const timer = { run, ms, at: now + ms, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  const pending = exports.read(socket, 4096, milliseconds);
  return { pending, socket, timers, destroys: () => destroys,
    advance(ms) { now += ms; },
    fire() { const timer = [...timers][0]; timers.delete(timer); now = timer.at; timer.run(); return timer; } };
}
test('DR29: a long egress observation cannot clamp to one millisecond or synthesize an empty successful response', async () => {
  const w = world(0x7fffffff + 5000); let settled = false; void w.pending.then(() => { settled = true; });
  assert.equal(w.fire().ms, 0x7fffffff); await Promise.resolve(); assert.equal(settled, false);
  assert.equal([...w.timers][0].ms, 5000);
  // oneFrame returns the frame and the bytes that rode in after it -- the
  // socket stays the caller's on success, so nothing is destroyed here.
  w.socket.emit('data', Buffer.concat([encodeFrame({ ok: true, result: { placeholder: 'controlled' } }), Buffer.from('tail')]));
  const answer = await w.pending;
  assert.deepEqual(answer.frame, { ok: true, result: { placeholder: 'controlled' } });
  assert.equal(String(answer.rest), 'tail');
  assert.equal(w.timers.size, 0); assert.equal(w.destroys(), 0);
});
test('DR29/UX-38: the observation window is silence, not elapsed -- every received byte re-arms it', async () => {
  const w = world(5000);
  const frame = encodeFrame({ ok: true, result: { bytes: 42 } });
  // One byte lands at t=1000, t=2000, t=3000 -- each is progress and re-arms
  // the 5s window. A fixed elapsed deadline would already have fired at
  // t=5000; the live timer must instead sit at t=8000.
  for (const byte of [frame.subarray(0, 1), frame.subarray(1, 2), frame.subarray(2, 3)]) {
    w.advance(1000);
    w.socket.emit('data', byte);
  }
  assert.equal([...w.timers][0].at, 8000);
  // Still inside the re-armed window at t=7900: nothing has fired, and the
  // frame's remainder completes the read.
  w.advance(4900);
  w.socket.emit('data', frame.subarray(3));
  const answer = await w.pending;
  assert.deepEqual(answer.frame, { ok: true, result: { bytes: 42 } });
  assert.equal(w.timers.size, 0); assert.equal(w.destroys(), 0);
  // And the converse: once bytes stop, the window still ends honestly.
  const s = world(5000);
  s.advance(1000); s.socket.emit('data', frame.subarray(0, 1));
  s.fire(); // t=6000 -- 5s of silence after the last byte
  await assert.rejects(s.pending, { code: 'BROKER_UNAVAILABLE' });
  assert.equal(s.timers.size, 0); assert.equal(s.destroys(), 1);
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
