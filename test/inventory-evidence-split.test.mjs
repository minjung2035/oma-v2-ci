import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertMeasurementCurrent, assertSourceDigests, writeProductionInventory, writeSourceDigests } from "../scripts/production-inventory.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-loc-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  const schemas = ['schema-v1.sql', 'schema-v2.sql', 'schema-v3.sql', 'schema-v1-to-v2.sql', 'schema-v2-to-v3.sql'];
  put('production-manifest.json', JSON.stringify(['src', 'implementation/contracts.ts', 'implementation/systemd', ...schemas.map(name => `implementation/${name}`)]));
  put('src/entry.ts', 'export const value = 1;\n');
  put('implementation/contracts.ts', 'export {};\n');
  for (const schema of schemas) put(`implementation/${schema}`, 'SELECT 1;\n');
  put('implementation/systemd/resident.service.in', '[Service]\nExecStart=/bin/true\n');
  put('implementation/cloc-systemd.lang', readFileSync(new URL('../implementation/cloc-systemd.lang', import.meta.url)));
  for (const name of ['loc.mjs', 'production-inventory.mjs']) put(`scripts/${name}`, readFileSync(new URL(`../scripts/${name}`, import.meta.url)));
  const files = writeProductionInventory(root);
  writeSourceDigests(root, files);
  return { root, files, put, cli: (script, args = [], noCloc = false) => spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    cwd: root, env: { ...process.env, ...(noCloc ? { PATH: '/nonexistent' } : {}) }, encoding: 'utf8', timeout: 20000,
  }) };
}

test('K63: check:inventory binds source bytes with no cloc and no LOC/report files', t => {
  const f = fixture(t);
  assert.equal(existsSync(join(f.root, 'production-loc.json')), false);
  const checked = f.cli('production-inventory.mjs', [], true);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).sourceDigests, 'SOURCE_DIGESTS_CURRENT');
  assert.equal(JSON.parse(checked.stdout).loc, 'CI_ARTIFACT_ONLY');
  f.put('production-loc.json', 'not a LOC report');
  assert.equal(f.cli('production-inventory.mjs', [], true).status, 0);
  f.put('src/entry.ts', 'export const value = 2;\n');
  assert.throws(() => assertSourceDigests(f.root), /stale production source digests/);
  assert.equal(f.cli('production-inventory.mjs', [], true).status, 1);
  assert.equal(f.cli('loc.mjs', ['--inventory-only'], true).status, 0);
  assert.equal(f.cli('production-inventory.mjs', [], true).status, 1, 'rewriting the list must not refresh byte claims');
  assert.equal(f.cli('loc.mjs', ['--source-digests'], true).status, 0);
  assertSourceDigests(f.root);
});

test('K63: duplicate, omitted, extra, reordered and malformed per-file digests are refused', t => {
  const f = fixture(t), file = join(f.root, 'production-loc-hashes.json'), original = JSON.parse(readFileSync(file));
  for (const change of [
    records => { records.files[1] = records.files[0]; },
    records => { records.files.pop(); },
    records => { records.files.push({ path: 'not-source', sha256: 'f'.repeat(64) }); },
    records => { records.files.reverse(); },
    records => { records.files[0].sha256 = 'unknown'; },
    records => { records.report = 'not a committed claim'; },
    records => { records.manifest = 'f'.repeat(64); },
  ]) {
    const records = structuredClone(original); change(records); f.put('production-loc-hashes.json', JSON.stringify(records));
    assert.throws(() => assertSourceDigests(f.root), /invalid production source|different file list/);
  }
});

test('K63: CI measures into an artifact directory without rewriting committed source claims', t => {
  const f = fixture(t), output = join(f.root, 'evidence');
  const snapshot = ['production-files.txt', 'production-loc-hashes.json'].map(path => readFileSync(join(f.root, path), 'utf8'));
  const run = f.cli('loc.mjs', ['--out', output]);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(existsSync(join(f.root, 'production-loc.json')), false);
  assert.deepEqual(['production-files.txt', 'production-loc-hashes.json'].map(path => readFileSync(join(f.root, path), 'utf8')), snapshot);
  assert.equal(assertMeasurementCurrent(f.root, f.files, { evidenceRoot: output }).status, 'SOURCE_BOUND');
  const evidence = JSON.parse(readFileSync(join(output, 'production-measurement-hashes.json')));
  assert.equal(evidence.cloc, '2.08');
  assert.equal(evidence.files.length, f.files.length);
  const reportBefore = readFileSync(join(output, 'production-loc.json'), 'utf8');
  const repeated = f.cli('loc.mjs', ['--out', output]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(readFileSync(join(output, 'production-loc.json'), 'utf8'), reportBefore, 'measurement noise must not change artifact identity');
  f.put('src/entry.ts', 'export const changed = 2;\n');
  assert.equal(f.cli('loc.mjs', ['--out', output]).status, 1, 'a CI generator must not bless stale committed digests');
  assert.equal(readFileSync(join(f.root, 'production-loc-hashes.json'), 'utf8'), snapshot[1]);
});

test('K63: unavailable measurement stays NOT_RUN and cannot overwrite source digests', t => {
  const f = fixture(t), before = readFileSync(join(f.root, 'production-loc-hashes.json'), 'utf8');
  const run = f.cli('loc.mjs', ['--out', join(f.root, 'evidence')], true);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /LOC evidence NOT_RUN/);
  assert.equal(existsSync(join(f.root, 'evidence/production-loc.json')), false);
  assert.equal(readFileSync(join(f.root, 'production-loc-hashes.json'), 'utf8'), before);
  for (const args of [['--out'], ['--source-digests', '--out', 'evidence'], ['--unknown']])
    assert.equal(f.cli('loc.mjs', args).status, 1, JSON.stringify(args));
});
