/** Cross-platform coordination policy only. These controlled ports never
 * qualify process isolation, physical death, files or peer authentication. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ResidentRuntime } from '../dist/resident-runtime.js';

test('Resident status policy distinguishes unobserved scope from positively recovered absence', async () => {
  let dead = false;
  const runtime = new ResidentRuntime({ references: () => ({ profile: 'p', modelProfile: 'm' }), incarnation: () => 1,
    confirmDead: () => dead, revoke() {}, hint() {}, failure() {},
    async begin() { throw new Error('policy test must never launch'); } });
  assert.equal((await runtime.observeStatus(['alice'])).get('alice').activeState, 'unknown');
  dead = true;
  assert.equal((await runtime.observeStatus(['alice'])).get('alice'), 'no-unit');
  runtime.ensureResident('alice', 'p', 'm');
  assert.equal((await runtime.observeStatus(['alice'])).get('alice'), 'no-unit');
  await runtime.close();
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const references = () => ({ profile: 'p', modelProfile: 'm' });

test('Resident close policy attempts other owners when one incarnation is unobserved', async () => {
  const revoked = [];
  const runtime = new ResidentRuntime({ references, incarnation: actor => actor === 'alice' ? null : 1,
    confirmDead: () => true, revoke: actor => revoked.push(actor), hint() {}, failure() {},
    begin: async () => { throw new Error('this fixture owns no execution'); } });
  runtime.ensureResident('alice', 'p', 'm'); runtime.ensureResident('bob', 'p', 'm');
  const closing = runtime.close(); assert.equal(runtime.close(), closing);
  await assert.rejects(closing, error => error instanceof AggregateError &&
    error.errors.length === 1 && error.errors[0].code === 'RUN_TERMINATION_UNKNOWN');
  assert.deepEqual(revoked, ['bob']);
  await assert.rejects(runtime.start('bob', true), { code: 'BROKER_UNAVAILABLE' });
});

test('Resident close policy joins an already-starting owner and its completion before releasing it', async () => {
  const launch = deferred(), stopped = deferred(), completion = deferred(); let empty = true, stops = 0;
  const runtime = new ResidentRuntime({ references, incarnation: () => 1, confirmDead: () => empty,
    revoke() {}, hint() {}, failure(error) { throw error; },
    async begin(_actor, _references, _authorize, prepared) {
      prepared('a'.repeat(32), {}); await launch.promise; empty = false;
      return { execution: 'a'.repeat(32), witness: {}, completion: completion.promise,
        population: () => empty ? 'empty' : 'populated',
        stop: async () => { stops++; empty = true; stopped.resolve(); } };
    } });
  const starting = runtime.start('alice', false), closing = runtime.close();
  launch.resolve(); await starting; await stopped.promise;
  let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false); assert.equal(stops, 1);
  await assert.rejects(runtime.start('alice', true), { code: 'BROKER_UNAVAILABLE' });
  completion.resolve({ kind: 'exited', exitCode: 0 }); await closing;
  assert.equal(closed, true); assert.equal(runtime.confirmDead('alice', 1), true);
});
