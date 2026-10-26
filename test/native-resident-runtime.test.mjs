/** Common Resident policy with real Linux scope/journal effects. References
 * and the monotonic clock are explicit policy inputs, never kernel mocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { ExecutionJournal } from '@oma/storage/execution-journal';
import { ExecutionCoordinator } from '@oma/process/owned-execution';
import { ResidentRuntime } from '@oma/process/resident-runtime';
import { launchBlockedNamespace } from '@oma/platform-linux/namespace-execution';
import { runnerScope } from '@oma/platform-linux/runner-scope';
import { observeNamespaceProcess, pinNamespaceInit } from '@oma/native/pid-namespace';
assert.equal(process.platform, 'linux');
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t, program = 'setInterval(()=>{},1000)', completionError = null, finalize = async () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'oma-native-resident-')); ExecutionJournal.initialize(root);
  const journal = ExecutionJournal.open(root), owner = new ExecutionCoordinator(journal,
    witness => observeNamespaceProcess(witness.pid), witness => pinNamespaceInit(witness.pid));
  let clock = 0, incarnation = 1, begins = 0, revocations = 0, hints = 0; const errors = [];
  const tickets = [];
  const runtime = new ResidentRuntime({ references: () => ({ profile: 'p', modelProfile: 'm' }), incarnation: () => incarnation,
    confirmDead: actor => owner.confirmDead(`resident:${actor}`), revoke: () => revocations++, hint: () => hints++, failure: error => errors.push(error),
    async begin(actor, _references, authorize, prepared, signal) {
      begins++;
      const physical = await owner.begin({ slot: `resident:${actor}`, signal, authorize, prepared,
        launch: () => launchBlockedNamespace(runnerScope({ executable: process.execPath, argv: ['-e', program],
          env: { PATH: '/usr/bin:/bin', HOME: root }, timeoutMs: null, stdoutBytes: 4096, stderrBytes: 4096 }), { signal }) });
      // A diagnostic owner can fail after the physical scope completed. This
      // injects that policy error; kernel population and death stay real.
      const ticket = Object.freeze({ ...physical, completion: physical.completion.then(async result => {
        await finalize(actor);
        if (completionError !== null) throw completionError;
        return result;
      }) });
      tickets.push(ticket); return ticket;
    },
  }, () => clock);
  t.after(async () => { await runtime.close(); await owner.drain(); journal.close(); rmSync(root, { recursive: true }); assert.deepEqual(errors, completionError === null ? [] : [completionError]); });
  return { runtime, owner, journal, tickets, begins: () => begins, revocations: () => revocations, hints: () => hints,
    advance: milliseconds => { clock += milliseconds; }, epoch: value => { incarnation = value; } };
}
test('Resident stop joins diagnostic resources after actual kernel death', { timeout: 15000 }, async t => {
  const entered = deferred(), flush = deferred(); let finished = false;
  const f = fixture(t, undefined, null, async () => { entered.resolve(); await flush.promise; finished = true; });
  t.after(() => flush.resolve());
  await f.runtime.start('alice', false);
  let settled = false;
  const stopping = f.runtime.stop('alice', 1).then(() => { settled = true; });
  await entered.promise;
  assert.equal(f.owner.confirmDead('resident:alice'), true, 'kernel death is real and independent of the delayed diagnostic owner');
  await setTimeout(20);
  assert.equal(settled, false, 'stop must retain its owner until diagnostic resources settle');
  flush.resolve(); await stopping;
  assert.equal(finished, true); assert.deepEqual(f.journal.entries(), []);
});
test('Resident close coalesces, joins every actual scope and permanently closes start admission', { timeout: 15000 }, async t => {
  const entered = deferred(), flush = deferred(); const finalized = [];
  const f = fixture(t, undefined, null, async actor => {
    finalized.push(actor); if (finalized.length === 2) entered.resolve(); await flush.promise;
  });
  t.after(() => flush.resolve());
  await Promise.all([f.runtime.start('alice', false), f.runtime.start('bob', false)]);
  const closing = f.runtime.close(); assert.equal(f.runtime.close(), closing);
  let settled = false; void closing.then(() => { settled = true; });
  await assert.rejects(f.runtime.start('alice', true), { code: 'BROKER_UNAVAILABLE' });
  await entered.promise;
  assert.equal(f.owner.confirmDead('resident:alice'), true); assert.equal(f.owner.confirmDead('resident:bob'), true);
  await setTimeout(20); assert.equal(settled, false);
  flush.resolve(); await closing;
  assert.deepEqual(finalized.sort(), ['alice', 'bob']); assert.deepEqual(f.journal.entries(), []);
  await assert.rejects(f.runtime.start('bob', true), { code: 'BROKER_UNAVAILABLE' });
});
test('Resident actual scope: concurrent starts share one launch and old stops cannot kill a later incarnation', { timeout: 15000 }, async t => {
  const f = fixture(t); f.runtime.ensureResident('alice', 'p', 'm');
  await Promise.all([f.runtime.start('alice', false), f.runtime.start('alice', false)]);
  assert.equal(f.begins(), 1); const first = f.runtime.observe('alice');
  assert.equal(first.activeState, 'active'); const borrowed = f.runtime.pin(first.scope);
  assert.equal(borrowed.population(), 'populated');
  f.epoch(2);
  await assert.rejects(f.runtime.stop('alice', 1), { code: 'STALE_RUN' });
  assert.equal(borrowed.population(), 'populated'); assert.equal(f.revocations(), 0);
  await f.runtime.stop('alice', 2); await f.tickets[0].completion;
  assert.equal(borrowed.population(), 'empty'); assert.equal(f.runtime.confirmDead('alice', 2), true);
  await f.runtime.start('alice', true); assert.equal(f.begins(), 2);
  const next = f.runtime.observe('alice');
  assert.notEqual(next.invocationId, first.invocationId);
  assert.equal(borrowed.population(), 'empty', 'a new scope never revives the previous kernel observation');
  assert.equal(borrowed.matches(next.scope), false);
  assert.equal(borrowed.matches(first.scope), false, 'replacement also invalidates the old actor-slot binding');
  borrowed.close();
  assert.deepEqual(f.journal.entries().length, 1);
});
test('NATIVE-RESIDENT-STATUS-01: an empty recovered slot never reports exit zero as an observed execution', { timeout: 15000 }, async t => {
  const f = fixture(t);
  assert.equal((await f.runtime.observeStatus(['alice'])).get('alice'), 'no-unit');
  f.runtime.ensureResident('alice', 'p', 'm');
  assert.equal((await f.runtime.observeStatus(['alice'])).get('alice'), 'no-unit');
  await f.runtime.start('alice', false);
  const running = (await f.runtime.observeStatus(['alice'])).get('alice');
  assert.equal(running.activeState, 'active'); assert.notEqual(running.invocationId, '');
  await f.runtime.stop('alice', 1);
  const stopped = (await f.runtime.observeStatus(['alice'])).get('alice');
  assert.equal(stopped.activeState, 'inactive'); assert.equal(stopped.invocationId, running.invocationId);
});
test('Resident actual failures respect geometric backoff and five starts per monotonic minute', { timeout: 15000 }, async t => {
  const f = fixture(t, 'process.exitCode=1');
  for (let attempt = 0; attempt < 5; attempt++) {
    await f.runtime.start('alice', false); await f.tickets[attempt].completion; await setTimeout(0);
    assert.equal(f.runtime.observe('alice').activeState, 'failed'); assert.equal(f.runtime.restartDue('alice'), false);
    const delay = 3000 * 4 ** (Math.min(attempt, 4) / 4);
    f.advance(delay - 0.5); assert.equal(f.runtime.restartDue('alice'), false);
    await assert.rejects(f.runtime.start('alice', false), { code: 'BROKER_UNAVAILABLE' });
    f.advance(0.5); assert.equal(f.runtime.restartDue('alice'), true);
  }
  await assert.rejects(f.runtime.start('alice', false), { code: 'START_LIMIT' });
  assert.equal(f.begins(), 5); assert.equal(f.runtime.startLimitStatus('alice'), 'start_limit');
  await f.runtime.start('alice', true); assert.equal(f.begins(), 6);
  await f.tickets[5].completion;
});
test('NATIVE-RESIDENT-ISOLATION-01: equal actor names in independent owners cannot reach each other’s actual scope', { timeout: 15000 }, async t => {
  const a = fixture(t), b = fixture(t);
  await Promise.all([a.runtime.start('alice', false), b.runtime.start('alice', false)]);
  const own = a.runtime.observe('alice'), foreign = b.runtime.observe('alice');
  const aPin = a.runtime.pin(own.scope), bPin = b.runtime.pin(foreign.scope);
  t.after(() => { aPin.close(); bPin.close(); });
  assert.equal(aPin.population(), 'populated'); assert.equal(bPin.population(), 'populated');
  assert.notEqual(own.scope, foreign.scope);
  assert.notEqual(aPin.identity.namespaceInode, bPin.identity.namespaceInode);
  assert.equal(aPin.matches(foreign.scope), false);
  assert.equal(bPin.matches(own.scope), false);
  assert.throws(() => a.runtime.pin(foreign.scope), { code: 'AUTH_FAILED' });
  assert.throws(() => b.runtime.pin(own.scope), { code: 'AUTH_FAILED' });
  await a.runtime.stop('alice', 1);
  assert.equal(aPin.population(), 'empty'); assert.deepEqual(a.journal.entries(), []);
  assert.equal(bPin.population(), 'populated', 'stopping one owner must not signal another owner’s namespace');
  assert.equal(b.runtime.observe('alice').activeState, 'active');
  assert.equal(b.journal.entries().length, 1);
  await b.runtime.stop('alice', 1);
  assert.equal(bPin.population(), 'empty'); assert.deepEqual(b.journal.entries(), []);
});
test('Resident accepted references refuse replacement and current authority refusal creates no running scope', { timeout: 15000 }, async t => {
  const f = fixture(t);
  assert.throws(() => f.runtime.ensureResident('alice', 'p', 'replacement'), { code: 'STORE_CORRUPT' });
  const denied = new Error('current authority revoked');
  await assert.rejects(f.runtime.start('alice', false, () => { throw denied; }), error => error === denied);
  assert.equal(f.owner.confirmDead('resident:alice'), true); assert.deepEqual(f.journal.entries(), []);
});
test('Resident diagnostic failure remains an unknown outcome after independently confirmed stop', { timeout: 15000 }, async t => {
  const diagnostic = new Error('diagnostic completion was not observed'), f = fixture(t, 'process.exitCode=0', diagnostic);
  await f.runtime.start('alice', false); await assert.rejects(f.tickets[0].completion, error => error === diagnostic);
  assert.equal(f.runtime.observe('alice').activeState, 'unknown');
  await f.runtime.stop('alice', 1);
  const observed = f.runtime.observe('alice'); assert.equal(observed.activeState, 'inactive'); assert.equal(observed.result, 'unknown');
  assert.equal(f.runtime.confirmDead('alice', 1), true);
});
