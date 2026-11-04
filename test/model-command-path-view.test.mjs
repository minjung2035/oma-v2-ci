/** The resident runtime uses literal physical paths without a model command. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { residentEnvironment } from '@oma/domain/resident-paths';

test("001. Resident environment retains the issued physical view without a model CLI", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oma-model-view-')));
  try {
    const work = join(root, '한 글자 " $(literal); space'); mkdirSync(work);
    const node = join(work, 'node executable');
    symlinkSync(process.execPath, node);
    const base = residentEnvironment({ libdir: work, node, home: work, temporary: work });
    assert.equal(base.OMA_NODE, node); assert.equal(base.OMA_CLI, undefined);
    assert.ok(Object.isFrozen(base));
    assert.throws(() => residentEnvironment({ libdir: '/entry\\name', node, home: work, temporary: work }), { code: 'UNSUPPORTED_PROFILE' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
