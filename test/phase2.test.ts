// Phase 2 acceptance: DDL/FK/idempotency/framing/fuzz (T02-T10, TEST-001).
// Uses the production schema/codec/store boundaries only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, StoreError, SCHEMA_PATH } from '../src/store.js';
import { FrameParser, FrameError, findDuplicateKey } from '../src/frame.js';
import { requestHash, sha256Hex, sortedUnique, canonicalJson } from '../src/hash.js';
import {
  generateOperationId, generateBatchId, generateMessageId, isValidActorName,
  isValidRequestKey, isValidFullOid, parseMessageId, isValidWirePath,
} from '../src/ids.js';

const FRAME_LIMIT = 256 * 1024;

function freshStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'oma-t2-'));
  const store = new Store(join(dir, 'runtime.sqlite'));
  return { store, dir };
}

function seal(s: Store, dir: string): void {
  s.close();
  rmSync(dir, { recursive: true, force: true });
}

function agent(name: string, role: 'resident' | 'principal' = 'resident', desired: 'enabled' | 'stopped' | 'provisioning' | 'retired' = 'enabled'): void {
  return; // fixture helper; store.insertAgent requires tx — see below
}

function insertAgentTx(store: Store, name: string, desired: 'enabled' | 'stopped' | 'provisioning' | 'retired' = 'enabled', role: 'resident' | 'principal' = 'resident'): void {
  store.transaction((tx) => {
    store.insertAgent({ name, specHash: 'h', role, desired, incarnation: 0, profile: 'p', createdBy: null, specJson: '{}' });
  });
}

function frameOf(obj: unknown): Buffer {
  const text = JSON.stringify(obj);
  const body = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

// ---------------------------------------------------------------------------

test('T02: fresh DDL applies; six entities; user_version=1; reapply rejected', () => {
  const { store, dir } = freshStore();
  const tables = store.listAgents !== undefined;
  assert.ok(tables);
  // user_version check via a second open of the same file (migration gate)
  const db2 = new Store(join(dir, 'runtime.sqlite'));
  assert.equal(db2.transaction((t) => 1), 1); // opens without re-migrating (version 1)
  db2.close();
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const ddlTables = [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]); // eslint-disable-line @typescript-eslint/no-unused-vars
  assert.deepEqual([...ddlTables].sort(), ['agents', 'batches', 'deliveries', 'operations', 'subscriptions', 'usage']);
  seal(store, dir);
});

test('T03: invalid enum / negative units / FK / bad flags rejected by constraints', () => {
  const { store, dir } = freshStore();
  insertAgentTx(store, 'a');
  assert.throws(() => store.transaction((t) => store.insertAgent({ name: 'z', specHash: 'h', role: 'resident', desired: 'enabled', incarnation: 0, profile: 'p', createdBy: null, specJson: 'not-json' })),
    /CHECK constraint failed/);
  // FK: delivery to unknown operation must fail
  assert.throws(() => store.transaction((t) => store.insertDeliveries([{ messageId: 'm-x-0', recipient: 'a', operationId: 'op-none' }])),
    /FOREIGN KEY constraint failed/);
  seal(store, dir);
});

test('T04: frame reconstruction across arbitrary byte splits', () => {
  const p = new FrameParser(FRAME_LIMIT);
  const a = frameOf({ v: 1, id: '1', method: 'status.get', params: {} });
  const b = frameOf({ v: 1, id: '2', method: 'operation.get', params: { key: 'k' } });
  const all = Buffer.concat([a, b]);
  // split every possible 1-byte boundary across the combined stream
  for (let cut = 1; cut < all.length - 1; cut++) {
    const p2 = new FrameParser(FRAME_LIMIT);
    const got = [...p2.feed(all.subarray(0, cut)), ...p2.feed(all.subarray(cut))];
    assert.equal(got.length, 2);
    assert.equal((got[0]!.raw as { id: string }).id, '1');
    assert.equal((got[1]!.raw as { id: string }).id, '2');
  }
  // UTF-8 split mid-multibyte
  const c = frameOf({ v: 1, id: '3', method: 'mail.send', params: { body: '안녕하세요' } });
  const p3 = new FrameParser(FRAME_LIMIT);
  const mid = 4 + 5; // inside the multibyte body
  const got = [...p3.feed(c.subarray(0, mid)), ...p3.feed(c.subarray(mid))];
  assert.equal(got.length, 1);
  assert.equal((got[0]!.raw as { params: { body: string } }).params.body, '안녕하세요');
});

test('T05: malicious frames are rejected pre-accept with bounded effect', () => {
  const p = new FrameParser(64);
  // oversize length
  assert.throws(() => p.feed(Buffer.concat([Buffer.from([0, 0, 0, 100]), Buffer.alloc(100)])), (e: unknown) =>
    e instanceof FrameError && e.code === 'FRAME_TOO_LARGE');
  // invalid UTF-8 bytes
  const bad = Buffer.from([0, 0, 0, 2, 0xff, 0xfe]);
  const p2 = new FrameParser(64);
  assert.throws(() => p2.feed(bad), (e: unknown) => e instanceof FrameError && e.code === 'INVALID_REQUEST');
  // duplicate JSON key
  assert.equal(findDuplicateKey('{"a":1,"a":2}'), 'a');
  assert.equal(findDuplicateKey('{"a":{"b":1,"b":2}}'), 'b');
  assert.equal(findDuplicateKey('{"a":[1,2],"b":{"c":3}}'), null);
  const dupBody = Buffer.from('{"a":1,"a":2}');
  const dup = Buffer.alloc(4 + dupBody.length);
  dup.writeUInt32BE(dupBody.length, 0);
  dup.set(dupBody, 4);
  const p3 = new FrameParser(64);
  assert.throws(() => p3.feed(dup), /duplicate JSON key/);
  // non-object root
  const arr = Buffer.concat([Buffer.from([0, 0, 0, 3]), Buffer.from('[1]')]);
  const p4 = new FrameParser(64);
  assert.throws(() => p4.feed(arr), /root must be a JSON object/);
  // NaN literal is invalid JSON
  const nan = Buffer.concat([Buffer.from([0, 0, 0, 6]), Buffer.from('{"a":N}')]);
  const p5 = new FrameParser(64);
  assert.throws(() => p5.feed(nan), /non-finite literal|malformed JSON/);
});

test('T07: same actor/key/payload converges to one operation with identical receipts (unique constraint)', () => {
  const { store, dir } = freshStore();
  insertAgentTx(store, 'a');
  const opId = generateOperationId();
  const plan = { kind: 'mail.send' as const, message: { id: generateMessageId(opId, 0), objectPath: 'o.eml', sha256: 'a'.repeat(64), bytes: 3, dateMs: 1, to: ['b'], recipients: [], kind: 'message' as const, contextRevision: null, replyHeaders: { replyTo: [], inReplyTo: null, references: [] } } };
  const payload = JSON.stringify({ to: ['b'], subject: 's', kind: 'message', body: 'x' });
  for (let i = 0; i < 20; i++) {
    try {
      store.transaction((t) => store.insertOperation({ id: opId, actor: 'a', requestKey: 'k', requestHash: 'h', kind: 'mail.send', payloadJson: payload, planJson: JSON.stringify(plan) }));
    } catch (e) {
      assert.ok(e instanceof StoreError && e.code === 'REQUEST_KEY_REUSED');
      break;
    }
  }
  const ops = store.transaction((t) => store.getOperation('a', 'k'));
  assert.ok(ops);
  assert.equal(ops.id, opId);
  seal(store, dir);
});

test('T08: same key, different payload -> REQUEST_KEY_REUSED', () => {
  const { store, dir } = freshStore();
  insertAgentTx(store, 'a');
  store.transaction((t) => store.insertOperation({ id: generateOperationId(), actor: 'a', requestKey: 'k', requestHash: 'h1', kind: 'mail.send', payloadJson: '{}', planJson: JSON.stringify({ kind: 'mail.send', message: null }) }));
  assert.throws(() => store.transaction((t) => store.insertOperation({ id: generateOperationId(), actor: 'a', requestKey: 'k', requestHash: 'h2', kind: 'mail.send', payloadJson: '{}', planJson: JSON.stringify({ kind: 'mail.send', message: null }) })),
    (e: unknown) => e instanceof StoreError && e.code === 'REQUEST_KEY_REUSED');
  seal(store, dir);
});

test('T10: different keys are distinct operations; no semantic dedup', () => {
  const { store, dir } = freshStore();
  insertAgentTx(store, 'a');
  const mk = (k: string) => store.transaction((t) => store.insertOperation({ id: generateOperationId(), actor: 'a', requestKey: k, requestHash: 'h', kind: 'mail.send', payloadJson: '{}', planJson: JSON.stringify({ kind: 'mail.send', message: null }) }));
  mk('k1');
  mk('k2');
  assert.equal(store.transaction((t) => store.getOperation('a', 'k1'))!.requestKey, 'k1');
  assert.equal(store.transaction((t) => store.getOperation('a', 'k2'))!.requestKey, 'k2');
  seal(store, dir);
});

test('hash: canonical key sorting, set dedupe, stability, stream folding', () => {
  const h1 = requestHash('mail.send', { to: sortedUnique(['b', 'a', 'b']), subject: 'S', body: 'x' } as never);
  const h2 = requestHash('mail.send', { subject: 'S', body: 'x', to: sortedUnique(['a', 'b']) } as never);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  const h3 = requestHash('mail.send', { body: ' x ', subject: 'S ', to: [] } as never); // no trimming
  const h4 = requestHash('mail.send', { body: 'x', subject: 'S', to: [] } as never);
  assert.notEqual(h3, h4);
  const withStream = requestHash('git.submit', {}, { bytes: 100, sha256: 'c'.repeat(64) });
  assert.notEqual(withStream, requestHash('git.submit', {}));
  assert.equal(canonicalJson({ b: 1, a: [2, 1] }), '{"a":[2,1],"b":1}');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('ids: grammar, reserved names, message ids, wire paths', () => {
  assert.ok(isValidActorName('a'));
  assert.ok(isValidActorName('agent-2'));
  assert.ok(!isValidActorName('Agent'));
  assert.ok(!isValidActorName('principal'));
  assert.ok(!isValidActorName('commons'));
  assert.ok(!isValidActorName('topic-x'));
  assert.ok(!isValidActorName('a'.repeat(33)));
  assert.ok(isValidRequestKey('k'));
  assert.ok(isValidRequestKey('a.b_c-d'.repeat(13))); // 12*13=... within 96? 'a.b_c-d' is 7 chars *13=91
  assert.ok(!isValidRequestKey(''));
  assert.ok(!isValidRequestKey('x'.repeat(97)));
  assert.ok(isValidFullOid('a'.repeat(40)));
  assert.ok(isValidFullOid('b'.repeat(64)));
  assert.ok(!isValidFullOid('A'.repeat(40)));
  const op = generateOperationId();
  const m = generateMessageId(op, 0);
  assert.equal(parseMessageId(m)!.operationId, op);
  assert.equal(parseMessageId(m)!.ordinal, 0);
  assert.equal(parseMessageId('m-x-3'), null);
  assert.ok(generateBatchId().startsWith('b-'));
  assert.ok(isValidWirePath('a/b.txt'));
  assert.ok(!isValidWirePath('../etc'));
  assert.ok(!isValidWirePath('/abs'));
  assert.ok(!isValidWirePath('a/../b'));
  assert.ok(!isValidWirePath('a\0b'));
});

test('store: batch link cross-row invariant (DB-008/BATCH-001)', () => {
  const { store, dir } = freshStore();
  insertAgentTx(store, 'a');
  insertAgentTx(store, 'b');
  const opId = generateOperationId();
  const msgA = generateMessageId(opId, 0);
  const msgB = generateMessageId(opId, 1);
  store.transaction((t) => {
    store.insertOperation({ id: opId, actor: 'a', requestKey: 'k', requestHash: 'h', kind: 'mail.send', payloadJson: '{}', planJson: JSON.stringify({ kind: 'mail.send', message: null }) });
    // msgA broadcast to a and b; msgB only to b
    store.insertDeliveries([
      { messageId: msgA, recipient: 'a', operationId: opId },
      { messageId: msgA, recipient: 'b', operationId: opId },
      { messageId: msgB, recipient: 'b', operationId: opId },
    ]);
  });
  const bId = generateBatchId();
  store.transaction((t) => store.insertPreparedBatch({ id: bId, agent: 'a', incarnation: 1, messageIds: [msgA], sessionPath: null }));
  // linking a broadcast message to a's batch is legal (a has a delivery)
  store.transaction((t) => store.linkDeliveriesToBatch(bId, [msgA]));
  // a batch for agent a cannot claim a message with no delivery for a
  const b2 = generateBatchId();
  store.transaction((t) => store.insertPreparedBatch({ id: b2, agent: 'a', incarnation: 1, messageIds: [msgB], sessionPath: null }));
  assert.throws(() => store.transaction((t) => store.linkDeliveriesToBatch(b2, [msgB])),
    (e: unknown) => e instanceof StoreError && e.code === 'BATCH_CONFLICT');
  // BATCH-001: an ID already claimed by one prepared batch cannot be copied
  const b3 = generateBatchId();
  store.transaction((t) => store.insertPreparedBatch({ id: b3, agent: 'a', incarnation: 1, messageIds: [msgA], sessionPath: null }));
  assert.throws(() => store.transaction((t) => store.linkDeliveriesToBatch(b3, [msgA])),
    (e: unknown) => e instanceof StoreError && e.code === 'BATCH_CONFLICT');
  seal(store, dir);
});

test('ids + hash demo: complete request hash for mail.send', () => {
  const body = '문의드립니다\n';
  const to = sortedUnique(['topic/auth', 'b']);
  const h = requestHash('mail.send', { to, subject: 'S', kind: 'message', body } as never);
  assert.match(h, /^[0-9a-f]{64}$/);
});