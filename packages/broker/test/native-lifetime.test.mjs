import test from 'node:test';
import assert from 'node:assert/strict';
import { BrokerLifetime } from '../dist/lifetime.js';

for (const synchronous of [false, true]) test(`native shutdown refusal retains Store and lock (synchronous=${synchronous})`, async () => {
  const events = [], failure = new Error('native scope remains unobserved');
  const owner = new BrokerLifetime({ close() { events.push('lock'); } }, () => 1);
  owner.retainStore(() => events.push('store'));
  owner.retainNative(synchronous ? () => { throw failure; } : async () => { throw failure; });
  const closing = owner.shutdown();
  await assert.rejects(closing, error => error === failure);
  assert.equal(owner.shutdown(), closing);
  assert.equal(owner.phase, 'draining'); assert.deepEqual(events, []);
});

test('native shutdown waits for scope proof before closing Store and lock', async () => {
  const events = []; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const owner = new BrokerLifetime({ close() { events.push('lock'); } }, () => 1);
  owner.retainStore(() => events.push('store'));
  owner.retainNative(async () => { events.push('native'); await pending; events.push('proof'); });
  const closing = owner.shutdown(); await Promise.resolve();
  assert.deepEqual(events, ['native']); release(); await closing;
  assert.deepEqual(events, ['native', 'proof', 'store', 'lock']);
});
