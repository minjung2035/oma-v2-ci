import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createArchitectureProgram } from '../scripts/dependency-graph.mjs';
import { ownedStateFindings } from '../scripts/architecture/rules/owned-state-rules.mjs';
import { inspectTransactions } from '../scripts/transaction-check.mjs';

function fixture(t, caller) {
  const root = mkdtempSync(join(tmpdir(), 'oma-workspace-analysis-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  put('package.json', { type: 'module' });
  put('tsconfig.json', { compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext', noEmit: true, types: [] },
    include: ['apps/oma/src/**/*.ts', 'packages/*/src/**/*.ts'] });
  put('packages/native/package.json', { name: '@oma/native', version: '0.1.0', type: 'module', exports: {
    './probe': { types: './dist/probe.d.ts', default: './dist/probe.js' },
  } });
  // This declaration is deliberately present: resolving to it used to hide
  // the callee body from owned-path provenance across a workspace boundary.
  put('packages/native/dist/probe.d.ts', 'export declare function observe(path: string): unknown;');
  put('packages/native/src/probe.ts', 'import { lstatSync } from "node:fs"; export function observe(path: string) { return lstatSync(path); }');
  put('apps/oma/src/caller.ts', caller);
  return { root, put };
}
test('P0-8: an owned path retains provenance through a public workspace API with declarations installed', t => {
  const f = fixture(t, 'import { observe } from "@oma/native/probe"; export function run(stateRoot: string) { return observe(stateRoot); }');
  assert.ok(ownedStateFindings(f.root).some(row => row.file === 'packages/native/src/probe.ts' && row.rule === 'owned-state-raw-observation'));
  f.put('apps/oma/src/caller.ts', 'import { observe } from "@oma/native/probe"; export function run(input: string) { return observe(input); }');
  assert.deepEqual(ownedStateFindings(f.root), [], 'a user input does not acquire owned-state provenance');
});
test('M-004: workspace transaction bodies cannot hide asynchronous or filesystem effects', t => {
  const f = fixture(t, 'export {};');
  f.put('packages/native/src/transaction.ts', `import { fsyncSync } from 'node:fs';
    declare const ledger: { transaction(work: () => unknown): unknown };
    ledger.transaction(async () => { await Promise.resolve(); fsyncSync(1); });`);
  const findings = inspectTransactions(createArchitectureProgram(f.root), f.root);
  assert.ok(findings.some(row => row.file === 'packages/native/src/transaction.ts' && /Promise\/thenable/.test(row.message)));
  assert.ok(findings.some(row => /async\/await/.test(row.message)));
  assert.ok(findings.some(row => /filesystem/.test(row.message)));
});
