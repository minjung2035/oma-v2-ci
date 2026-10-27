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
  const schemas = ['schema-v4.sql'];
  put('production-manifest.json', JSON.stringify(['apps/oma/src', 'apps/oma/package.json', 'packages/contracts/src', 'packages/contracts/package.json', 'packages/storage/src', 'packages/storage/package.json', 'packages/platform-linux/src', 'packages/platform-linux/package.json']));
  put('apps/oma/package.json', '{}\n');
  put('apps/oma/src/entry.ts', 'export const value = 1;\n');
  put('packages/contracts/src/index.ts', 'export {};\n');
  put('packages/contracts/package.json', '{}\n');
  put('packages/platform-linux/package.json', '{}');
  put('packages/storage/package.json', '{}\n');
  for (const schema of schemas) put(`packages/storage/src/${schema}`, 'SELECT 1;\n');
  put('packages/platform-linux/src/systemd/resident.service.in', '[Service]\nExecStart=/bin/true\n');
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
  f.put('apps/oma/src/entry.ts', 'export const value = 2;\n');
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
  f.put('apps/oma/src/entry.ts', 'export const changed = 2;\n');
  assert.equal(f.cli('loc.mjs', ['--out', output]).status, 1, 'a CI generator must not bless stale committed digests');
  assert.equal(readFileSync(join(f.root, 'production-loc-hashes.json'), 'utf8'), snapshot[1]);
});

test('K63: non-code inventory files are classified by cloc verdict, never silently omitted', async t => {
  const f = fixture(t);
  // Vendored-payload style members cloc cannot count -- no recognized
  // language, no bytes. The report must carry them under nonCode with
  // cloc's own verdict, not drop them (LOC-001..007 accounting).
  f.put('apps/oma/src/vendored/LICENSE', 'MIT License\n\nPermission is hereby granted, free of charge.\n');
  f.put('apps/oma/src/empty.ts', '');
  // A .txt counts as cloc's Text language -- the classification is cloc's
  // decline set, not a file-kind guess, so this one stays a code row.
  f.put('apps/oma/src/vendored/NOTICE.txt', 'This product includes third-party software.\n');
  const files = writeProductionInventory(f.root);
  writeSourceDigests(f.root, files);
  const output = join(f.root, 'evidence');
  const run = f.cli('loc.mjs', ['--out', output]);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(join(output, 'production-loc.json'), 'utf8'));
  assert.equal(report['apps/oma/src/vendored/LICENSE'], undefined, 'no fabricated code row for an uncountable file');
  assert.equal(report['apps/oma/src/empty.ts'], undefined);
  assert.equal(report.nonCode['apps/oma/src/vendored/LICENSE'], 'language unknown (#3)');
  assert.equal(report.nonCode['apps/oma/src/empty.ts'], 'zero sized file');
  assert.equal(report['apps/oma/src/vendored/NOTICE.txt'].language, 'Text', 'a text file stays counted');
  assert.equal(report.nonCode['apps/oma/src/vendored/NOTICE.txt'], undefined);
  assert.equal(assertMeasurementCurrent(f.root, files, { evidenceRoot: output }).status, 'SOURCE_BOUND');
  const hashes = JSON.parse(readFileSync(join(output, 'production-measurement-hashes.json'), 'utf8'));
  assert.equal(hashes.files.length, files.length, 'the byte binding still covers the classified files');

  // A file neither counted nor classified still fails -- the accounting
  // rule is shared by generation and verification, so a report that drops
  // a file is refused wherever it appears.
  const { clocCoverage } = await import('../scripts/production-inventory.mjs');
  const dropped = JSON.parse(JSON.stringify(report));
  delete dropped.nonCode['apps/oma/src/vendored/LICENSE'];
  assert.throws(() => clocCoverage(dropped, files), /cloc omitted or misclassified apps\/oma\/src\/vendored\/LICENSE/);
  const bogus = JSON.parse(JSON.stringify(report));
  bogus.nonCode['apps/oma/src/vendored/LICENSE'] = 'not a non-code verdict';
  assert.throws(() => clocCoverage(bogus, files), /not a recognized non-code reason/);
  const bothCounted = JSON.parse(JSON.stringify(report));
  bothCounted['apps/oma/src/vendored/LICENSE'] = { code: 1, blank: 0, comment: 0 };
  assert.throws(() => clocCoverage(bothCounted, files), /both counts and classifies/);
  // And the gate wraps the same rule: recorded evidence that dropped a
  // file from both halves does not pass as covering the inventory.
  f.put('evidence-stale/production-loc.json', JSON.stringify(dropped));
  f.put('evidence-stale/production-measurement-hashes.json', readFileSync(join(output, 'production-measurement-hashes.json')));
  assert.throws(() => assertMeasurementCurrent(f.root, files, { evidenceRoot: join(f.root, 'evidence-stale') }),
    /does not account for every production file/);
});

test('K63: an inventory member named like an Object.prototype member is accounted own-keyed', async t => {
  const { clocCoverage } = await import('../scripts/production-inventory.mjs');
  // `report` and `nonCode` are plain parsed objects, so a literal filename
  // `constructor` or `hasOwnProperty` reads back an inherited member on a
  // naive `report[file]` -- the file looks counted or declined while cloc
  // never measured it. Only own properties may answer for it.
  const files = ['constructor', 'hasOwnProperty'];
  assert.throws(() => clocCoverage({ nonCode: {} }, files), /cloc omitted or misclassified constructor/,
    'an inherited member is not a code row');
  assert.throws(() => clocCoverage({ nonCode: { constructor: 'temporary editor file' } }, files),
    /cloc omitted or misclassified hasOwnProperty/, 'the second member is still honestly missing');
  const covered = clocCoverage({
    nonCode: { constructor: 'temporary editor file', hasOwnProperty: 'temporary editor file' },
  }, files);
  assert.equal(covered.rows.size, 0, 'no phantom rows from the prototype');
  assert.equal(covered.nonCode.get('constructor'), 'temporary editor file');
});

test('K63: an inventory member named like a report structure key is not its own row', async t => {
  const { clocCoverage } = await import('../scripts/production-inventory.mjs');
  // A root-level file literally named `header`, `SUM` or `nonCode` collides
  // with the report's own members: reading `report[file]` answers the
  // structure -- cloc's header, the SUM totals, or the non-code block --
  // and the file looks counted while cloc never measured it. The slot is
  // ambiguous, so the honest accounting refuses it and the file's own row
  // lives only under the `./`-spelled key or the non-code verdict.
  const report = {
    header: { cloc_url: 'github.com/AlDanial/cloc', cloc_version: '2.08', n_files: 1 },
    SUM: { blank: 0, comment: 0, code: 1, nFiles: 1 },
    nonCode: {},
  };
  for (const file of ['header', 'SUM', 'nonCode']) {
    assert.throws(() => clocCoverage(report, [file]), new RegExp(`cloc omitted or misclassified ${file}`),
      `${file}: the structure member must not pass as the file's code row`);
    // A real row under the `./`-spelled key still counts it.
    const covered = clocCoverage({ ...report, [`./${file}`]: { blank: 0, comment: 0, code: 1, language: 'Text', nFiles: 1 } }, [file]);
    assert.equal(covered.rows.get(file)?.code, 1, `${file}: its own row answers`);
    // And a non-code verdict accounts for it without touching the structure.
    const declined = clocCoverage({ ...report, nonCode: { [file]: 'temporary editor file' } }, [file]);
    assert.equal(declined.nonCode.get(file), 'temporary editor file');
    assert.equal(declined.rows.size, 0, `${file}: no phantom row from the structure`);
  }
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
