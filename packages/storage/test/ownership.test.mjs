import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, SCHEMA_PATH } from '@oma/storage';

import { resolvedSpecDigest } from '@oma/domain/spec-identity';

function seed(store) {
  const spec = { name: 'alice', from: '0'.repeat(40), brief: 'hello', profile: 'p',
    modelProfile: 'm', capabilities: ['mail.send'] };
  store.transaction(tx => tx.insertAgent({ name: spec.name, specJson: JSON.stringify(spec), specHash: resolvedSpecDigest(spec),
    role: 'resident', desired: 'enabled', incarnation: 1, profile: spec.profile, createdBy: null }));
}

// Run using only this workspace and its declared dependencies. These probes
// exercise real SQLite rollback and the lifetime of its write capability.
test('the installed schema creates the sole ledger and rollback preserves committed state', () => {
  assert.match(readFileSync(SCHEMA_PATH, 'utf8'), /PRAGMA user_version/);
  const root = mkdtempSync(join(tmpdir(), 'oma-storage-package-'));
  const store = new Store(join(root, 'runtime.sqlite'));
  try {
    seed(store);
    assert.equal(store.getAgent('alice').desired, 'enabled');
    assert.throws(() => store.transaction(tx => { tx.updateAgent({ name: 'alice', desired: 'stopped' }); throw new Error('cut'); }), /cut/);
    assert.equal(store.getAgent('alice').desired, 'enabled');
    store.transaction(tx => tx.updateAgent({ name: 'alice', desired: 'stopped' }));
    assert.equal(store.getAgent('alice').desired, 'stopped');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
test('a returned transaction capability cannot write in a later transaction', () => {
  const store = new Store(':memory:');
  try {
    seed(store);
    const escaped = store.transaction(tx => tx);
    assert.throws(() => escaped.updateAgent({ name: 'alice', desired: 'stopped' }), { code: 'INTERNAL_ERROR' });
    assert.throws(() => store.transaction(() => escaped.updateAgent({ name: 'alice', desired: 'stopped' })), { code: 'INTERNAL_ERROR' });
    assert.equal(store.getAgent('alice').desired, 'enabled');
  } finally { store.close(); }
});
test('a thenable callback is rejected and its writes are rolled back', () => {
  const store = new Store(':memory:');
  try {
    seed(store);
    assert.throws(() => store.transaction(tx => { tx.updateAgent({ name: 'alice', desired: 'stopped' }); return Promise.resolve(); }), { code: 'INTERNAL_ERROR' });
    assert.equal(store.getAgent('alice').desired, 'enabled');
  } finally { store.close(); }
});
