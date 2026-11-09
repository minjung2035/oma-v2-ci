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

for (const [option, value] of [['--model', 'missing/model'], ['--thinking', 'invalid']])
  test(`002. Invalid ${option} releases extensions already loaded during service creation`, async () => {
    let invalidated = 0;
    const services = { resourceLoader: { reload: async () => {},
      getExtensions: () => ({ runtime: { invalidate() { invalidated++; } } }) },
      modelRuntime: { getModel: () => undefined }, diagnostics: [] };
    const sdk = {
      createAgentSessionRuntime: factory => factory({ sessionManager: {} }),
      createAgentSessionServices: async () => services,
      createAgentSessionFromServices: async () => { assert.fail('invalid settings cannot create a session'); },
      SessionManager: { continueRecent: () => ({}) },
    };
    const { startInteractiveRuntime } = sourceWorld('interactive-runtime.ts', {
      '@earendil-works/pi-coding-agent': sdk,
      '@oma/domain/settings': { EFFORT_LEVELS: ['off', 'high'] },
      './pi-compat/settings.js': { createEngineSettings() {} },
    }, { process: { env: {} } });
    const argv = [option, value];
    const config = { cwd: '/work', agentDir: '/agent', argv,
      flag: name => argv[argv.indexOf(name) + 1], flags: () => [] };
    await assert.rejects(startInteractiveRuntime({ settings: {} }, config, {}, {}, { refresh() {} }, [], '/upstream', () => {}, '/sessions'), /configured .* unavailable/);
    assert.equal(invalidated, 1, 'failed startup must invalidate the loaded extension runtime');
  });
