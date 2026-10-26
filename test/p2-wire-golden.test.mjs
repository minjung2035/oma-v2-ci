/** Runtime schemas, not host authorization or transport/kernel evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_METHODS, INTERNAL_METHODS, decodePublicParams } from "@oma/protocol/methods";
import { decodeReceipt } from "@oma/protocol/receipt-codec";
import { canonicalJson } from "@oma/domain/canonical-json";

const oid = 'a'.repeat(40), digest = 'b'.repeat(64);
const operation = 'op-00000000-0000-4000-8000-000000000001';
const message = 'm-00000000-0000-4000-8000-000000000001-0';
const context = { actorNames: new Set(['alice', 'bob']), limits: {
  frameBytes: 1048576, mailBodyBytes: 65536, subjectBytes: 1024, addresses: 24,
  replyReferences: 24, contextFiles: 24, contextBytes: 1048576, bundleBytes: 1048576,
  logBytes: 65536, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
} };
const vectors = {
  'mail.send': { to: ['alice'], subject: 'subject', kind: 'message', body: 'body\n' },
  'mail.ack': { message }, 'route.follow': { topic: 'design' }, 'route.unfollow': { topic: 'design' },
  'agent.create': { name: 'bob', from: oid, brief: 'build' },
  'agent.start': { agent: 'bob' }, 'agent.stop': { agent: 'bob' },
  'agent.continue': { note: 'continue' }, 'agent.wait': {}, 'git.known': { candidate: oid },
  'git.submit': { candidate: oid, exportRef: 'refs/oma/export/cli-example', prerequisites: [], to: [], subject: 'result', body: 'body', paths: [] },
  'git.integrate': { candidate: oid, expected: oid },
  'context.publish': { expected: null, entries: [{ path: 'GOAL.md', bytes: 3, sha256: digest }], content: { bytes: 3, sha256: digest, mediaType: 'application/vnd.oma.context-v1' } },
  'operation.get': { key: 'existing-request' },
  'operation.read': { key: 'existing-request', offset: 3, sha256: digest },
  'status.get': { agent: 'bob' },
  'logs.read': { agent: 'bob', sinceSeconds: 1 },
};
// DR27 additions are separate from the historical vectors and canonical bytes.
const additions = {
  'society.set': { state: 'closed' },
  'attest.record': { kind: 'review', name: 'merge-1a2b3c4d-0000-4000-8000-000000000001', body: 'Exact candidate reviewed' },
  'review.status': { name: 'merge-1a2b3c4d-0000-4000-8000-000000000001' },
};
for (const [method, params] of Object.entries({ ...vectors, ...additions })) {
  test(`${["attest.record", "review.status"].includes(method) ? "DR46 current wire" : "P2 wire golden"}: ${method} retains values and rejects extra fields`, () => {
    const before = JSON.stringify(params);
    assert.deepEqual(decodePublicParams(method, params, context), params);
    assert.equal(JSON.stringify(params), before);
    assert.equal(decodePublicParams(method, { ...params, unexpected: true }, context), null);
  });
}
test('P2 wire golden: closed public/internal vocabularies and canonical bytes stay v1', () => {
  assert.deepEqual(Object.keys(PUBLIC_METHODS).sort(), Object.keys({ ...vectors, ...additions }).sort());
  assert.deepEqual(Object.keys(INTERNAL_METHODS).sort(), [
    'batch.complete', 'batch.prepare', 'batch.read',
    'principal.attach', 'principal.detach', 'runner.observe', 'runner.open', 'runner.pending',
  ]);
  assert.equal(canonicalJson({ method: 'mail.send', params: vectors['mail.send'] }),
    '{"method":"mail.send","params":{"body":"body\\n","kind":"message","subject":"subject","to":["alice"]}}');
});
test('P2 wire golden: terminal receipt shape is distinct from pending and lookup absence', () => {
  const result = { kind: 'mail.ack', message, acknowledged: true };
  assert.equal(decodeReceipt({ operation, state: 'succeeded', result }).ok, true);
  assert.equal(decodeReceipt({ operation, state: 'pending', result }).ok, false);
  assert.equal(decodeReceipt({ operation, state: 'succeeded', result: { ...result, extra: true } }).ok, false);
  const missing = { operation: '', state: 'failed', error: { code: 'REQUEST_NOT_FOUND', message: 'not found', retry: 'never' } };
  assert.equal(decodeReceipt(missing).ok, false);
  assert.equal(decodeReceipt(missing, { allowNotFound: true }).ok, true);
});
