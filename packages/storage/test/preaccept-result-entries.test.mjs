import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@oma/storage';
import { collectUnacceptedArtifacts } from '@oma/storage/preaccept-collection';
import { generateOperationId } from '@oma/native/identity';
import { projectGitPathAt } from '@oma/domain/paths';

/** AUD-07: an unaccepted `<uuid>.result` name is registered by a regular
 * result file. An entry of another kind wearing that name -- a directory, a
 * link -- is not the entry the sweep derives: it must be reported and kept,
 * never turned into a raw EISDIR (or a tree deletion) that aborts the whole
 * startup collection. A regular file of the same shape is still collected. */
test("001. An unaccepted result name of another entry type is kept, and the regular-file control is still collected", t => {
  const root = mkdtempSync(join(tmpdir(), 'oma-result-entries-'));
  const store = new Store(join(root, 'runtime.sqlite'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const results = join(projectGitPathAt(root), 'oma-results');
  mkdirSync(results, { recursive: true });

  const directory = join(results, `${generateOperationId().slice(3)}.result`);
  mkdirSync(directory);
  writeFileSync(join(directory, 'unowned.bin'), 'tree contents\n');

  const file = join(results, `${generateOperationId().slice(3)}.result`);
  writeFileSync(file, 'exact diff bytes\n');

  const external = join(root, 'outside-target');
  writeFileSync(external, 'external bytes\n');
  const link = join(results, `${generateOperationId().slice(3)}.result`);
  symlinkSync(external, link);

  const collected = collectUnacceptedArtifacts(root, store);
  assert.deepEqual([...collected.removed], [file], 'the regular-file control is collected');
  assert.equal(existsSync(file), false);
  assert.deepEqual(collected.kept.map(entry => entry.path).sort(), [directory, link].sort());
  for (const entry of collected.kept) assert.equal(entry.reason, 'not a name this broker derives');
  assert.equal(existsSync(directory), true, 'an underivable tree stays for the operator instead of aborting startup');
  assert.equal(readFileSync(join(directory, 'unowned.bin'), 'utf8'), 'tree contents\n');
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'the link itself stays, never its target');
  assert.equal(readFileSync(external, 'utf8'), 'external bytes\n');
  const second = collectUnacceptedArtifacts(root, store);
  assert.deepEqual(second.removed, [], 'a second collection removes nothing');
  assert.deepEqual(second.kept.map(entry => entry.path).sort(), [directory, link].sort(), 'kept residue remains reported, not silently dropped');
});
