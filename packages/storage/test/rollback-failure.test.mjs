import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@oma/storage';
import { StoreError, errorCodeOf } from '@oma/domain/errors';
import { AdmissionGate, bindAdmissionGate } from '@oma/domain/admission';
import { resolvedSpecDigest } from '@oma/domain/spec-identity';

function seed(store) {
  const spec = { name: 'alice', from: '0'.repeat(40), brief: 'hello', profile: 'p',
    modelProfile: 'm', capabilities: ['mail.send'] };
  store.transaction(tx => tx.insertAgent({ name: spec.name, specJson: JSON.stringify(spec), specHash: resolvedSpecDigest(spec),
    role: 'resident', desired: 'enabled', incarnation: 1, profile: spec.profile, createdBy: null }));
}

for (const mode of ['before', 'after', 'no-op', 'corrupt'])
  test(`a ${mode} rollback failure preserves both failures and prevents reuse of its connection`, t => {
    const root = mkdtempSync(join(tmpdir(), 'oma-rollback-failure-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'runtime.sqlite'), store = new Store(path);
    const gate = new AdmissionGate(); bindAdmissionGate(store, gate);
    seed(store);
    const db = Reflect.get(store, 'db'), exec = db.exec.bind(db);
    const primary = new StoreError('INVALID_REQUEST', 'refused before commit');
    const secondary = mode === 'corrupt'
      ? Object.assign(new Error('rollback reports corrupt storage'), { code: 'ERR_SQLITE_ERROR', errcode: 11 })
      : Object.assign(new Error('rollback I/O failure'), { code: 'EIO' });
    let rollbacks = 0;
    db.exec = sql => {
      if (sql !== 'ROLLBACK') return exec(sql);
      rollbacks++;
      if (mode === 'after') exec(sql);
      if (mode !== 'no-op') throw secondary;
    };
    try {
      assert.throws(() => store.transaction(tx => {
        tx.updateAgent({ name: 'alice', desired: 'stopped' });
        throw primary;
      }), error => {
        assert.equal(errorCodeOf(error), 'INVALID_REQUEST');
        assert.ok(error.cause instanceof AggregateError);
        assert.equal(error.cause.errors[0], primary);
        if (mode !== 'no-op') assert.equal(error.cause.errors[1], secondary);
        return true;
      });
      assert.equal(rollbacks, 1, 'a failed rollback is never retried on the same connection');
      assert.equal(db.isTransaction, mode !== 'after');
      assert.equal(store.inTransaction, db.isTransaction, 'logical scope exit cannot hide an open native transaction');
      const code = mode === 'corrupt' ? 'STORE_CORRUPT' : 'BROKER_UNAVAILABLE';
      for (const read of [() => store.getAgent('alice'), () => store.agents.get('alice'),
        () => store.listAgents(), () => store.operations.getById('op-00000000-0000-4000-8000-000000000001'),
        () => store.integrationNoticeRequester('m-00000000-0000-4000-8000-000000000001-0'),
        () => store.findSucceededContext('0'.repeat(40)),
        () => store.pendingDeliveryRows('alice').next()])
        assert.throws(read, { code }, 'an unconfirmed connection must not expose uncommitted rows');
      let called = false;
      assert.throws(() => store.transaction(() => { called = true; }), { code });
      assert.equal(called, false);
      if (mode === 'corrupt') assert.equal(gate.state, 'corrupt', 'secondary proven corruption still fences admission');
    } finally {
      db.exec = exec;
      store.close();
    }
    assert.equal(db.isOpen, false);
    const reopened = new Store(path);
    try { assert.equal(reopened.getAgent('alice').desired, 'enabled', 'only the earlier committed state survives close/reopen'); }
    finally { reopened.close(); }
  });

test('an already rolled-back SQLite transaction needs no second rollback and remains usable', () => {
  const store = new Store(':memory:'); seed(store);
  const db = Reflect.get(store, 'db'), exec = db.exec.bind(db);
  const primary = new StoreError('INVALID_REQUEST', 'native transaction already ended');
  let extraRollbacks = 0;
  db.exec = sql => { if (sql === 'ROLLBACK') extraRollbacks++; return exec(sql); };
  try {
    assert.throws(() => store.transaction(tx => {
      tx.updateAgent({ name: 'alice', desired: 'stopped' });
      exec('ROLLBACK');
      throw primary;
    }), error => error === primary);
    assert.equal(extraRollbacks, 0);
    assert.equal(store.inTransaction, false);
    assert.equal(store.getAgent('alice').desired, 'enabled');
    store.transaction(tx => tx.updateAgent({ name: 'alice', desired: 'stopped' }));
    assert.equal(store.getAgent('alice').desired, 'stopped');
  } finally { db.exec = exec; store.close(); }
});

test('a rollback failure revokes rows buffered by a previously started traversal', () => {
  const store = new Store(':memory:'); seed(store);
  const db = Reflect.get(store, 'db'), exec = db.exec.bind(db);
  // Isolate the already-validated reader page from row relationship decoding.
  // Resuming this page needs no fresh SQL preparation to notice revocation.
  Reflect.get(store, 'reader').pendingDeliveryRows = function* () {
    yield { messageId: 'first' }; yield { messageId: 'buffered' };
  };
  const cursor = store.pendingDeliveryRows('alice');
  assert.equal(cursor.next().value.messageId, 'first');
  db.exec = sql => { if (sql === 'ROLLBACK') throw new Error('rollback failed'); return exec(sql); };
  try {
    assert.throws(() => store.transaction(() => { throw new StoreError('INVALID_REQUEST', 'refused'); }), { code: 'INVALID_REQUEST' });
    assert.throws(() => cursor.next(), { code: 'BROKER_UNAVAILABLE' });
  } finally { db.exec = exec; store.close(); }
});
