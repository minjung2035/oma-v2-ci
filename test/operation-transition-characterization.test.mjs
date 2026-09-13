/** O1: actual SQLite transitions before Journal/facet refactoring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ledgerFixture, routeOperation, routeResult } from './helpers/ledger-fixture.mjs';

const code = expected => error => error?.code === expected;

test('P3 O1: same key/hash returns the original identity and frozen bytes', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  assert.equal(store.claimKey(operation.actor, operation.requestKey, operation.requestHash), 'absent');
  assert.equal(store.transaction(tx => tx.acceptOperation(operation)), 'inserted');
  const original = store.getOperationById(operation.id);
  assert.equal(store.transaction(tx => tx.claimOperation({ ...operation, id: `op-${randomUUID()}` })), 'retry');
  assert.deepEqual(store.getOperation(operation.actor, operation.requestKey), original);
  assert.deepEqual(store.recoverableOperations(), [operation.id]);
});
test('P3 O1: reused key rejects a different hash without altering the winner', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.acceptOperation(operation));
  assert.throws(() => store.transaction(tx => tx.claimOperation({ ...operation, requestHash: 'c'.repeat(64) })), code('REQUEST_KEY_REUSED'));
  assert.equal(store.getOperationById(operation.id).requestHash, operation.requestHash);
});
test('P3 O1: accepted plan bytes cannot be rewritten in a later transaction', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.insertOperation(operation));
  assert.throws(() => store.transaction(tx => tx.updateOperationPlanJson(operation.id, operation.planJson)), code('STORE_CORRUPT'));
  assert.equal(store.getOperationById(operation.id).planJson, operation.planJson);
});
test('P3 O1: preparation may update a new pending plan only in its original transaction', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => { tx.insertOperation(operation); tx.updateOperationPlanJson(operation.id, operation.planJson); });
  assert.equal(store.getOperationById(operation.id).state, 'pending');
});
test('P3 O1: terminal success is byte-idempotent and cannot acquire different result bytes', t => {
  const { store } = ledgerFixture(t), operation = routeOperation(), result = routeResult(operation);
  store.transaction(tx => { tx.insertOperation(operation); tx.follow('design', 'alice'); tx.setOperationSucceeded(operation.id, result); });
  const before = store.getOperationById(operation.id);
  store.transaction(tx => tx.setOperationSucceeded(operation.id, result));
  assert.deepEqual(store.getOperationById(operation.id), before);
  assert.throws(() => store.transaction(tx => tx.setOperationSucceeded(operation.id, `${result} `)), code('STORE_CORRUPT'));
  assert.equal(store.getOperationById(operation.id).resultJson, result);
});
test('P3 O1: terminal failure is idempotent but never becomes success', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.insertOperation(operation));
  store.transaction(tx => tx.setOperationFailed(operation.id, 'CHECK_FAILED'));
  store.transaction(tx => tx.setOperationFailed(operation.id, 'CHECK_FAILED'));
  assert.throws(() => store.transaction(tx => tx.setOperationSucceeded(operation.id, routeResult(operation))), code('STORE_CORRUPT'));
  assert.equal(store.getOperationById(operation.id).state, 'failed');
});
test('P3 O1: preaccept-only failure cannot settle accepted intent', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.insertOperation(operation));
  assert.throws(() => store.transaction(tx => tx.setOperationFailed(operation.id, 'STREAM_INVALID')), code('STORE_CORRUPT'));
  assert.equal(store.getOperationById(operation.id).state, 'pending');
});
test('P3 O1: explicit unknown is stable until an explicit valid transition', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  store.transaction(tx => tx.insertOperation(operation));
  store.transaction(tx => tx.setOperationUnknown(operation.id));
  const unknown = store.getOperationById(operation.id);
  store.transaction(tx => tx.setOperationUnknown(operation.id));
  assert.deepEqual(store.getOperationById(operation.id), unknown);
  assert.equal(unknown.state, 'unknown');
  store.transaction(tx => { tx.follow('design', 'alice'); tx.setOperationSucceeded(operation.id, routeResult(operation)); });
  assert.equal(store.getOperationById(operation.id).state, 'succeeded');
  assert.deepEqual(store.recoverableOperations(), []);
});
test('P3 O1: rollback spans operation and other entity writes', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  assert.throws(() => store.transaction(tx => { tx.insertOperation(operation); tx.follow('design', 'alice'); throw new Error('rollback'); }), /rollback/);
  assert.equal(store.getOperationById(operation.id), null);
  assert.deepEqual(store.subscribers('design'), []);
});
test('P3 O1: malformed accepted rows fail validation before COMMIT', t => {
  const { store } = ledgerFixture(t), operation = routeOperation();
  assert.throws(() => store.transaction(tx => tx.insertOperation({ ...operation, planJson: '{}' })), code('STORE_CORRUPT'));
  assert.equal(store.getOperationById(operation.id), null);
});
test('P3 O1: escaped transaction capability cannot borrow a later transaction', t => {
  const { store } = ledgerFixture(t); let stale;
  store.transaction(tx => { stale = tx; });
  assert.throws(() => stale.follow('design', 'alice'), code('INTERNAL_ERROR'));
  store.transaction(tx => { assert.throws(() => stale.follow('design', 'alice'), code('INTERNAL_ERROR')); tx.follow('current', 'alice'); });
  assert.deepEqual(store.subscribers('design'), []);
  assert.deepEqual(store.subscribers('current'), ['alice']);
});
test('P3 O1: Promise callbacks are refused and their continuation has no write authority', async t => {
  const { store } = ledgerFixture(t), operation = routeOperation(); let escaped;
  assert.throws(() => store.transaction(tx => {
    tx.insertOperation(operation);
    return Promise.resolve().then(() => { try { tx.follow('design', 'alice'); } catch (error) { escaped = error; } });
  }), code('INTERNAL_ERROR'));
  await Promise.resolve();
  assert.equal(escaped?.code, 'INTERNAL_ERROR');
  assert.equal(store.getOperationById(operation.id), null);
  assert.deepEqual(store.subscribers('design'), []);
});
