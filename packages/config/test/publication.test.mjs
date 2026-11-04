import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultHostConfig } from '@oma/config/defaults';
import { loadConfig, validateConfig } from '@oma/config';
import { createInlineConfiguration } from '@oma/config/generations';
import { assertHostDirectoryLayout } from '@oma/native/directory-layout';

const candidate = () => defaultHostConfig({ society: 'demo', node: process.execPath, libdir: '/opt/oma',
   deploymentDigest: 'a'.repeat(64) });
test("001. Published configuration is reloadable and a second create preserves its committed bytes", () => {
  const root = mkdtempSync(join(tmpdir(), 'oma-config-package-'));
  const file = join(root, 'config.json');
  try {
    const value = validateConfig(candidate());
    assert.equal(createInlineConfiguration(file, value), 'created');
    const before = readFileSync(file);
    assert.deepEqual(loadConfig(file), value);
    assert.equal(createInlineConfiguration(file, validateConfig({ ...candidate(), society: 'other' })), 'existing');
    assert.deepEqual(readFileSync(file), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("002. The validator snapshots input and rejects unknown top-level fields before publication", () => {
  const input = candidate();
  const value = validateConfig(input);
  input.initialResidents[0].brief = 'changed outside';
  assert.notEqual(value.initialResidents[0].brief, input.initialResidents[0].brief);
  assert.equal(Object.isFrozen(value.initialResidents[0]), true);
  assert.throws(() => validateConfig({ ...candidate(), unknown: true }), { code: 'INVALID_REQUEST' });
  const profile = candidate();
  profile.agentProfiles.resident.upstreamNote = { defaultMode: 'DIRECT' };
  assert.throws(() => validateConfig(profile), /agentProfiles\.resident\.upstreamNote unknown/);
});
test("003. The installation root is judged by the rule its consumers judge it by, and the installation's own spelling still publishes", () => {
  const withLibdir = (libdir) => ({ ...candidate(), installation: { ...candidate().installation, libdir } });
  // runtime/assets.ts `runtimeAssets` and native/directory-layout refuse these;
  // an inline config.json has no other judge, so accepting one would commit a
  // settings file the runtime refuses (and a project settings bundle the
  // operations loader refuses: installation.libdir must be absolute).
  for (const libdir of ['opt/oma', '/opt/oma//', '/opt/oma/./sub', '/'])
    assert.throws(() => validateConfig(withLibdir(libdir)),
      (error) => error.code === 'INVALID_REQUEST' && error.message.includes('installation.libdir'),
      `the validator accepted installation.libdir ${libdir}`);
  assert.throws(() => assertHostDirectoryLayout('opt/oma', true), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => assertHostDirectoryLayout('/opt/oma//', true), { code: 'UNSUPPORTED_PROFILE' });
  // `${libdir}/` is how the product writes the installation a session runs
  // from: a normalized absolute directory that stays accepted and publishes.
  const root = mkdtempSync(join(tmpdir(), 'oma-config-root-'));
  const file = join(root, 'config.json');
  try {
    assert.equal(createInlineConfiguration(file, validateConfig(withLibdir('/opt/oma/'))), 'created');
    assert.equal(loadConfig(file).installation.libdir, '/opt/oma/');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
