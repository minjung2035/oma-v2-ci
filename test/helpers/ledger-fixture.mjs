/** Test-only valid v1 ledger construction; never imported by production. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../dist/src/store.js';
import { canonicalJson } from '../../dist/src/domain/canonical-json.js';
import { resolvedSpecDigest } from '../../dist/src/domain/spec-identity.js';
import { requestHash } from '../../dist/src/hash.js';

export function agentRecord(name, createdBy = null) {
  const spec = { name, from: 'a'.repeat(40), brief: 'fixture', profile: 'fixture',
    capabilities: ['mail.send', 'route.follow'], modelProfile: 'fixture-model',
    resources: { memoryBytes: 1048576, tasks: 8, cpuQuotaPercent: 100,
      tmpBytes: 1048576, workspaceBytes: 1048576, stagingBytes: 1048576, checkTimeoutSeconds: 30 } };
  return { name, specHash: resolvedSpecDigest(spec), role: name === 'principal' ? 'principal' : 'resident',
    desired: 'enabled', incarnation: 0, profile: spec.profile, createdBy, specJson: canonicalJson(spec) };
}
export function routeOperation(overrides = {}) {
  const kind = overrides.kind ?? 'route.follow', actor = overrides.actor ?? 'alice';
  const payload = { topic: overrides.topic ?? 'design' };
  return { id: `op-${randomUUID()}`, actor, requestKey: randomUUID(),
    requestHash: requestHash(kind, payload), kind, payloadJson: canonicalJson(payload),
    planJson: canonicalJson({ kind, agent: actor, topic: payload.topic }), ...overrides };
}
export function routeResult(operation) {
  return canonicalJson({ kind: operation.kind, topic: JSON.parse(operation.payloadJson).topic,
    subscribed: operation.kind === 'route.follow' });
}
export function ledgerFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-journal-'));
  let store;
  try {
    store = new Store(join(root, 'runtime.sqlite'), 0, { society: 'fixture' });
    store.transaction(tx => { tx.insertAgent(agentRecord('principal')); tx.insertAgent(agentRecord('alice', 'principal')); });
    store.listAgents();
  } catch (error) { try { store?.close(); } finally { rmSync(root, { recursive: true, force: true }); } throw error; }
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } };
  t.after(() => { try { close(); } finally { rmSync(root, { recursive: true, force: true }); } });
  return { root, store, close };
}
