/** Actual Linux backend. This file belongs to the Linux native CI step;
 * running it on another OS is an error, never a skipped qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionJournal } from '@oma/storage/execution-journal';
import { ExecutionCoordinator, acquireExecutionChild } from '@oma/process/owned-execution';
import { launchBlockedNamespace } from '@oma/platform-linux/namespace-execution';
import { runnerScope } from '@oma/platform-linux/runner-scope';
import { observeNamespaceProcess, pinNamespaceInit, pinNamespaceRunner } from '@oma/native/pid-namespace';
import { StoreError } from '@oma/domain/errors';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

assert.equal(process.platform, 'linux', 'Linux scope qualification must use the actual Linux backend');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-native-scope-'));
  ExecutionJournal.initialize(root);
  const journal = ExecutionJournal.open(root);
  const owner = new ExecutionCoordinator(journal, witness => observeNamespaceProcess(witness.pid));
  t.after(async () => {
    // Unknown death retains the tree. There is no force-cleanup success path.
    await owner.drain(); journal.close(); rmSync(root, { recursive: true });
  });
  return { root, journal, owner, command(code) {
    return runnerScope({ executable: process.execPath, argv: ['-e', code],
      env: { PATH: '/usr/bin:/bin', HOME: root, LANG: 'C', LC_ALL: 'C' }, timeoutMs: null,
      stdoutBytes: 65536, stderrBytes: 65536, stdoutOverflow: 'discard', stderrOverflow: 'discard' });
  } };
}
test('native scope: durable witness and fresh authority precede the first arbitrary effect', { timeout: 15000 }, async t => {
  const f = fixture(t), effect = join(f.root, 'effect'); let witness, authorized = false;
  const result = await f.owner.run({ slot: 'candidate', launch: () => launchBlockedNamespace(f.command(`require('node:fs').writeFileSync(${JSON.stringify(effect)}, 'once'); process.stdout.write('executed')`)),
    prepared: (_execution, observed) => { witness = observed; assert.equal(existsSync(effect), false); },
    authorize() {
      assert.equal(existsSync(effect), false);
      const saved = ExecutionJournal.inspect(f.root);
      assert.equal(saved.length, 1); assert.deepEqual(saved[0].witness, witness); authorized = true;
    },
  });
  assert.equal(result.kind, 'exited', result.stderr.toString()); assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(authorized, true); assert.equal(result.stdout.toString(), 'executed');
  assert.equal(readFileSync(effect, 'utf8'), 'once'); assert.equal(f.owner.confirmDead('candidate'), true);
  assert.deepEqual(f.journal.entries(), []); assert.notEqual(observeNamespaceProcess(witness.pid).kind, 'running');
});
test('native scope: revoked authority leaves no effect and retires only after kernel death', { timeout: 15000 }, async t => {
  const f = fixture(t), effect = join(f.root, 'forbidden'); let witness;
  const refused = new StoreError('CAPABILITY_DENIED', 'authority changed after preparation');
  await assert.rejects(f.owner.run({ slot: 'candidate', launch: () => launchBlockedNamespace(f.command(`require('node:fs').writeFileSync(${JSON.stringify(effect)}, 'forbidden')`)),
    prepared: (_execution, identity) => { witness = identity; }, authorize() { throw refused; } }), error => error === refused);
  assert.equal(existsSync(effect), false); assert.equal(f.owner.confirmDead('candidate'), true);
  assert.deepEqual(f.journal.entries(), []); assert.notEqual(observeNamespaceProcess(witness.pid).kind, 'running');
});
test('native scope: cancellation after witness publication cannot release the blocked init', { timeout: 15000 }, async t => {
  const f = fixture(t), effect = join(f.root, 'cancelled'), controller = new AbortController(); let authorized = false;
  await assert.rejects(f.owner.run({ slot: 'candidate', signal: controller.signal,
    launch: () => launchBlockedNamespace(f.command(`require('node:fs').writeFileSync(${JSON.stringify(effect)}, 'forbidden')`), { signal: controller.signal }),
    prepared() { controller.abort(); }, authorize() { authorized = true; } }), { code: 'CANCELLED_BEFORE_COMMIT' });
  assert.equal(authorized, false); assert.equal(existsSync(effect), false); assert.equal(f.owner.confirmDead('candidate'), true);
  assert.deepEqual(f.journal.entries(), []);
});
test('native scope: trusted child is a separately pinned namespace PID 2, not the launcher', { timeout: 15000 }, async t => {
  const f = fixture(t), controller = new AbortController();
  const ticket = await f.owner.begin({ slot: 'resident:alpha', signal: controller.signal,
    launch: () => launchBlockedNamespace(f.command('setInterval(() => {}, 1000)'), { signal: controller.signal }), authorize() {} });
  const pin = await acquireExecutionChild(ticket, () => {
    try { return { kind: 'ready', pin: pinNamespaceRunner(ticket.witness) }; }
    catch (error) { if (error.code === 'EAGAIN') return { kind: 'waiting' }; throw error; }
  }, controller.signal, 10000);
  try {
    assert.notEqual(pin.pid, ticket.witness.pid); assert.notEqual(pin.pid, process.pid); assert.equal(pin.alive(), true);
    const nspid = /^NSpid:\s+([0-9\t ]+)$/m.exec(readFileSync(`/proc/${pin.pid}/status`, 'utf8'));
    assert.equal(Number(nspid[1].trim().split(/\s+/).at(-1)), 2);
    await ticket.stop(); await ticket.completion;
    assert.equal(pin.alive(), false); assert.equal(ticket.population(), 'empty');
    assert.equal(f.owner.confirmDead('resident:alpha'), true); assert.deepEqual(f.journal.entries(), []);
  } finally { pin.close(); }
});
test('native journal: read-only diagnostics cannot repair mode-000 data into a successful empty observation', async t => {
  const f = fixture(t), file = join(f.root, 'execution/scopes.jsonl');
  chmodSync(file, 0);
  assert.throws(() => ExecutionJournal.inspect(f.root), { code: 'EACCES' });
  assert.equal(statSync(file).mode & 0o777, 0);
  chmodSync(file, 0o600);
  assert.deepEqual(ExecutionJournal.inspect(f.root), []);
});
test('native scope: setsid double-fork descendant with all inherited FDs closed ends with its namespace', { timeout: 15000 }, async t => {
  const f = fixture(t), binary = join(f.root, 'escape'), report = join(f.root, 'escaped');
  execFileSync('/usr/bin/cc', ['-Wall', '-Wextra', '-Werror', fileURLToPath(new URL('./fixtures/namespace-escape.c', import.meta.url)), '-o', binary]);
  const ticket = await f.owner.begin({ slot: 'resident:escape', launch: () => launchBlockedNamespace(f.command(
    `require('node:child_process').execFileSync(${JSON.stringify(binary)},[${JSON.stringify(report)}],{stdio:'ignore'});setInterval(()=>{},1000)`)), authorize() {} });
  const end = performance.now() + 10000;
  while (!existsSync(report)) { assert.ok(performance.now() < end, 'actual escaped descendant did not report'); await setTimeout(5); }
  const [innerPid, innerSession] = readFileSync(report, 'utf8').trim().split(' ').map(Number);
  assert.notEqual(innerPid, innerSession, 'the second fork is outside the session leader');
  const children = readFileSync(`/proc/${ticket.witness.pid}/task/${ticket.witness.pid}/children`, 'utf8').trim().split(/\s+/).map(Number);
  const escaped = children.find(pid => {
    try { const match = /^NSpid:\s+([0-9\t ]+)$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8')); return Number(match[1].trim().split(/\s+/).at(-1)) === innerPid; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
  assert.ok(escaped, 'actual orphan is reparented to the namespace init');
  assert.equal(observeNamespaceProcess(escaped).kind, 'running');
  await ticket.stop(); await ticket.completion;
  assert.equal(ticket.population(), 'empty'); assert.notEqual(observeNamespaceProcess(escaped).kind, 'running');
  assert.equal(f.owner.confirmDead('resident:escape'), true);
});
for (const phase of ['after-initialize', 'after-opening', 'after-witness', 'after-effect', 'before-closed', 'after-closed'])
  test(`native recovery: real owner SIGKILL at ${phase}`, { timeout: 20000 }, async t => {
    const root = mkdtempSync(join(process.env.OMA_NATIVE_EVIDENCE_DIR ?? tmpdir(), 'oma-execution-crash-'));
    const child = fork(fileURLToPath(new URL('./fixtures/execution-crash.mjs', import.meta.url)), [root, phase], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const closed = once(child, 'close'); let recovered = false, journal;
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed; journal?.close();
      if (recovered) rmSync(root, { recursive: true });
      else t.diagnostic(`Unconfirmed execution evidence retained at ${root}`);
    });
    const marker = join(root, 'checkpoint.json'), deadline = performance.now() + 10000;
    while (!existsSync(marker)) {
      assert.equal(child.exitCode, null, 'fixture exited before reaching its actual checkpoint');
      assert.equal(child.signalCode, null, 'fixture died before reaching its actual checkpoint');
      assert.ok(performance.now() < deadline, 'physical crash checkpoint was not reached'); await setTimeout(5);
    }
    const checkpoint = JSON.parse(readFileSync(marker, 'utf8')); assert.equal(checkpoint.phase, phase);
    const file = join(root, 'execution/scopes.jsonl'), before = readFileSync(file);
    if (phase === 'after-initialize') {
      // Publication precedes acquisition of the journal's writer lock.
      const published = ExecutionJournal.open(root); published.close();
    } else assert.throws(() => ExecutionJournal.open(root), { code: 'BROKER_UNAVAILABLE' }, 'the live owner retains its exclusive journal');
    child.kill('SIGKILL'); const [code, signal] = await closed; assert.equal(code, null); assert.equal(signal, 'SIGKILL');
    journal = ExecutionJournal.open(root);
    const recovery = new ExecutionCoordinator(journal, identity => observeNamespaceProcess(identity.pid), identity => pinNamespaceInit(identity.pid));
    if (phase === 'after-initialize') {
      assert.deepEqual(journal.entries(), []);
      ExecutionJournal.initialize(root);
      await recovery.recover(); await recovery.recover();
      assert.deepEqual(readFileSync(file), before, 'retry preserves the initialized journal bytes');
      assert.equal(existsSync(join(root, 'effect')), false);
      recovered = true; return;
    }
    if (phase === 'after-opening') {
      assert.equal(checkpoint.witness, null);
      await assert.rejects(() => recovery.recover(), { code: 'RUN_TERMINATION_UNKNOWN' });
      assert.deepEqual(readFileSync(file), before, 'missing witness must not be replaced by empty or a closed frame');
      assert.equal(existsSync(join(root, 'effect')), false);
      return; // The retained unknown is deliberate, not a process-death PASS.
    }
    t.diagnostic(JSON.stringify({ phase, beforeRecovery: observeNamespaceProcess(checkpoint.witness.pid) }));
    const end = performance.now() + 10000;
    for (;;) {
      try { await recovery.recover(); break; }
      catch (error) {
        assert.equal(error.code, 'RUN_TERMINATION_UNKNOWN'); assert.ok(performance.now() < end, 'previous scope death remains unobserved');
        await setTimeout(5);
      }
    }
    assert.deepEqual(journal.entries(), []); assert.equal(recovery.confirmDead('resident:alpha'), true);
    assert.notEqual(observeNamespaceProcess(checkpoint.witness.pid).kind, 'running');
    if (phase === 'after-witness') assert.equal(existsSync(join(root, 'effect')), false);
    else assert.equal(readFileSync(join(root, 'effect'), 'utf8'), 'once', 'recovery observes; it never replays the command');
    const settled = readFileSync(file); await recovery.recover(); assert.deepEqual(readFileSync(file), settled, 'recovery is idempotent');
    recovered = true;
  });
