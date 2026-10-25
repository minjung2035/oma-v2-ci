import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeImmutableFile, observeImmutableEntry, readImmutableBytes, publishImmutableFile, publishImmutableEntry } from '@oma/storage/immutable-file';
import { openOwnedDirectoryPath } from '@oma/storage/directory';
import { sha256Hex } from '@oma/domain/canonical-json';
import { AdmissionGate } from '@oma/domain/admission';

function failures(error) {
  if (error instanceof AggregateError) return error.errors.flatMap(failures);
  return error?.cause === undefined ? [error] : failures(error.cause);
}

for (const [entry, kind] of [[true, 'file'], [false, 'file'], [false, 'directory'], [false, 'both']])
  test(`immutable observation retains corruption when ${entry ? 'entry' : 'path'} ${kind} cleanup fails`, t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'oma-immutable-cleanup-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'evidence'), bytes = Buffer.from('accepted bytes');
    fs.writeFileSync(path, bytes);
    const fileStat = fs.statSync(path), dirStat = fs.statSync(root), before = fs.readdirSync('/proc/self/fd').length;
    const directory = entry ? openOwnedDirectoryPath(root) : undefined;
    const original = fs.closeSync, injected = [];
    fs.closeSync = fd => {
      const stat = fs.fstatSync(fd);
      const flags = Number.parseInt(fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^flags:\s+(\d+)/m)[1], 8);
      const file = stat.dev === fileStat.dev && stat.ino === fileStat.ino && (flags & 0o10000000) === 0;
      const parent = stat.dev === dirStat.dev && stat.ino === dirStat.ino;
      original(fd);
      if ((file && kind !== 'directory') || (parent && kind !== 'file')) {
        const error = Object.assign(new Error(`close ${file ? 'file' : 'directory'} failed`), { code: 'EIO' });
        injected.push(error); throw error;
      }
    };
    syncBuiltinESMExports();
    let observed;
    try {
      observed = entry ? observeImmutableEntry(directory, 'evidence', '0'.repeat(64), bytes.length)
        : observeImmutableFile(path, '0'.repeat(64), bytes.length);
    } finally {
      fs.closeSync = original; syncBuiltinESMExports();
      if (directory !== undefined) original(directory);
    }
    assert.equal(observed.kind, 'corrupt');
    assert.equal(observed.error.code, 'STORE_CORRUPT');
    assert.match(observed.error.message, /hash mismatch/);
    const causes = failures(observed.error);
    assert.equal(injected.length, kind === 'both' ? 2 : 1);
    for (const failure of injected) assert.ok(causes.includes(failure), 'each close failure is retained');
    const gate = new AdmissionGate(); gate.observe(observed.error);
    assert.equal(gate.state, 'corrupt');
    assert.equal(fs.readdirSync('/proc/self/fd').length, before, 'every acquired descriptor is returned exactly once');
  });

test('a successful immutable read with failed cleanup is unavailable, never a successful read', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'oma-immutable-close-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'evidence'), bytes = Buffer.from('intact bytes');
  fs.writeFileSync(path, bytes);
  const directory = openOwnedDirectoryPath(root), stat = fs.statSync(root), original = fs.closeSync;
  fs.closeSync = fd => {
    const current = fs.fstatSync(fd); original(fd);
    if (current.dev === stat.dev && current.ino === stat.ino)
      throw Object.assign(new Error('directory close failed'), { code: 'EIO' });
  };
  syncBuiltinESMExports();
  let observed;
  try { observed = observeImmutableFile(path, sha256Hex(bytes), bytes.length); }
  finally { fs.closeSync = original; syncBuiltinESMExports(); original(directory); }
  assert.equal(observed.kind, 'unavailable');
  assert.equal(observed.error.code, 'EIO');
  assert.deepEqual(readImmutableBytes(path, sha256Hex(bytes), bytes.length), bytes);
});

for (const stage of ['source', 'destination'])
  test(`immutable publication retains ${stage} corruption and every descriptor cleanup failure`, t => {
    const root = fs.mkdtempSync(join(tmpdir(), 'oma-publication-cleanup-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'source'), destination = join(root, 'destination'), bytes = Buffer.from('accepted source');
    fs.writeFileSync(source, bytes); fs.writeFileSync(destination, 'different destination');
    const before = fs.readdirSync('/proc/self/fd').length;
    const directory = stage === 'destination' ? openOwnedDirectoryPath(root) : undefined;
    const original = fs.closeSync, injected = [];
    fs.closeSync = fd => {
      const stat = fs.fstatSync(fd);
      const flags = Number.parseInt(fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').match(/^flags:\s+(\d+)/m)[1], 8);
      original(fd);
      if ((flags & 0o10000000) === 0 && (stat.isFile() || stat.ino === fs.statSync(root).ino)) {
        const error = Object.assign(new Error('publication descriptor close failed'), { code: 'EIO' });
        injected.push(error); throw error;
      }
    };
    syncBuiltinESMExports();
    let observed;
    try {
      if (stage === 'source') publishImmutableFile(source, destination, '0'.repeat(64));
      else publishImmutableEntry(source, directory, 'destination', destination, sha256Hex(bytes));
    } catch (error) { observed = error; }
    finally {
      fs.closeSync = original; syncBuiltinESMExports();
      if (directory !== undefined) original(directory);
    }
    assert.equal(observed?.code, 'STORE_CORRUPT');
    assert.match(observed.message, /hash mismatch|size mismatch/);
    assert.equal(injected.length, stage === 'source' ? 2 : 3);
    for (const error of injected) assert.ok(failures(observed).includes(error), 'every cleanup failure remains observable');
    const gate = new AdmissionGate(); gate.observe(observed); assert.equal(gate.state, 'corrupt');
    assert.equal(fs.readdirSync('/proc/self/fd').length, before);
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'different destination');
  });
