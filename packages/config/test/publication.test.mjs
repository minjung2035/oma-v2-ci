import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultHostConfig } from '@oma/config/defaults';
import { loadConfig, validateConfig } from '@oma/config';
import { createInlineConfiguration } from '@oma/config/generations';

const candidate = () => defaultHostConfig({ society: 'demo', node: process.execPath, libdir: '/opt/oma',
   deploymentDigest: 'a'.repeat(64) });
test('published configuration is reloadable and a second create preserves its committed bytes', () => {
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
test('the validator snapshots input and rejects unknown top-level fields before publication', () => {
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
