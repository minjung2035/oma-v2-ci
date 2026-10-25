import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEPLOYMENT_LAYOUT } from '@oma/domain/deployment';
import { assertWorkspaceResolution } from "#oma-test/app/runtime/assets";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-resolution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'node_modules/@oma'), { recursive: true });
  for (const workspace of DEPLOYMENT_LAYOUT.workspaces) {
    mkdirSync(join(root, workspace.root, 'dist'), { recursive: true });
    writeFileSync(join(root, workspace.root, 'package.json'), JSON.stringify({ name: workspace.name, version: '0.1.0',
      type: 'module', exports: { '.': './dist/index.js' } }));
    writeFileSync(join(root, workspace.root, 'dist/index.js'), 'export {};\n');
    symlinkSync(join(root, workspace.root), join(root, 'node_modules', workspace.name));
  }
  return root;
}
test('a new nested copy is refused even after the same installation was already verified', t => {
  const root = fixture(t);
  assertWorkspaceResolution(root);
  const foreign = join(root, 'packages/native/node_modules/@oma/domain');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'package.json'), JSON.stringify({ name: '@oma/domain', version: '0.1.0', main: 'index.js' }));
  writeFileSync(join(foreign, 'index.js'), 'module.exports = {};\n');
  const resolver = createRequire(join(root, 'packages/native/dist/probe.js'));
  assert.equal(resolver.resolve('@oma/domain'), join(foreign, 'index.js'), 'Node really chooses the second owner');
  assert.throws(() => assertWorkspaceResolution(root), { code: 'UNSUPPORTED_PROFILE' });
});
test('a nested link to the exact installation owner is accepted', t => {
  const root = fixture(t);
  const namespace = join(root, 'packages/native/node_modules/@oma');
  mkdirSync(namespace, { recursive: true });
  symlinkSync(join(root, 'packages/domain'), join(namespace, 'domain'));
  assert.doesNotThrow(() => assertWorkspaceResolution(root));
});
test('an unreadable module namespace is unknown and never certified as absent', t => {
  const root = fixture(t), modules = join(root, 'packages/native/node_modules');
  mkdirSync(modules, { recursive: true });
  chmodSync(modules, 0);
  try {
    assert.throws(() => assertWorkspaceResolution(root), { code: 'BROKER_UNAVAILABLE' });
  } finally { chmodSync(modules, 0o700); }
});
