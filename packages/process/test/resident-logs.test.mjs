import test from 'node:test';
import assert from 'node:assert/strict';
import { residentLogSinks, residentLogView } from '../dist/resident-logs.js';
const invocationId = 'a'.repeat(32);
const entry = (bytes, incarnation = 1, stream = 'stdout') => ({ kind: 'entry', entry: { actor: 'alice', invocationId, incarnation, stream, atMs: 1000, bytes } });
test('Resident logs retain every byte and current incarnation across bounded sink chunks', () => {
  const records = []; let incarnation = null;
  const sink = residentLogSinks('alice', invocationId, () => incarnation, record => records.push(record), () => 1000);
  const bytes = Buffer.alloc(200000, 0xff); sink.stdoutSink(bytes); incarnation = 2; sink.stderrSink(Buffer.from('tail'));
  assert.deepEqual(Buffer.concat(records.slice(0, -1).map(record => record.bytes)), bytes);
  assert.ok(records.every(record => record.bytes.length <= 65536));
  assert.ok(records.slice(0, -1).every(record => record.incarnation === null));
  assert.equal(records.at(-1).incarnation, 2); assert.equal(records.at(-1).stream, 'stderr');
});
test('Resident log view joins UTF-8 only within the same invocation, incarnation and stream', () => {
  const euro = Buffer.from('€');
  const joined = residentLogView([entry(euro.subarray(0, 1)), entry(euro.subarray(1))], 1, 4096, 1000);
  assert.match(joined.text, /€$/); assert.equal(joined.truncated, false);
  for (const records of [[entry(euro.subarray(0, 1))], [entry(euro.subarray(0, 1)), entry(Buffer.from('new'), 2)],
      [entry(euro.subarray(0, 1)), { kind: 'incomplete' }]]) {
    const view = residentLogView(records, 1, 4096, 1000); assert.equal(view.truncated, true); assert.doesNotMatch(view.text, /�/);
  }
});
test('Resident log view bounds UTF-8 bytes and preserves incomplete observations', () => {
  for (const limit of [0, 1, 20, 200]) {
    const view = residentLogView([entry(Buffer.from('€'.repeat(100))), { kind: 'incomplete' }], 1, limit, 1000);
    assert.ok(Buffer.byteLength(view.text) <= limit); assert.equal(view.truncated, true); assert.doesNotMatch(view.text, /�/);
  }
});
