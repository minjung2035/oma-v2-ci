import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, existsSync, symlinkSync, linkSync, unlinkSync, chmodSync, statSync } from 'node:fs';
import { tmpdir, constants as osConstants } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ExecutionJournal } from '../dist/execution-journal.js';
import { prepareExecutionRecovery, applyExecutionRecovery } from '../dist/execution-recovery.js';
import { preparePackageReplacement, recoverPackageReplacements } from '../dist/package-replacement.js';
import { linuxBootId } from '@oma/native/pid-namespace';
import { controlledSource } from './source-fixture.mjs';
const controls = ['settings.json', 'oma-extensions.json'];
const BOOT_A = '00000000-0000-4000-8000-000000000001', BOOT_B = '00000000-0000-4000-8000-000000000002';
function root(t) { const path = mkdtempSync(join(tmpdir(), 'oma-recovery-owner-')); t.after(() => { unseal(path); rmSync(path, { recursive: true, force: true }); }); return path; }
function unseal(path) { chmodSync(path, 0o700); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) unseal(join(path, item.name)); }
function packageRoot(t, target = 'local/hello.js') {
  const path = root(t); mkdirSync(join(path, target, '..'), { recursive: true }); writeFileSync(join(path, target), 'old package\n');
  for (const name of controls) writeFileSync(join(path, name), `old ${name}\r\n`);
  return path;
}
function oldPackage(path, target = 'local/hello.js') {
  assert.equal(readFileSync(join(path, target), 'utf8'), 'old package\n');
  for (const name of controls) assert.equal(readFileSync(join(path, name), 'utf8'), `old ${name}\r\n`);
}
function updated(path, target) { writeFileSync(join(path, target), 'new package\n'); for (const name of controls) writeFileSync(join(path, name), `new ${name}\n`); }
for (const target of ['local/hello.js', 'local/@scope/hello.js']) test(`001. Rollback restores exact configured bytes (${target})`, t => {
  const path = packageRoot(t, target), change = preparePackageReplacement(path, target, controls);
  assert.equal(existsSync(join(path, target)), false, 'preimage moved before publication');
  updated(path, target); change.rollback(); change.close(); oldPackage(path, target);
  recoverPackageReplacements(path, controls); oldPackage(path, target);
});
test("002. Committed publication survives cleanup/recovery and old resources are not revived", t => {
  const path = packageRoot(t), change = preparePackageReplacement(path, 'local/hello.js', controls);
  updated(path, 'local/hello.js'); change.commit(); change.rollback(); change.close(); recoverPackageReplacements(path, controls);
  assert.equal(readFileSync(join(path, 'local/hello.js'), 'utf8'), 'new package\n');
  assert.equal(readdirSync(path).some(name => name.startsWith('.replacement-local-')), false);
});
test("003. Failure of a first install removes new controls and candidate, not unrelated resources", t => {
  const path = root(t); mkdirSync(join(path, 'local')); writeFileSync(join(path, 'local/keep.js'), 'keep');
  const change = preparePackageReplacement(path, 'local/hello.js', controls); updated(path, 'local/hello.js'); change.rollback(); change.close();
  for (const name of ['local/hello.js', ...controls]) assert.equal(existsSync(join(path, name)), false);
  assert.equal(readFileSync(join(path, 'local/keep.js'), 'utf8'), 'keep');
});
for (const point of ["prepared", "old-move", "installing", "candidate", "committed", "collect-rename", "collect-delete", "rollback-collect", "restore-old", "restore-settings"])
  test(`004. SIGKILL at ${point} recovers the same reversible publication`, t => {
    const path = packageRoot(t), fixture = new URL('./source-fixture.mjs', import.meta.url).href;
    const source = `import {controlledSource} from ${JSON.stringify(fixture)};
      import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
      const root=${JSON.stringify(path)}, point=${JSON.stringify(point)};
      const die=()=>process.kill(process.pid,'SIGKILL');
      const m=controlledSource('package-replacement',{
        '@oma/native/posix-files': actual=>({renameAt(...args){ const result=actual.renameAt(...args);
          if(['collect-rename','rollback-collect'].includes(point) && args[3].startsWith('.staging-local-replaced-') || point==='prepared' && args[3].startsWith('.replacement-local-') || point==='old-move' && args[3]==='previous' || point==='restore-old' && args[1]==='previous')die();return result;}}),
        './directory.js': actual=>({removeOwnedEntryAt(...args){const result=actual.removeOwnedEntryAt(...args);if(point==='collect-delete' && args[1].startsWith('.staging-local-replaced-'))die();return result;}}),
        './durable-fs.js':actual=>({replaceDerivedEntry(...args){ const result=actual.replaceDerivedEntry(...args);
          if(args[1]==='change.json' && ['installing','committed'].includes(point) && JSON.parse(args[3]).phase===point || point==='restore-settings' && args[1]==='settings.json')die();return result;}})
      });
      const c=m.preparePackageReplacement(root,'local/hello.js',${JSON.stringify(controls)});
      writeFileSync(join(root,'local/hello.js'),'new package\\n');
      for(const name of ${JSON.stringify(controls)})writeFileSync(join(root,name),'new '+name+'\\n');
      if(['committed','collect-rename','collect-delete'].includes(point))c.commit(); else if(point.startsWith('restore-') || point==='rollback-collect')c.rollback(); else die();`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.signal, 'SIGKILL', result.stderr);
    recoverPackageReplacements(path, controls);
    if (['committed', 'collect-rename', 'collect-delete'].includes(point)) assert.equal(readFileSync(join(path, 'local/hello.js'), 'utf8'), 'new package\n');
    else oldPackage(path);
    recoverPackageReplacements(path, controls);
  });
test("005. Corrupt preimage refuses restoration before changing candidate or controls", t => {
  const path = packageRoot(t), c = preparePackageReplacement(path, 'local/hello.js', controls); updated(path, 'local/hello.js'); c.close();
  const slot = readdirSync(path).find(name => name.startsWith('.replacement-local-'));
  writeFileSync(join(path, slot, 'file-0'), 'damaged');
  assert.throws(() => recoverPackageReplacements(path, controls), /preimages/);
  assert.equal(readFileSync(join(path, 'local/hello.js'), 'utf8'), 'new package\n');
  assert.equal(readFileSync(join(path, 'settings.json'), 'utf8'), 'new settings.json\n');
});
test("006. Rollback restores the recorded preimage mode under a restrictive umask without relaxing other creates", t => {
  const path = packageRoot(t);
  // Distinct preimage modes prove the restore is exact, not one fixed mode.
  chmodSync(join(path, 'settings.json'), 0o640);
  chmodSync(join(path, 'oma-extensions.json'), 0o644);
  chmodSync(join(path, 'local/hello.js'), 0o644);
  const expected = Object.fromEntries(['local/hello.js', ...controls].map(name => [name, readFileSync(join(path, name), 'utf8')]));
  const replacement = new URL('../dist/package-replacement.js', import.meta.url).href;
  const durable = new URL('../dist/durable-fs.js', import.meta.url).href;
  // The umask is a process property, so the rollback runs in its own process.
  const source = `process.umask(0o077);
    const {preparePackageReplacement} = await import(${JSON.stringify(replacement)});
    const {writeExclusiveFsyncedFile} = await import(${JSON.stringify(durable)});
    const {join} = await import('node:path');
    const {readFileSync, statSync, writeFileSync, readdirSync} = await import('node:fs');
    const root = ${JSON.stringify(path)}, controls = ${JSON.stringify(controls)};
    const change = preparePackageReplacement(root, 'local/hello.js', controls);
    writeFileSync(join(root, 'local/hello.js'), 'new package\\n');
    for (const name of controls) writeFileSync(join(root, name), 'new ' + name + '\\n');
    change.rollback(); change.close();
    const observed = { residue: readdirSync(root).filter(name => name.startsWith('.replacement-local-') || name.startsWith('.staging-local-replaced-')) };
    for (const name of ['local/hello.js', ...controls]) observed[name] = { bytes: readFileSync(join(root, name), 'utf8'), mode: statSync(join(root, name)).mode & 0o777 };
    writeExclusiveFsyncedFile(join(root, 'unrelated-create'), 'unrelated\\n', 0o644);
    observed.unrelated = statSync(join(root, 'unrelated-create')).mode & 0o777;
    process.stdout.write(JSON.stringify(observed));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.deepEqual(observed.residue, []);
  assert.equal(observed['settings.json'].mode, 0o640);
  assert.equal(observed['oma-extensions.json'].mode, 0o644);
  assert.equal(observed['local/hello.js'].mode, 0o644);
  for (const name of ['local/hello.js', ...controls]) assert.equal(observed[name].bytes, expected[name], name);
  assert.equal(observed.unrelated, 0o600, 'a create outside the rollback still carries its umask mask');
});
function executionRoot(t, absent = false) {
  const path = root(t); ExecutionJournal.initialize(path);
  if (absent) unlinkSync(join(path, 'execution/scopes.jsonl')); else writeFileSync(join(path, 'execution/scopes.jsonl'), Buffer.from([0xff, 0x7b, 0x0a]));
  writeFileSync(join(path, 'runtime.sqlite'), 'opaque unrelated ledger bytes');
  return path;
}
function kernel() {
  let boot = BOOT_A;
  const module = controlledSource('execution-recovery', { '@oma/native/pid-namespace': () => ({ linuxBootId: () => boot }) });
  return { ...module, reboot() { boot = BOOT_B; } };
}
test("007. Actual Linux boot observation cannot repair corrupt execution evidence in the same boot", t => {
  assert.equal(linuxBootId(), readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim());
  const path = executionRoot(t), before = readFileSync(join(path, 'execution/scopes.jsonl'));
  assert.throws(() => ExecutionJournal.open(path), /execution journal/);
  const prepared = prepareExecutionRecovery(path);
  assert.equal(prepared.bootId, linuxBootId());
  assert.throws(() => applyExecutionRecovery(path), error => error.code === 'RUN_TERMINATION_UNKNOWN');
  assert.throws(() => ExecutionJournal.open(path), error => error.code === 'RUN_TERMINATION_UNKNOWN');
  assert.throws(() => ExecutionJournal.initialize(path), error => error.code === 'RUN_TERMINATION_UNKNOWN');
  assert.deepEqual(readFileSync(join(path, 'execution/scopes.jsonl')), before);
});
for (const absent of [false, true]) test(`008. Controlled changed-boot observation recovers ${absent ? 'missing' : 'corrupt'} journal without touching unrelated state`, t => {
  const path = executionRoot(t, absent), k = kernel(), original = absent ? null : readFileSync(join(path, 'execution/scopes.jsonl'));
  const ticket = k.prepareExecutionRecovery(path);
  assert.equal(existsSync(join(path, 'execution/scopes.jsonl')), !absent);
  assert.throws(() => k.applyExecutionRecovery(path), error => error.code === 'RUN_TERMINATION_UNKNOWN');
  k.reboot(); assert.equal(k.prepareExecutionRecovery(path).bootId, ticket.bootId, 'preparation must not overwrite previous boot proof');
  const result = k.applyExecutionRecovery(path);
  if (original) assert.deepEqual(readFileSync(result.archive), original); else assert.equal(result.archive, null);
  const journal = ExecutionJournal.open(path); assert.deepEqual(journal.entries(), []); journal.close();
  assert.equal(readFileSync(join(path, 'runtime.sqlite'), 'utf8'), 'opaque unrelated ledger bytes');
  assert.equal(existsSync(join(path, 'execution/recovery.json')), false);
});
for (const field of ['journal', 'archive', 'host', 'owner', 'extra']) test(`009. Changed ${field} refuses reset and retains all evidence`, t => {
  const path = executionRoot(t), k = kernel(), prepared = k.prepareExecutionRecovery(path);
  const ticketPath = join(path, 'execution/recovery.json');
  if (field === 'journal') appendFileSync(join(path, 'execution/scopes.jsonl'), 'changed');
  else if (field === 'archive') writeFileSync(join(path, 'execution', `scopes.before-recovery-${prepared.original.sha256}.jsonl`), 'changed');
  else { const raw = JSON.parse(readFileSync(ticketPath, 'utf8')); if (field === 'owner') raw.owner += '-other'; else if (field === 'host') raw.hostId = raw.hostId === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32); else raw.extra = true; writeFileSync(ticketPath, JSON.stringify(raw)); }
  const before = readFileSync(join(path, 'execution/scopes.jsonl')); k.reboot();
  assert.throws(() => k.applyExecutionRecovery(path), error => error.code === 'STORE_CORRUPT');
  assert.deepEqual(readFileSync(join(path, 'execution/scopes.jsonl')), before); assert.equal(existsSync(ticketPath), true);
});
for (const kind of ['symlink', 'hardlink']) test(`010. Recovery backlog: ${kind} journal is refused without modifying an external target`, t => {
  const path = executionRoot(t), external = join(path, 'outside'); writeFileSync(external, 'external', { mode: 0o400 });
  unlinkSync(join(path, 'execution/scopes.jsonl'));
  if (kind === 'symlink') symlinkSync(external, join(path, 'execution/scopes.jsonl')); else linkSync(external, join(path, 'execution/scopes.jsonl'));
  assert.throws(() => prepareExecutionRecovery(path));
  assert.equal(readFileSync(external, 'utf8'), 'external'); assert.equal(statSync(external).mode & 0o777, 0o400);
});
test("011. An existing journal owner prevents preparation", t => {
  const path = root(t); ExecutionJournal.initialize(path); const live = ExecutionJournal.open(path);
  try { assert.throws(() => prepareExecutionRecovery(path), error => error.code === 'BROKER_UNAVAILABLE'); assert.equal(existsSync(join(path, 'execution/recovery.json')), false); }
  finally { live.close(); }
});
test("012. Unknown lock ownership stays distinct from positively observed contention", t => {
  const path = root(t); ExecutionJournal.initialize(path);
  const journalPath = join(path, 'execution', 'scopes.jsonl'), before = readFileSync(journalPath);
  let evaluate = false;
  const module = controlledSource('execution-recovery', {
    '@oma/native/linux': actual => ({ lockFileDescriptor: fd => evaluate ? actual.lockFileDescriptor(fd) : { kind: 'failed', errno: osConstants.errno.ENOLCK } }),
  });
  try {
    assert.throws(() => module.prepareExecutionRecovery(path), error => {
      assert.equal(error.code, 'BROKER_UNAVAILABLE');
      assert.equal(error.details?.reason, undefined);
      return true;
    });
    assert.equal(existsSync(join(path, 'execution/recovery.json')), false, 'a refused observation publishes no ticket');
    assert.deepEqual(readFileSync(journalPath), before, 'a refused observation leaves the journal unchanged');
  } finally { evaluate = true; }
  const live = ExecutionJournal.open(path);
  try {
    assert.throws(() => module.prepareExecutionRecovery(path), error => {
      assert.equal(error.code, 'BROKER_UNAVAILABLE');
      assert.equal(error.details?.reason, 'busy');
      return true;
    });
    assert.equal(existsSync(join(path, 'execution/recovery.json')), false, 'contention publishes no ticket either');
  } finally { live.close(); }
  assert.equal(module.prepareExecutionRecovery(path).bootId, linuxBootId(), 'both refusals still fail closed and leave the journal usable');
});
test("013. Interruption after durable reset leaves admission closed until exact recovery resumes", t => {
  const path = executionRoot(t), k = kernel(); k.prepareExecutionRecovery(path); k.reboot();
  const interrupted = controlledSource('execution-recovery', {
    '@oma/native/pid-namespace': () => ({ linuxBootId: () => BOOT_B }),
    './durable-fs.js': actual => ({ replaceDerivedEntry(...args) { actual.replaceDerivedEntry(...args); throw new Error('reset interruption'); } }),
  });
  assert.throws(() => interrupted.applyExecutionRecovery(path), /reset interruption/);
  assert.throws(() => ExecutionJournal.open(path), error => error.code === 'RUN_TERMINATION_UNKNOWN');
  const result = k.applyExecutionRecovery(path); assert.deepEqual(readFileSync(result.archive), Buffer.from([0xff, 0x7b, 0x0a]));
  const journal = ExecutionJournal.open(path); assert.deepEqual(journal.entries(), []); journal.close();
});

test("014. Malformed UTF-8 replacement evidence is refused before restoration effects", t => {
  const path = packageRoot(t), change = preparePackageReplacement(path, 'local/hello.js', controls);
  writeFileSync(join(path, 'local/hello.js'), 'new package\n'); change.close();
  const slot = readdirSync(path).find(name => name.startsWith('.replacement-local-'));
  const record = join(path, slot, 'change.json'), bytes = readFileSync(record);
  const offset = bytes.indexOf(Buffer.from('hello.js')); assert.ok(offset > 0); bytes[offset] = 0xff; writeFileSync(record, bytes);
  assert.throws(() => recoverPackageReplacements(path, controls), error => error.code === 'STORE_CORRUPT');
  assert.equal(readFileSync(join(path, 'local/hello.js'), 'utf8'), 'new package\n');
  assert.equal(readFileSync(join(path, slot, 'previous'), 'utf8'), 'old package\n');
  assert.deepEqual(readFileSync(record), bytes, 'corrupt evidence was rewritten');
});

for (const point of ["archive-rename", "ticket-publication", "reset"]) test(`015. SIGKILL at ${point} preserves recovery proof and replay`, t => {
  const path = executionRoot(t), fixture = new URL('./source-fixture.mjs', import.meta.url).href;
  const source = `import {controlledSource} from ${JSON.stringify(fixture)};
    let boot=${JSON.stringify(BOOT_A)}; const point=${JSON.stringify(point)}, die=()=>process.kill(process.pid,'SIGKILL');
    const m=controlledSource('execution-recovery',{
      '@oma/native/pid-namespace':()=>({linuxBootId:()=>boot}),
      '@oma/native/posix-files':actual=>({renameAt(...args){const result=actual.renameAt(...args);if(point==='archive-rename' && args[3].startsWith('scopes.before-recovery-'))die();return result;}}),
      './durable-fs.js':actual=>({
        publishNoReplace(...args){const result=actual.publishNoReplace(...args);if(point==='ticket-publication')die();return result;},
        replaceDerivedEntry(...args){const result=actual.replaceDerivedEntry(...args);if(point==='reset' && args[1]==='scopes.jsonl')die();return result;}
      })
    });
    m.prepareExecutionRecovery(${JSON.stringify(path)});boot=${JSON.stringify(BOOT_B)};m.applyExecutionRecovery(${JSON.stringify(path)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  const archive = readdirSync(join(path, 'execution')).find(name => name.startsWith('scopes.before-recovery-'));
  assert.ok(archive); assert.equal(statSync(join(path, 'execution', archive)).nlink, 1, 'publication stranded a second archive name');
  const k = kernel(); if (point !== 'reset') k.prepareExecutionRecovery(path); k.reboot();
  const applied = k.applyExecutionRecovery(path);
  assert.deepEqual(readFileSync(applied.archive), Buffer.from([0xff, 0x7b, 0x0a]));
  const journal = ExecutionJournal.open(path); assert.deepEqual(journal.entries(), []); journal.close();
  assert.equal(readFileSync(join(path, 'runtime.sqlite'), 'utf8'), 'opaque unrelated ledger bytes');
});
