/** Execute the Personal entry's production composition with controlled SDK owners. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { sourceWorld } from "./source-world.mjs";
import path from 'node:path';


const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function world({ fail, close, dispose, run, construct, catalog, beforeSwitch, sendError, resourceReload, moduleClose, needsTrust, trusted, packageResources, slot, platform } = {}) {
  const calls = [], hooks = {}, writes = [], commands = {}, picks = [];
  const birth = { id: 'personal-id', mode: 'personal', cwd: '/fixture/work', history: '/fixture/history' };
  const manager = { getCwd: () => birth.cwd, getSessionDir: () => birth.history };
  const session = { messages: [], sessionFile: '/fixture/history/current.jsonl', extensionRunner: {
    async emit(event) { calls.push(event.type); if (event.type === 'session_before_switch' && beforeSwitch) return beforeSwitch(event); return hooks[event.type]?.(event, context); },
  }, async abort() { calls.push('abort'); if (fail === 'abort') throw new Error('injected abort'); }, dispose() {} };
  const context = { cwd: birth.cwd, isIdle: () => true, ui: { addAutocompleteProvider(factory) { calls.push(['autocomplete', factory({})]); }, setStatus() {}, setHeader(factory) { factory?.({}, { fg: (_color, text) => text }).render(80); }, setFooter() {}, notify(...args) { calls.push(['notice', ...args]); },
    select(title, rows) { return new Promise(resolve => picks.push({ title, rows, choose: resolve })); },
    custom(factory) { return new Promise(resolve => picks.push(factory({ requestRender() {} }, {}, {}, resolve))); },
  } };
  const runtime = { session, services: undefined,
    async dispose() { calls.push('dispose'); await dispose?.(); if (fail === 'dispose') throw new Error('injected dispose'); await hooks.session_shutdown?.({ reason: 'quit' }, context); },
    async switchSession(file) { calls.push(['same-birth', file]); },
  };
  class Mode {
    constructor() { calls.push('mode'); construct?.(); if (fail === 'constructor') throw new Error('injected constructor'); }
    async run() {
      calls.push('run'); hooks.session_start({}, context);
      if (fail === 'init') throw new Error('injected init');
      if (run) await run({ runtime, mode: this, stdout, calls, hooks, commands });
      else { await runtime.dispose(); calls.push('upstream-exit'); }
    }
    hideThinkingBlock = true;
    renderProjectTrustWarningIfNeeded() {} suggestBugReport() {} crashReportInstructions() {}
    updateTerminalTitle() {} handleExportCommand() {} getPathCommandArgument() {} getCrashExtensionHint() {}
    showManagedToolStatus() {} showSessionSelector() {} getRegisteredToolDefinition() {} toggleThinkingBlockVisibility() {}
    stop() { calls.push('stop'); if (fail === 'stop') throw new Error('injected stop'); }
    async shutdown() { await runtime.dispose(); calls.push('upstream-exit'); }
    async handleFatalRuntimeError(_prefix, error) { calls.push(['upstream-fatal', error]); }
  }
  const originalWrite = function (chunk, ...args) { writes.push({ chunk, args, receiver: this }); return false; };
  const stdout = { write: originalWrite };
  const credentials = { modelRuntime: {}, async close() { calls.push('credentials-close'); await close?.(); if (fail === 'credentials') throw new Error('injected credentials'); } };
  const settingsManager = { applyOverrides() {} };
  class Loader {
    constructor(options) {
      this.options = options; this.loaded = false;
      this.result = { extensions: [{ path: '/fixture/open-tui', resolvedPath: '/fixture/open-tui/extensions/open-tui/index.ts' }], errors: [],
        runtime: { invalidate() { calls.push('resources-invalidate'); } } };
    }
    getExtensions() { return this.result; }
    async reload(options) { calls.push(['resources-reload', this.loaded]); await resourceReload?.(this, options); this.loaded = true; }
  }
  session.reload = async options => {
    hooks.session_shutdown({ reason: 'reload' }, context);
    await runtime.services.resourceLoader.reload(options);
    calls.push('resources-bound'); hooks.session_start({ reason: 'reload' }, context);
  };
  const dependencies = {
    "@earendil-works/pi-tui": { ProcessTerminal: class { setTitle(title) {} } },
    '@earendil-works/pi-ai': { getSupportedThinkingLevels: () => ['off', 'high'] },
    '@oma/domain/unseen-text': { UNSEEN: /[\x00-\x1f]/g },
    './pi-compat/commands.js': { PI_BUILTIN_COMMANDS: new Set() },
    './interactive-display.js': { safeToolPresentation: value => value },
    './pi-compat/interactive-tools.js': { withSearchTools: (current, cwd) => ({ current, cwd }) },
    './pi-compat/settings.js': { createEngineSettings: (_files, _cwd, _dir, opts) => Object.assign(settingsManager,
      { createOptions: opts, setProjectTrusted(value) { calls.push(['set-trusted', value]); } }) },
    'node:fs': { lstatSync: () => ({ isFile: () => true }), readFileSync: () => '{"version":"fixture-version"}' },
    'node:path': path, 'node:module': { createRequire: () => ({ resolve: () => '/fixture/open-tui/package.json' }) },
    '@earendil-works/pi-coding-agent': {
      VERSION: '1.0.1', InteractiveMode: Mode, DefaultResourceLoader: Loader,
      // C19: the fixture records the trust decision the entry would persist.
      ProjectTrustStore: class { constructor() { this.values = new Map(trusted === undefined ? [] : [[birth.cwd, trusted]]); } get(cwd) { return this.values.get(cwd); } set(cwd, value) { this.values.set(cwd, value); calls.push(['trust', cwd, value]); } },
      hasTrustRequiringProjectResources: () => needsTrust === true,
      async createAgentSessionRuntime(factory) {
        calls.push('runtime-create'); if (fail === 'runtime') throw new Error('injected runtime');
        const result = await factory({ cwd: birth.cwd, sessionManager: manager }); runtime.services = result.services; return runtime;
      },
      async createAgentSessionServices(options) {
        options.resourceLoaderOptions.extensionFactories[0]({ registerCommand(name, command) { commands[name] = command; }, registerShortcut() {}, on(event, handler) { hooks[event] = handler; },
          // BL2: the ask presenter subscribes the request seam on the bus; the
          // fixture only needs it reachable.
          events: { on() {}, emit() {} } });
        calls.push(['project-trusted', options.settingsManager.createOptions?.projectTrusted]);
        if (fail === 'services') throw new Error('injected services');
        const resourceLoader = new Loader(options.resourceLoaderOptions); resourceLoader.loaded = true;
        return { settingsManager, resourceLoader, diagnostics: [] };
      },
      async createAgentSessionFromServices() { if (fail === 'session') throw new Error('injected session'); return { session }; },
      SessionManager: { create: () => manager, open: () => manager, async listAll() { return []; } },
      SessionSelectorComponent: class { constructor(load, _all, choose, cancel, quit) { Object.assign(this, { load, choose, cancel, quit }); } },
      ModelSelectorComponent: class { constructor(_tui, _model, _runtime, _scoped, done) { calls.push('model-selector'); done(undefined); } },
      ThinkingSelectorComponent: class { constructor(_level, _levels, done) { done(undefined); } },
    },
    '@oma/domain/errors': { StoreError: class extends Error { constructor(code, message) { super(message); this.code = code; } } },
    // BL2: the Personal host resolves the bundled ask extension through the
    // deployment layout — the entry point path, not a user-supplied string.
    '@oma/domain/deployment': { DEPLOYMENT_LAYOUT: { extensionAsk: 'packages/extension/dist/ask-user-question.js' } },
    '../runtime/session-mode.js': { readSessionBirth: () => birth },
    '../runtime/session-catalog.js': { async sessionBirthForHistory(file) { return catalog ? catalog(file) : birth; }, sessionHistoryDirectories: () => [] },
    '../runtime/personal-settings.js': { personalExtensions: () => ({ extensions: [], missing: [] }), updatePersonalSettings: () => ({ extensions: [] }),
      personalExtensionEntry: input => path.isAbsolute(input) ? `local:${input}` : input },
    '../runtime/packages/index.js': { readPackageIndex: () => [], packageResourcePaths: () => packageResources },
    '@oma/domain/extension-paths': { verifiedPaths: () => [] },
    './extension-modules.js': { ExtensionModules: class {
      constructor() { calls.push('modules-create'); }
      refresh() { calls.push('modules-refresh'); }
      close() { calls.push('modules-close'); moduleClose?.(); }
    } },
    './pi-runtime.js': { PI_AGENT_DIR_ENV: 'PI_CODING_AGENT_DIR', preparePiRetry() {} },
    './pi-presentation.js': { preparePiInteractive() {} },
    './pi-compat/env.js': { PI_RESUME_HINT: 'To resume this session:' },
    '../runtime/personal-models.js': { personalModels: async () => credentials },
    '../runtime/society-slot.js': { checkSocietySlot(data, cwd) { calls.push(['slot', data, cwd]); return typeof slot === 'function' ? slot() : slot ?? { kind: 'free', society: 'fixture-society' }; } },
    '@oma/protocol/guest-history': { isGuestHistoryReference: value => value.startsWith('oma-guest-history:') },
    '../platform/host/guest-histories.js': { async inspectMacGuestHistory() { calls.push('guest-history'); },
      async listMacGuestHistories() { return []; } },
    './open-tui-brand.js': { brandHeader(lines, brand) { calls.push(['brand', brand.version]); return lines; }, brandFooter: lines => lines },
    // BL2: the ask presenter hooks the bus and session events; the fixture's
    // extension api only needs the registration to be reachable.
    '@oma/tui/ask-user-question/presenter': { registerAskUserQuestionPresenter(pi, deps) { calls.push('ask-presenter'); } },
  };
  const process = { argv: ['node', 'entry', '--root', '/fixture/root', '--data-root', '/fixture/data', '--libdir', '/fixture/install', '--packages', '/fixture/packages'],
    platform: platform ?? 'linux',
    env: { PI_CODING_AGENT_DIR: '/fixture/engine' }, cwd: () => birth.cwd, stdout, stderr: { write() {} }, send(message, done) { calls.push(['switch', message]); done(sendError); } };
  const module = { exports: sourceWorld("personal.ts", dependencies, { URL, process }, "file:///fixture/apps/oma/dist/entry/pi-personal.js") };
  const input = { birth, agentDir: '/fixture/engine', libdir: '/fixture/install', version: 'fixture-version' };
  const ports = { settings: {}, assertExtensions() {},
    presentation: { ...dependencies['./open-tui-brand.js'],
      registerQuestions: dependencies['@oma/tui/ask-user-question/presenter'].registerAskUserQuestionPresenter },
    extensions: { load: () => ({ extensions: [], missing: [] }), readSelection: () => ({ extensions: [] }),
      availableEntries: () => [], entry: dependencies['../runtime/personal-settings.js'].personalExtensionEntry,
      select() {}, resources: () => packageResources },
    history: { target: file => catalog ? catalog(file) : Promise.resolve(birth), directories: () => [],
      inspectGuest: dependencies['../platform/host/guest-histories.js'].inspectMacGuestHistory,
      listGuests: async () => [] }, acquireCredentials: async () => credentials };
  return { main: () => module.exports.runPersonal(input, ports), runtime, session, calls, hooks, commands, picks, context, stdout, originalWrite, writes };
}

test('Personal engine: credential helper close is awaited before upstream direct exit and disposal runs once', async () => {
  let finish;
  const w = world({ close: () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  assert.equal(w.calls.includes('credentials-close'), true); assert.equal(w.calls.includes('upstream-exit'), false);
  finish(); await main;
  assert.equal(w.calls.filter(value => value === 'dispose').length, 1);
  assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1);
  assert.ok(w.calls.indexOf('abort') < w.calls.indexOf('dispose'));
  assert.ok(w.calls.indexOf('credentials-close') < w.calls.indexOf('upstream-exit'));
  assert.equal(w.stdout.write, w.originalWrite);
});
for (const failure of ['runtime', 'services', 'session', 'constructor', 'init', 'stop', 'abort', 'dispose', 'credentials']) {
  test(`Personal engine: ${failure} failure still returns every acquired owner and preserves the failure`, async () => {
    const w = world({ fail: failure, run: failure === 'stop' ? async () => {} : undefined });
    await assert.rejects(w.main(), error => error.message.includes(`injected ${failure}`) || error.errors?.some(item => item.message.includes(`injected ${failure}`)));
    assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1);
    assert.equal(w.calls.filter(value => value === 'modules-close').length, 1);
    if (['constructor', 'init', 'stop', 'abort', 'dispose', 'credentials'].includes(failure)) assert.equal(w.calls.filter(value => value === 'dispose').length, 1);
    if (failure === 'session') assert.equal(w.calls.filter(value => value === 'resources-invalidate').length, 1);
    assert.equal(w.stdout.write, w.originalWrite);
    if (['abort', 'dispose', 'credentials'].includes(failure)) assert.equal(w.calls.includes('upstream-exit'), false);
  });
}
test('Personal engine: exit-hint substitution forwards write callback, receiver and backpressure, then restores the writer', async () => {
  const callback = () => {};
  const w = world({ run: async ({ stdout }) => {
    assert.equal(stdout.write('To resume this session: old pi command\n', 'utf8', callback), false);
    assert.equal(stdout.write('ordinary\n', callback), false);
  } });
  await w.main();
  assert.equal(w.writes[0].chunk, 'Reopen this Personal session with oma --resume /fixture/history/current.jsonl\n');
  assert.deepEqual(w.writes[0].args, ['utf8', callback]); assert.equal(w.writes[0].receiver, w.stdout);
  assert.deepEqual(w.writes[1].args, [callback]); assert.equal(w.stdout.write, w.originalWrite);
});
test('Personal engine: initialization and cleanup failures remain visible together', async () => {
  const w = world({ fail: 'init', dispose: async () => { throw new Error('injected disposal too'); }, close: async () => { throw new Error('injected close too'); } });
  await assert.rejects(w.main(), error => {
    const messages = value => [value.message, ...(value.errors ?? []).flatMap(messages)];
    const all = messages(error); return ['injected init', 'injected disposal too', 'injected close too'].every(message => all.includes(message));
  });
  assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1); assert.equal(w.stdout.write, w.originalWrite);
});
for (const target of ['same', 'cross']) test(`Personal engine: pending ${target}-birth admission cannot revive an ended or replaced context`, async () => {
  let admit, finish;
  const w = world({ catalog: () => new Promise(resolve => { admit = resolve; }), run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush(); const pending = w.runtime.switchSession('/fixture/other.jsonl'); await flush();
  w.hooks.session_shutdown({ reason: 'resume' }, w.context); w.hooks.session_start({}, w.context);
  admit({ id: target === 'same' ? 'personal-id' : 'other', mode: 'personal' }); await pending;
  assert.equal(w.calls.some(value => Array.isArray(value) && ['same-birth', 'switch'].includes(value[0])), false);
  assert.equal(w.calls.includes('session_before_switch'), false); finish(); await main;
});
for (const reason of ['new', 'resume']) test(`Personal engine: ${reason} is serialized and a stale before-switch callback cannot transition`, async () => {
  let accept, finish, requests = 0;
  const w = world({ catalog: async () => ({ id: 'other', mode: 'personal' }), beforeSwitch: () => ++requests === 1 ? new Promise(resolve => { accept = resolve; }) : { cancel: true },
    run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush(); const pending = reason === 'new' ? w.runtime.newSession() : w.runtime.switchSession('/fixture/other.jsonl'); await flush();
  const duplicate = await w.runtime.newSession(); assert.equal(duplicate.cancelled, true);
  assert.equal(w.calls.filter(value => value === 'session_before_switch').length, 1);
  w.hooks.session_shutdown({ reason: 'reload' }, w.context); w.hooks.session_start({}, w.context); accept({ cancel: false }); await pending;
  assert.equal(w.calls.some(value => Array.isArray(value) && value[0] === 'switch'), false); finish(); await main;
});
for (const cancel of [true, false]) test(`Personal engine: explicit before-switch cancel=${cancel} preserves the host transition meaning`, async () => {
  let finish;
  const w = world({ beforeSwitch: async () => ({ cancel }), run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush(); await w.runtime.newSession();
  assert.equal(w.calls.filter(value => Array.isArray(value) && value[0] === 'switch').length, cancel ? 0 : 1);
  assert.equal(w.calls.includes('upstream-exit'), !cancel); finish(); await main;
});
test('Personal engine: an IPC send failure returns the transition slot for an explicit retry', async () => {
  let finish;
  const problem = new Error('injected send'), w = world({ sendError: problem, run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  await assert.rejects(w.runtime.newSession(), error => error === problem);
  await assert.rejects(w.runtime.newSession(), error => error === problem);
  assert.equal(w.calls.filter(value => Array.isArray(value) && value[0] === 'switch').length, 2);
  assert.equal(w.calls.includes('upstream-exit'), false); finish(); await main;
});
test('Personal engine: an old resume selector cannot quit its replacement', async () => {
  let finish;
  const w = world({ run: async ({ mode }) => { mode.showSessionSelector(); await new Promise(resolve => { finish = resolve; }); } });
  const main = w.main(); await flush(); const selector = w.picks[0];
  w.hooks.session_shutdown({ reason: 'reload' }, w.context); w.hooks.session_start({}, w.context); selector.quit(); await flush();
  assert.equal(w.calls.includes('dispose'), false); assert.equal(w.calls.includes('upstream-exit'), false); finish(); await main;
});
test('Personal engine: reload uses a previously loaded cache owner before replacing its resource set', async () => {
  const w = world({ run: async ({ runtime }) => { await runtime.session.reload(); } });
  await w.main();
  assert.equal(w.calls.find(value => Array.isArray(value) && value[0] === 'resources-reload')?.[1], true);
  assert.equal(w.calls.includes('resources-bound'), true);
  assert.equal(w.calls.filter(value => value === 'modules-refresh').length, 1);
  assert.ok(w.calls.indexOf('modules-refresh') < w.calls.findIndex(value => Array.isArray(value) && value[0] === 'resources-reload'));
});
test('Personal engine: rejected reload returns its candidate and awaits helper close before fatal exit', async () => {
  let finish, end;
  const problem = new Error('injected resource reload');
  const w = world({ close: () => new Promise(resolve => { finish = resolve; }), resourceReload: async () => { throw problem; },
    run: async ({ runtime }) => { await runtime.session.reload(); } });
  const main = w.main().catch(error => { end = error; }); await flush();
  assert.equal(w.calls.includes('credentials-close'), true);
  assert.equal(w.calls.some(value => Array.isArray(value) && value[0] === 'upstream-fatal'), false);
  finish(); await main;
  assert.equal(end, problem);
  assert.equal(w.calls.includes('resources-bound'), false);
  assert.equal(w.calls.filter(value => value === 'resources-invalidate').length, 1);
  assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1);
  assert.ok(w.calls.some(value => Array.isArray(value) && value[0] === 'upstream-fatal' && value[1] === problem));
});
test('Personal engine: extension replacement failure returns owners before upstream fatal exit', async () => {
  let finish, done;
  const w = world({ close: () => new Promise(resolve => { finish = resolve; }), run: async ({ mode }) => {
    await mode.handleFatalRuntimeError('Failed to fork session', new Error('injected replacement')); done = true;
  } });
  const main = w.main(); await flush();
  assert.equal(w.calls.includes('credentials-close'), true); assert.equal(done, undefined);
  finish(); await main;
  assert.equal(w.calls.filter(value => value === 'dispose').length, 1);
  assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1);
});
test('Personal engine: /society opens the mode choice only when requested and hands Society to the host', async () => {
  let finish;
  const w = world({ run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  assert.equal(w.picks.length, 0, 'startup has no mode picker');
  const choosing = w.commands.society.handler('', w.context); await flush();
  assert.equal(w.picks[0].title, 'Session mode — Personal');
  assert.deepEqual(Array.from(w.picks[0].rows), ['Personal', 'Society']);
  w.picks[0].choose('Society'); await choosing;
  const sent = w.calls.find(value => Array.isArray(value) && value[0] === 'switch');
  assert.equal(sent?.[1]?.type, 'switch'); assert.equal(sent?.[1]?.mode, 'society');
  assert.equal(sent?.[1]?.session, undefined); assert.equal(sent?.[1]?.society, undefined);
  assert.equal(w.calls.includes('upstream-exit'), true);
  finish(); await main;
});
for (const condition of ['conversation', 'busy', 'cancel', 'same-mode', 'stale']) {
  test(`Personal engine: ${condition} keeps the current mode and writer`, async () => {
    let finish;
    const w = world({ run: async () => new Promise(resolve => { finish = resolve; }) });
    const main = w.main(); await flush();
    if (condition === 'conversation') w.session.messages.push({ role: 'user' });
    if (condition === 'busy') w.context.isIdle = () => false;
    const choosing = w.commands.society.handler('', w.context); await flush();
    if (condition === 'stale') w.hooks.session_shutdown({ reason: 'reload' }, w.context);
    if (w.picks.length) w.picks[0].choose(condition === 'same-mode' ? 'Personal' : condition === 'stale' ? 'Society' : undefined);
    await choosing;
    assert.equal(w.calls.some(value => Array.isArray(value) && value[0] === 'switch'), false);
    assert.equal(w.calls.includes('upstream-exit'), false);
    finish(); await main;
  });
}
test('Personal engine: Mac mode switch returns to the host Society route', async () => {
  let finish;
  const w = world({ platform: 'darwin', run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  await w.commands.society.handler('society', w.context);
  assert.equal(w.calls.find(value => Array.isArray(value) && value[0] === 'switch')?.[1]?.mode, 'society');
  finish(); await main;
});
test('Personal engine: a cancelled before-switch keeps the /society session Personal', async () => {
  let finish;
  const w = world({ beforeSwitch: async () => ({ cancel: true }), run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  await w.commands.society.handler('society', w.context);
  assert.equal(w.calls.some(value => Array.isArray(value) && value[0] === 'switch'), false);
  assert.equal(w.calls.includes('upstream-exit'), false);
  finish(); await main;
});
test('Personal engine: a second /society while one is transitioning cannot double-enter', async () => {
  let finish, accept;
  const w = world({ beforeSwitch: () => new Promise(resolve => { accept = resolve; }),
    run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  const first = w.commands.society.handler('society', w.context); await flush();
  await w.commands.society.handler('society', w.context);
  assert.equal(w.calls.filter(value => value === 'session_before_switch').length, 1);
  accept({ cancel: false }); await first;
  assert.equal(w.calls.filter(value => Array.isArray(value) && value[0] === 'switch').length, 1);
  finish(); await main;
});
test('Personal engine: an IPC send failure on /society returns the transition slot for an explicit retry', async () => {
  let finish;
  const problem = new Error('injected send'), w = world({ sendError: problem, run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  await assert.rejects(w.commands.society.handler('society', w.context), error => error === problem);
  await assert.rejects(w.commands.society.handler('society', w.context), error => error === problem);
  assert.equal(w.calls.filter(value => Array.isArray(value) && value[0] === 'switch').length, 2);
  assert.equal(w.calls.includes('upstream-exit'), false); finish(); await main;
});
test('Personal engine: module-hook cleanup failure still closes credentials and retains the startup failure', async () => {
  const cleanup = new Error('injected module cleanup');
  const w = world({ fail: 'init', moduleClose: () => { throw cleanup; } });
  await assert.rejects(w.main(), error => error.name === 'AggregateError' && error.errors.some(item => item.message === 'injected init') && error.errors.includes(cleanup));
  assert.equal(w.calls.filter(value => value === 'modules-close').length, 1);
  assert.equal(w.calls.filter(value => value === 'credentials-close').length, 1);
  assert.ok(w.calls.indexOf('modules-close') < w.calls.indexOf('credentials-close'));
  assert.equal(w.stdout.write, w.originalWrite);
});
test('Personal engine: branding reads the installed package version rather than a second literal', async () => {
  let finish;
  const w = world({ run: async () => new Promise(resolve => { finish = resolve; }) });
  const main = w.main(); await flush();
  w.context.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
  assert.ok(w.calls.some(value => Array.isArray(value) && value[0] === 'brand' && value[1] === 'fixture-version'));
  finish(); await main;
});
test('#6: Personal registers only its own command -- the engine keeps /import and the rest of its surface', async () => {
  let loader;
  const w = world({ run: async ({ runtime }) => { loader = runtime.services.resourceLoader; } });
  await w.main();
  assert.deepEqual(Object.keys(w.commands), ['oma', 'society'], 'Personal must not shadow an engine command');
  assert.equal(w.commands.import, undefined, '/import stays the engine\'s own');
  const options = loader.options;
  // Extensions stay pinned to the selected files; every other resource
  // surface is the engine's ordinary discovery -- no suppression options.
  assert.equal(options.noExtensions, true);
  for (const key of Object.keys(options))
    assert.ok(!/^(no|disable|exclude)/i.test(key) || key === 'noExtensions',
      `a suppressed resource surface reached Personal: ${key}`);
});
test('C18: Personal loads the installed packages\' skills, prompt templates and themes, as the Society engines do', async () => {
  const packageResources = { skills: ['/store/npm/pkg/skills/roll/SKILL.md'], prompts: ['/store/npm/pkg/prompts/review.md'], themes: ['/store/npm/pkg/themes/dark.json'] };
  let loader;
  const w = world({ packageResources, run: async ({ runtime }) => { loader = runtime.services.resourceLoader; } });
  await w.main();
  // The loader options are vm-realm arrays (the entry is transpiled and run in
  // a Script context), so copy them out before a strict structural compare.
  assert.deepEqual(Array.from(loader.options.additionalSkillPaths), packageResources.skills);
  assert.deepEqual(Array.from(loader.options.additionalPromptTemplatePaths), packageResources.prompts);
  assert.deepEqual(Array.from(loader.options.additionalThemePaths), packageResources.themes);
  // No store means no flags: the keys stay absent, not empty lists.
  let bare;
  const none = world({ run: async ({ runtime }) => { bare = runtime.services.resourceLoader; } });
  await none.main();
  for (const key of ['additionalSkillPaths', 'additionalPromptTemplatePaths', 'additionalThemePaths'])
    assert.equal(Object.hasOwn(bare.options, key), false, `${key} present without package resources`);
});

test('C19: Personal\'s project trust is the recorded decision -- never silent, never default', async () => {
  for (const [needsTrust, trusted, expected] of [
    [false, undefined, true],   // nothing gated: trivially trusted, as Pi itself rules
    [true, undefined, false],   // gated folder, no recorded decision: untrusted
    [true, true, true],         // the Human trusted this folder
    [true, false, false],       // the Human explicitly untrusted it
  ]) {
    const w = world({ needsTrust, trusted });
    await w.main();
    assert.deepEqual(w.calls.filter(c => Array.isArray(c) && c[0] === 'project-trusted'),
      [['project-trusted', expected]], `needsTrust=${needsTrust} trusted=${trusted}`);
  }
});
test('C19: the trust row appears only for a folder holding gated resources, and persists then applies', async () => {
  // No gated resources: the menu offers no trust row, so there is nothing
  // the decision would change.
  let w = world({ needsTrust: false, run: async ({ commands }) => { await commands.oma.handler('', w.context); } });
  let done = w.main(); await flush();
  assert.deepEqual([...w.picks[0].rows].map(String), ['Model / effort', 'Extensions', 'Back']);
  w.picks[0].choose('Back');
  await done;

  // A gated folder, untrusted: the row is offered; choosing trust persists the
  // decision, applies it to the live settings manager and reloads.
  w = world({ needsTrust: true, trusted: undefined, run: async ({ commands }) => { await commands.oma.handler('', w.context); } });
  done = w.main(); await flush();
  assert.equal(w.picks[0].rows.some(row => String(row).startsWith('Project trust')), true);
  w.picks[0].choose(w.picks[0].rows.find(row => String(row).startsWith('Project trust')));
  await flush();
  // The prompt promises only what trusting does: .pi settings and resources.
  // Extension discovery is pinned (noExtensions), so a project extension is
  // never loaded -- the words must not claim otherwise.
  assert.doesNotMatch(String(w.picks[1].title), /execute project extensions/);
  assert.match(String(w.picks[1].title), /settings and resources/);
  assert.match(String(w.picks[1].title), /never loads a project extension/);
  assert.match(String(w.picks[1].title), /[Ee]xtensions stay pinned/);
  w.picks[1].choose('Trust this project');
  await done;
  assert.deepEqual(w.calls.filter(c => Array.isArray(c) && c[0] === 'trust'), [['trust', '/fixture/work', true]]);
  assert.deepEqual(w.calls.filter(c => Array.isArray(c) && c[0] === 'set-trusted'), [['set-trusted', true]]);
  assert.equal(w.calls.includes('resources-bound'), true, 'the session reloads so the loader re-resolves with it');
});
