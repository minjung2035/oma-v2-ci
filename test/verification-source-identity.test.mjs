/** #20: exercise the real lane runner with controlled build/test inputs, not a product-runtime qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { VERIFICATION_INPUT_ROOTS } from '../scripts/source-digest.mjs';

for (const mutation of ['none', 'change', 'add', 'delete'])
  test(`001. The real runner ${mutation === 'none' ? 'qualifies unchanged inputs' : `refuses an input ${mutation} during a passing test`}`, () => {
    const base = mkdtempSync(join(tmpdir(), 'oma-verification-identity-'));
    const root = join(base, 'project'), output = join(base, 'evidence');
    const put = (name, bytes) => { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
    try {
      for (const name of VERIFICATION_INPUT_ROOTS) {
        if (['apps', 'packages', 'test', 'scripts', 'implementation', 'docs', '.github/workflows'].includes(name))
          mkdirSync(join(root, name), { recursive: true });
        else put(name, '{}\n');
      }
      put('README.md', '# Controlled runner fixture\n');
      put('package.json', JSON.stringify({ type: 'module', scripts: { build: 'node scripts/fixture-build.mjs' } }));
      put('test/fixture.test.ts', '// Inventory counterpart of the controlled compiled fixture.\n');
      const action = mutation === 'change' ? `fs.appendFileSync('README.md', 'changed after binding\\n');`
        : mutation === 'add' ? `fs.writeFileSync('apps/new-input.ts', '// added after binding\\n');`
          : mutation === 'delete' ? `fs.unlinkSync('README.md');` : '';
      const fixture = `import test from 'node:test'; import fs from 'node:fs'; test('source-identity fixture', () => { ${action} });\n`;
      put('scripts/fixture-build.mjs', `import fs from 'node:fs'; fs.mkdirSync('dist/test', {recursive:true}); fs.writeFileSync('dist/test/fixture.test.js', ${JSON.stringify(fixture)});\n`);
      put('scripts/verify-lane.mjs', readFileSync(new URL('../scripts/verify-lane.mjs', import.meta.url)));
      for (const name of ['source-digest', 'exploration-parameters', 'check-modules'])
        put(`scripts/${name}.mjs`, `export * from ${JSON.stringify(new URL(`../scripts/${name}.mjs`, import.meta.url).href)};\n`);
      put('scripts/verification-lanes.mjs', `export {evaluateExecution} from ${JSON.stringify(new URL('../scripts/verification-lanes.mjs', import.meta.url).href)};
export const lanes={fixture:{proof:'Controlled runner oracle only',environment:'node',files:['fixture.test.js'],sourceFiles:[],requiredNames:['source-identity fixture'],timeoutSeconds:10}};\n`);
      put('scripts/local-test-guard.mjs', `import ${JSON.stringify(new URL('../scripts/local-test-guard.mjs', import.meta.url).href)};\n`);
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
      const child = spawnSync(process.execPath, ['scripts/verify-lane.mjs', 'fixture', '--out', output], {
        cwd: root, encoding: 'utf8', timeout: 20000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: base },
      });
      assert.equal(child.error, undefined, child.stderr);
      const report = JSON.parse(readFileSync(join(output, 'result.json'), 'utf8'));
      assert.equal(report.execution, 'EXECUTED', child.stderr);
      assert.equal(report.runtime.status, 'PASS', JSON.stringify(report));
      assert.equal(report.status, mutation === 'none' ? 'PASS' : 'FAIL');
      assert.equal(child.status, mutation === 'none' ? 0 : 1);
      if (mutation === 'delete') assert.match(report.failure, /post-execution source identity could not be observed/);
      else {
        assert.deepEqual(report.sourceChanges, mutation === 'none' ? [] : [mutation === 'add' ? 'apps/new-input.ts' : 'README.md']);
        if (mutation !== 'none') assert.match(report.failure, /verification inputs changed during execution/);
      }
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
