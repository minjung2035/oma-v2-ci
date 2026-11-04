// DR27/P0-4: production query owner with fake time and parent messages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { StoreError } from "@oma/domain/errors";
const source = readFileSync('packages/engine/src/session-directories.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// fix/fp: alarm is declared in protocol/alarm.ts; pi-rpc.js only re-exports it.
const deadlineSource = ts.createSourceFile('packages/protocol/src/alarm.ts', readFileSync('packages/protocol/src/alarm.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const deadline = deadlineSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'alarm');
assert.ok(deadline);
const deadlineCode = ts.transpileModule(deadline.getText(deadlineSource), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function world(send, waitMs = 5000) {
  const timers = new Set(), sent = [], module = { exports: {} };
  let now = 0;
  const clock = {
    performance: { now: () => now },
    setTimeout(run, ms) { const timer = { run, ms, at: now + ms, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const deadlines = { exports: {} };
  new Script(deadlineCode).runInNewContext({ ...clock, module: deadlines, exports: deadlines.exports });
  new Script(code).runInNewContext({ ...clock, module, exports: module.exports,
    require(name) {
      if (name === '@oma/domain/errors') return { StoreError };
      assert.equal(name, '@oma/protocol/alarm'); return deadlines.exports;
    } });
  const query = new module.exports.ProjectSessionDirectories('/own', waitMs / 1000, event => { sent.push(event); send?.(event); });
  return { query, sent, timers, fire(timer) { now = timer.at; timers.delete(timer); timer.run(); },
    answer(index, dirs) { query.accept({ type: 'session_dirs', id: sent[index].id, dirs }); } };
}
test("001. Session selector waits across the native timer limit without an early empty list", async () => {
  const w = world(undefined, 0x7fffffff + 5000);
  let settled = false; const pending = w.query.read().then(value => { settled = true; return value; });
  const first = [...w.timers][0]; assert.equal(first.ms, 0x7fffffff);
  w.fire(first); await flush(); assert.equal(settled, false);
  const second = [...w.timers][0]; assert.equal(second.ms, 5000);
  w.fire(second); assert.deepEqual(plain(await completed(pending)), ['/own']);
  assert.equal(w.timers.size, 0);
});
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const plain = value => Array.from(value);
async function completed(promise) {
  let result;
  void promise.then(value => { result = { value }; }, error => { result = { error }; });
  await flush();
  assert.ok(result, 'the observed reply/cancellation did not settle its query');
  if (Object.hasOwn(result, 'error')) throw result.error;
  return result.value;
}

test("002. Session directories: exact answers include this society once and return the timer", async () => {
  const w = world(); const result = w.query.read();
  w.answer(0, ['/other', '/own', '/other']);
  assert.deepEqual(plain(await completed(result)), ['/own', '/other']); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("003. Session directories: concurrent requests receive their own out-of-order answers", async () => {
  const w = world(); const first = w.query.read(), second = w.query.read();
  assert.notEqual(w.sent[0].id, w.sent[1].id);
  w.answer(1, ['/second']); w.answer(0, ['/first']);
  assert.deepEqual(plain(await completed(first)), ['/own', '/first']); assert.deepEqual(plain(await completed(second)), ['/own', '/second']);
  assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("004. Session directories: an old timeout cannot discard a newer request", async () => {
  const w = world(); const first = w.query.read(), old = [...w.timers][0];
  const second = w.query.read(); w.fire(old); w.answer(1, ['/new']);
  assert.deepEqual(plain(await completed(first)), ['/own']); assert.deepEqual(plain(await completed(second)), ['/own', '/new']);
  assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("005. Session directories: late answer and late timer cannot settle the next request", async () => {
  const w = world(); const first = w.query.read(), old = [...w.timers][0]; w.fire(old); await completed(first);
  let value; const second = w.query.read().then(dirs => { value = dirs; });
  w.answer(0, ['/old']); old.run(); await flush(); assert.equal(value, undefined);
  assert.equal(w.timers.size, 1); w.answer(1, ['/new']); await completed(second);
  assert.deepEqual(plain(value), ['/own', '/new']); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
for (const event of [{ type: 'session_dirs', id: undefined, dirs: ['/bad'] }, { type: 'session_dirs', id: 'other', dirs: ['/bad'] },
  { type: 'notice', dirs: ['/bad'] }, { type: 'session_dirs', dirs: [3] }, { type: 'session_dirs', dirs: '/bad' },
  { type: 'session_dirs', dirs: ['/bad'], more: 'yes' }, { type: 'session_dirs', dirs: ['/bad'], more: null }]) {
  test(`006. Session directories: malformed or mismatched response is ignored ${JSON.stringify(event)}`, async () => {
    const w = world(); let settled = false; const result = w.query.read().then(dirs => { settled = true; return dirs; });
    w.query.accept({ id: w.sent[0].id, ...event });
    await flush(); assert.equal(settled, false); assert.equal(w.timers.size, 1);
    w.answer(0, ['/valid']); assert.deepEqual(plain(await completed(result)), ['/own', '/valid']);
  });
}
test("007. Session directories: a paginated catalog accumulates in order and settles once on the frame that ends it", async () => {
  for (const ending of [{}, { more: false }]) {
    const w = world(); const result = w.query.read(); const id = w.sent[0].id;
    w.query.accept({ type: 'session_dirs', id, dirs: ['/own', '/a'], more: true });
    await flush();
    assert.equal(w.query.pending.size, 1, 'an unfinished run keeps its request open');
    w.query.accept({ type: 'session_dirs', id, dirs: ['/a', '/b'], more: true });
    w.query.accept({ type: 'session_dirs', id, dirs: ['/c'], ...ending });
    assert.deepEqual(plain(await completed(result)), ['/own', '/a', '/b', '/c']);
    assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
    w.query.accept({ type: 'session_dirs', id, dirs: ['/late'], more: true });
    await flush(); assert.equal(w.query.pending.size, 0, 'a settled request takes no more frames');
  }
});
test("008. Session directories: each paginated run accumulates only its own request", async () => {
  const w = world(); const first = w.query.snapshot(), second = w.query.read();
  const [firstId, secondId] = [w.sent[0].id, w.sent[1].id];
  w.query.accept({ type: 'session_dirs', id: firstId, dirs: ['/first-a'], more: true });
  w.query.accept({ type: 'session_dirs', id: secondId, dirs: ['/second'] });
  w.query.accept({ type: 'session_dirs', id: firstId, dirs: ['/first-b'] });
  assert.deepEqual(plain(await completed(second)), ['/own', '/second']);
  const settled = await completed(first);
  assert.deepEqual(plain(settled.dirs), ['/own', '/first-a', '/first-b']);
  assert.equal(settled.error, undefined, 'a complete run reports no error');
  assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("009. Session directories: an error ends the run with what accumulated and says so", async () => {
  for (const errorAtEnd of [false, true]) {
    const w = world(); const result = w.query.snapshot(); const id = w.sent[0].id;
    w.query.accept({ type: 'session_dirs', id, dirs: ['/a'], more: true });
    w.query.accept({ type: 'session_dirs', id, dirs: ['/b'], ...(errorAtEnd ? { more: true } : {}), error: 'catalog unavailable' });
    const snapshot = await completed(result);
    assert.deepEqual(plain(snapshot.dirs), ['/own', '/a', '/b']);
    assert.equal(snapshot.error, 'catalog unavailable', 'a partial catalog is never returned as a whole one');
    assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
  }
});
test("010. Session directories: send failure rejects and returns the timer", async () => {
  const problem = new Error('send failed'), w = world(() => { throw problem; });
  await assert.rejects(w.query.read(), error => error === problem); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("011. Session directories: abort settles only its request and detaches its listener", async () => {
  const w = world(), controller = new AbortController(), reason = new Error('selector closed');
  const first = w.query.read(controller.signal), rejected = assert.rejects(first, error => error === reason), second = w.query.read();
  controller.abort(reason); await rejected; assert.equal(w.timers.size, 1);
  w.answer(0, ['/old']); w.answer(1, ['/new']); assert.deepEqual(plain(await completed(second)), ['/own', '/new']);
});
test("012. Session directories: pre-abort sends nothing", async () => {
  const w = world(), controller = new AbortController(); controller.abort(new Error('gone'));
  await assert.rejects(w.query.read(controller.signal), /gone/); assert.equal(w.sent.length, 0); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("013. Session directories: reply detaches cancellation and late abort changes nothing", async () => {
  const w = world(); const listeners = new Set();
  const signal = { aborted: false, addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); } };
  const result = w.query.read(signal); assert.equal(listeners.size, 1); w.answer(0, ['/ok']);
  assert.deepEqual(plain(await completed(result)), ['/own', '/ok']); assert.equal(listeners.size, 0); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("014. Session directories: owner close settles all pending observations once and forbids reacquisition", async () => {
  const w = world(); const first = w.query.read(), second = w.query.read(); const old = [...w.timers];
  w.query.close(); w.query.close(); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
  assert.deepEqual(plain(await completed(first)), ['/own']); assert.deepEqual(plain(await completed(second)), ['/own']);
  for (const timer of old) timer.run(); w.answer(0, ['/late']);
  assert.deepEqual(plain(await completed(w.query.read())), ['/own']); assert.equal(w.sent.length, 2); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
});
test("015. Session directories: synchronous answer and channel close during send return every timer", async () => {
  for (const close of [false, true]) {
    const w = world(event => close ? w.query.close() : w.query.accept({ type: 'session_dirs', id: event.id, dirs: ['/sync'] }));
    assert.deepEqual(plain(await completed(w.query.read())), close ? ['/own'] : ['/own', '/sync']); assert.equal(w.timers.size, 0); assert.equal(w.query.pending.size, 0);
  }
});
