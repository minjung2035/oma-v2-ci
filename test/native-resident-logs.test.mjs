import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, renameSync, linkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResidentLogStore } from '@oma/storage/resident-logs';
import { residentLogSinks, residentLogView } from '@oma/process/resident-logs';
assert.equal(process.platform, 'linux', 'owned file backend qualification uses actual Linux primitives');
const invocation = 'a'.repeat(32), atMs = 1000;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-native-log-')); t.after(() => rmSync(root, { recursive: true }));
  const store = new ResidentLogStore(root), directory = join(root, 'logs/resident/alice');
  return { root, store, directory, path: join(directory, `${String(atMs).padStart(16, '0')}-${invocation}.jsonl`) };
}
test('actual diagnostic spool preserves full binary bytes independently of its bounded public view', t => {
  const f = fixture(t), writer = f.store.open('alice', invocation, atMs); let incarnation = null;
  const sinks = residentLogSinks('alice', invocation, () => incarnation, entry => writer.append(entry), () => atMs);
  const bytes = Buffer.alloc(256 * 1024 + 37); for (let n = 0; n < bytes.length; n++) bytes[n] = n % 256;
  const original = Buffer.from(bytes); sinks.stdoutSink(bytes); bytes.fill(0); incarnation = 2; sinks.stderrSink(Buffer.from('tail'));
  writer.close(); writer.close(); const records = [...f.store.read('alice')];
  assert.ok(records.every(record => record.kind === 'entry'));
  assert.deepEqual(Buffer.concat(records.slice(0, -1).map(record => record.entry.bytes)), original);
  assert.ok(records.slice(0, -1).every(record => record.entry.incarnation === null));
  assert.equal(records.at(-1).entry.incarnation, 2); assert.equal(records.at(-1).entry.stream, 'stderr');
  const view = residentLogView(records, 5, 128, atMs);
  assert.ok(Buffer.byteLength(view.text) <= 128); assert.equal(view.truncated, true);
  const before = readFileSync(f.path), fds = readdirSync('/proc/self/fd').sort();
  for (let n = 0; n < 32; n++) assert.throws(() => f.store.open('alice', invocation, atMs), { code: 'REF_STATE_UNKNOWN' });
  assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(readdirSync('/proc/self/fd').sort(), fds);
});
test('actual diagnostic spool partial tail is incomplete; malformed committed frame is unknown', t => {
  const f = fixture(t), writer = f.store.open('alice', invocation, atMs);
  writer.append({ actor: 'alice', invocationId: invocation, incarnation: 1, stream: 'stdout', atMs, bytes: Buffer.from('complete') }); writer.close();
  const original = readFileSync(f.path); appendFileSync(f.path, '{"version":');
  const records = [...f.store.read('alice')]; assert.equal(records.length, 2); assert.equal(records.at(-1).kind, 'incomplete');
  assert.equal(residentLogView(records, 1, 4096, atMs).truncated, true);
  writeFileSync(f.path, Buffer.concat([original, Buffer.from('{"version":9}\n')]));
  assert.throws(() => [...f.store.read('alice')], { code: 'REF_STATE_UNKNOWN' });
});
test('actual diagnostic writer keeps its inode across pathname replacement and refuses ambiguous readback', t => {
  const f = fixture(t), writer = f.store.open('alice', invocation, atMs);
  const original = join(f.directory, 'held-original'); renameSync(f.path, original); writeFileSync(f.path, 'replacement');
  writer.append({ actor: 'alice', invocationId: invocation, incarnation: 1, stream: 'stderr', atMs, bytes: Buffer.from('owned bytes') }); writer.close();
  assert.equal(readFileSync(f.path, 'utf8'), 'replacement'); assert.match(readFileSync(original, 'utf8'), /b3duZWQgYnl0ZXM=/);
  assert.throws(() => [...f.store.read('alice')], { code: 'REF_STATE_UNKNOWN' });
});
test('actual diagnostic reader refuses hard-linked files without changing their bytes', t => {
  const f = fixture(t), writer = f.store.open('alice', invocation, atMs);
  writer.append({ actor: 'alice', invocationId: invocation, incarnation: 1, stream: 'stdout', atMs, bytes: Buffer.from('original') }); writer.close();
  const before = readFileSync(f.path); linkSync(f.path, join(f.root, 'second-link'));
  assert.throws(() => [...f.store.read('alice')], { code: 'REF_STATE_UNKNOWN' }); assert.deepEqual(readFileSync(f.path), before);
});
test('actual diagnostic writer refuses a hard link introduced after open before appending any bytes', t => {
  const f = fixture(t), writer = f.store.open('alice', invocation, atMs);
  linkSync(f.path, join(f.root, 'late-link'));
  assert.throws(() => writer.append({ actor: 'alice', invocationId: invocation, incarnation: 1, stream: 'stdout', atMs, bytes: Buffer.from('forbidden') }), { code: 'REF_STATE_UNKNOWN' });
  assert.throws(() => writer.close(), { code: 'REF_STATE_UNKNOWN' });
  assert.equal(readFileSync(f.path).length, 0); assert.equal(readFileSync(join(f.root, 'late-link')).length, 0);
});
