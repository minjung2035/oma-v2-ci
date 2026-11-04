import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceWorld } from './source-world.mjs';

for (const thinking of [undefined, 'off', 'high']) test(`001. Interactive session receives explicit effort ${thinking ?? '(engine default)'}`, async () => {
  const argv = thinking === undefined ? [] : ['--thinking', thinking];
  const calls = [];
  const session = { reload: async () => {} };
  const services = { resourceLoader: { reload: async () => {} }, diagnostics: [] };
  const sdk = {
    createAgentSessionRuntime: factory => factory({ sessionManager: {} }),
    createAgentSessionServices: async () => services,
    createAgentSessionFromServices: async options => { calls.push(options); return { session }; },
    SessionManager: { continueRecent: () => ({}) },
  };
  const { startInteractiveRuntime } = sourceWorld('interactive-runtime.ts', {
    '@earendil-works/pi-coding-agent': sdk,
    '@oma/domain/settings': { EFFORT_LEVELS: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
    './pi-compat/settings.js': { createEngineSettings() {} },
  }, { process: { env: {} } });
  const config = { cwd: '/work', agentDir: '/agent', argv,
    flag: name => argv[argv.indexOf(name) + 1], flags: () => [] };
  await startInteractiveRuntime({ settings: {} }, config, {}, {}, { refresh() {} }, [], '/upstream', () => {}, '/sessions');
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], 'thinkingLevel'), thinking !== undefined,
    'omission must not pin a default over engine/session settings');
  assert.equal(calls[0].thinkingLevel, thinking);
});
