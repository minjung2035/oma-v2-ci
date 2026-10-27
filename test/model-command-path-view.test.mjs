/** Execute the actual generated script under this OS; argv/path characters
 * remain literal, and a missing explicit view is refused before execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelCommandScript, residentEnvironment } from '@oma/domain/resident-paths';

test('model command uses the issued physical view and passes shell metacharacters literally', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oma-model-view-')));
  try {
    const work = join(root, '한 글자 " $(literal); space'); mkdirSync(work);
    const node = join(work, 'node executable'), cli = join(work, 'cli entry.mjs'), script = join(work, 'oma');
    symlinkSync(process.execPath, node);
    writeFileSync(cli, `process.stdout.write(JSON.stringify(process.argv.slice(2)));`);
    writeFileSync(script, modelCommandScript(), { mode: 0o700 });
    const args = ['arg with spaces', '$(must-not-execute);"', 'line\nbreak', '\\backslash', '--option'];
    const env = { HOME: work, PATH: '/usr/bin:/bin', OMA_NODE: node, OMA_CLI: cli };
    const result = spawnSync(script, args, { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
    for (const patch of [{ OMA_NODE: undefined }, { OMA_CLI: undefined }, { OMA_NODE: 'node' }, { OMA_CLI: 'relative.js' }, { OMA_CLI: '/entry\\name/cli.js' }]) {
      const refused = spawnSync(script, args, { env: { ...env, ...patch }, encoding: 'utf8', timeout: 10000 });
      assert.equal(refused.signal, null); assert.equal(refused.status, 125); assert.equal(refused.stdout, '');
    }
    const base = residentEnvironment({ libdir: work, node, home: work, temporary: work });
    assert.equal(base.OMA_NODE, node); assert.ok(base.OMA_CLI.startsWith(work + '/'));
    assert.ok(Object.isFrozen(base));
    assert.throws(() => residentEnvironment({ libdir: '/entry\\name', node, home: work, temporary: work }), { code: 'UNSUPPORTED_PROFILE' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
