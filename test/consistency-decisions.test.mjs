/** WP01: document coverage and existing contract gates, NOT runtime qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertSupportedIntegration, snapshotIntegrationPolicy } from '../dist/src/git/integration-policy.js';

const root = new URL('../', import.meta.url);
const document = new URL('implementation/consistency-decisions.md', root);
function decisions() {
  assert.ok(existsSync(document), 'WP01 requires an adopted decision record, not implicit agreement');
  return readFileSync(document, 'utf8');
}
function rows(text) {
  return text.split('\n').filter(line => line.startsWith('| '))
    .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
}
const spec = readFileSync(new URL('implementation-spec.md', root), 'utf8');

test('V01A: every domain names facts, relations, phase and current authority', () => {
  const table = rows(decisions());
  for (const domain of ['delivery', 'config', 'preaccept', 'quota', 'lifecycle', 'Git', 'protocol']) {
    const found = table.filter(row => row[0] === domain);
    assert.equal(found.length, 1, `${domain}: exactly one domain responsibility row`);
    assert.equal(found[0].length, 9, `${domain}: fact/store/view/relation/commit/authority/owner/requirement`);
    assert.ok(found[0].every(cell => cell.length > 0), `${domain}: no empty responsibility`);
    for (const id of found[0][8].split(', ')) assert.ok(spec.includes(`[${id}`), `actual requirement ${id}`);
  }
});

test('V01B: conceptual states do not silently become v1 SQL state or entities', () => {
  const ddl = readFileSync(new URL('implementation/schema-v1.sql', root));
  assert.equal(createHash('sha256').update(ddl).digest('hex'),
    'c97f2a15b71c87ce6ce753f95878931ee8adb0193b341263a6d594e1d93526e4',
    'a v1 DDL change needs separate C3 approval, not a golden refresh');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(ddl.toString());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name),
      ['agents', 'batches', 'deliveries', 'operations', 'subscriptions', 'usage']);
  } finally { db.close(); }
});

test('V01B: the actual unsupported integration gate is not generic success or retry', () => {
  const policy = { policyRevision: 'wp01', protectedPaths: [], checks: [] };
  assert.doesNotThrow(() => assertSupportedIntegration(snapshotIntegrationPolicy(policy)));
  for (const restricted of [
    { ...policy, checks: [{ id: 'unqualified', argv: ['/usr/bin/true'], env: {}, timeoutSeconds: 1 }] },
    { ...policy, protectedPaths: ['/'] },
  ]) assert.throws(() => assertSupportedIntegration(snapshotIntegrationPolicy(restricted)),
    error => error.code === 'SPIKE_UNRESOLVED');
});
