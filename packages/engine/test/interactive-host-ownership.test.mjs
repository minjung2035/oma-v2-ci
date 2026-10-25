import { PI_BOUNDARY_PREFIX } from "@oma/protocol/delivery-boundary";
// DR27: run the interactive host, substituting engine/stream boundaries, not its UI lifetime.
import test from 'node:test';
import { adaptInteractiveUi } from "@oma/engine/pi-compat/interactive-ui";
import assert from 'node:assert/strict';

import { sourceWorld } from "./source-world.mjs";
import path from 'node:path';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function world({ setModel, init, resourceReload, dispose, fail, moduleClose, observe } = {}) {
  const timers = new Set(), channels = [], hooks = {}, sent = [], picks = [], changes = [], signals = [], commands = {}, modules = [], notices = [],
    modes = [], overrides = [];
  const session = { messages: [], extensionRunner: { async emit() { return {}; } }, model: { id: 'initial', provider: 'fake' }, thinkingLevel: 'off',
    modelRuntime: {}, scopedModels: [], sessionManager: {},
    subscribe() { return () => {}; },
    async abort() { modules.push('abort'); },
    async reload(options) { hooks.session_shutdown({ reason: 'reload' }); await resourceLoader.reload(options); hooks.session_start({}, context); },
    async setModel(model) { changes.push(['model', model.id]); this.model = model; await setModel?.(); },
    getAvailableThinkingLevels() { return ['off', 'high']; },
    setThinkingLevel(level) { changes.push(['effort', level]); this.thinkingLevel = level; },
  };
  const context = { cwd: '/work', isIdle: () => true, ui: {
    addAutocompleteProvider(factory) { assert.equal(factory({}).cwd, '/work'); },
    setEditorComponent(factory) { factory({}, {}, {}); }, setHeader() {}, setFooter() {}, notify(message, level) { notices.push([message, level]); },
    // B3: the host mirrors OMA's waiting queue above the editor; the fixture
    // keeps the seam, not the widget.
    setWidget() {},
    custom(factory) { return new Promise(resolve => {
      const component = factory({ terminal: { columns: 80, rows: 24 }, requestRender() {} }, {}, {}, resolve);
      picks.push(component);
    }); },
    select() { return new Promise(resolve => picks.push({ kind: 'worker-kind', choose: resolve })); },
  } };
  class InteractiveMode {
    async init() { hooks.session_start({}, context); context.ui.setEditorComponent(() => ({})); await init?.({ hooks, channels }); }
    constructor() { modes.push(this); if (fail === 'constructor') throw new Error('injected constructor'); }
    hideThinkingBlock = true;
    shutdown() {} renderProjectTrustWarningIfNeeded() {} suggestBugReport() {} crashReportInstructions() {}
    updateTerminalTitle() {} getPathCommandArgument() {} showSessionSelector() {} toggleThinkingBlockVisibility() {}
    stop() {}
    async handleFatalRuntimeError(_prefix, error) { modules.push(['fatal', error]); }
    handleExportCommand() {} getCrashExtensionHint() {} showManagedToolStatus() {}
    // The engine's own render lookup: the registry's definition, merged with
    // its built-in renderers. The fixture keeps it plainly readable.
    getRegisteredToolDefinition(name) { return this.engineDefinitions?.[name]; }
  }
  const resourceLoader = { async reload(options) { modules.push('resources-reload'); await resourceReload?.(options); },
    getExtensions: () => ({ runtime: { invalidate() { modules.push('resources-invalidate'); } } }) };
  const runtime = { session, async switchSession(path) { changes.push(['switch', path]); }, services: { resourceLoader },
    async dispose() { modules.push('dispose'); hooks.session_shutdown({ reason: 'quit' }); await dispose?.(); } };
  const dependencies = {
    "@earendil-works/pi-tui": { ProcessTerminal: class { setTitle(title) {} } },
    "@oma/protocol/delivery-boundary": { PI_BOUNDARY_PREFIX },
    './pi-compat/interactive-tools.js': { withSearchTools: (current, cwd) => ({ current, cwd }) },
    'node:net': { Socket: class {} }, 'node:fs': { readFileSync: () => '{"version":"test"}' },
    // w10's in-process Client preload is a side-effect import; the mocked
    // boundaries below never reach it, so the install itself is a no-op here.
    '../runtime/client-preload.js': {},
    '@earendil-works/pi-ai': { getSupportedThinkingLevels: () => ['off', 'high'] },
    './pi-compat/interactive-ui.js': { adaptInteractiveUi },
    './pi-compat/settings.js': { createEngineSettings() {} },
    'node:os': { userInfo: () => ({ homedir: '/home/fake' }) }, 'node:path': path,
    'node:module': { createRequire: () => ({ resolve: () => '/fake/pi-open-tui/package.json' }) },
    '@earendil-works/pi-coding-agent': {
      VERSION: '1.0.1', InteractiveMode,
      async createAgentSessionRuntime(factory) { await factory({ sessionManager: {} }); return runtime; },
      async createAgentSessionServices(options) {
        overrides.push(options.resourceLoaderOptions.extensionsOverride);
        options.resourceLoaderOptions.extensionFactories[0]({ registerMarkdownTransformer() {}, registerCommand(name, command) { commands[name] = command; }, registerShortcut() {},
          registerToolRenderer() {}, on(event, handler) { hooks[event] = handler; },
          // BL2: the ask presenter subscribes the request seam on the bus; the
          // fixture only needs it reachable.
          events: { on() {}, emit() {} } });
        return { settingsManager: { applyOverrides() {} }, resourceLoader, diagnostics: {} };
      },
      async createAgentSessionFromServices() { if (fail === 'session') throw new Error('injected session'); return { session }; },
      SessionManager: { continueRecent() {}, async listAll() { return []; } },
      SessionSelectorComponent: class { constructor(load, _all, choose, cancel, quit) { Object.assign(this, { kind: 'resume', load, choose, cancel, quit }); } },
      ModelSelectorComponent: class { constructor(_tui, _current, _runtime, _models, choose) { this.kind = 'model'; this.choose = choose; } },
      ThinkingSelectorComponent: class { constructor(_current, _levels, choose) { this.kind = 'effort'; this.choose = choose; } },
      DynamicBorder: class { render() { return []; } },
    },
    './interactive-channel.js': { INTERACTIVE_UI_FD: 6, INTERACTIVE_RPC_FD: 5,
      InteractiveChannel: class { constructor(_socket, _limits, accept, ended) { this.accept = accept; this.ended = ended; channels.push(this); }
        send(event) { sent.push(event); } } },
    './pi-compat/prompt-editor.js': { ownedEditor: (editor, handlers) => { Object.assign(commands, handlers); return editor; } },
    // B1: the compact-rows runtime is the host's own presentation seam; the
    // fixture keeps its wiring -- resolver plus lifecycle -- without drawing.
    '@oma/tui/compact-tools': { createCompactToolRuntime: () => ({
      resolver: (_name, next) => next(), bindRender() {}, reset() {},
      agentStarted() {}, agentEnded() {}, toolStarted() {}, toolEnded() {} }) },
    // The presentation seam marks what it wrapped so the tests can see where
    // the policy was applied; the registry keeps the original object.
    './interactive-display.js': { safeToolPresentation: value => ({ ...value, __safe: true }) },
    '@oma/tui/panel-style': { stylePanel: () => [] }, './open-tui-brand.js': {},
    './session-directories.js': { ProjectSessionDirectories: class { close() {} async snapshot() { return { dirs: ['/sessions'], histories: [] }; } } },
    '@oma/protocol/host-history': { parseHostHistoryReference() { throw new Error('No remote history in this fixture'); } },
    './pi-presentation.js': { preparePiInteractive() {} }, '@oma/domain/surface-bounds': {},
    './pi-compat/env.js': { PI_RESUME_HINT: 'To resume this session:' },
    './pi-compat/commands.js': { PI_BUILTIN_COMMANDS: new Set() },
    './extension-modules.js': { ExtensionModules: class {
      refresh() { modules.push('modules-refresh'); }
      close() { modules.push('modules-close'); moduleClose?.(); }
    } },
    // BL2: the ask presenter hooks the bus and session events through the
    // extension api the fixture passes in — registration must be reachable.
    '@oma/tui/ask-user-question/presenter': { registerAskUserQuestionPresenter(pi, deps) { modules.push('ask-presenter'); } },
    '@oma/domain/unseen-text': { UNSEEN: /[\x00-\x1f]/g, UNSEEN_EXCEPT_LAYOUT: /[\x00-\x08]/g },
    "@oma/domain/errors": { StoreError: class extends Error { constructor(code, message) { super(message); this.code = code; } } },
    "@oma/config": { EFFORT_LEVELS: ['off', 'high'] },
  };
  const module = { exports: sourceWorld("interactive.ts", dependencies, { URL, Buffer,
    process: { argv: ['node', 'fake', '--session-dir', '/sessions'], env: {
      OMA_FRAME_BYTES: '262144', OMA_UI_IDLE_SECONDS: '30', OMA_UI_RECEIPT_SECONDS: '30', PI_CODING_AGENT_DIR: '/engine',
    }, cwd: () => '/work', pid: 123, kill(pid, signal) { signals.push([pid, signal]); }, stdout: { write() {} } },
    setTimeout(run) { const timer = { run, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  }, "file:///fake/apps/oma/dist/entry/pi-interactive-host.js") };
  observe?.({ modules, runtime, hooks });
  await module.exports.runInteractive({ version: 'test', settings: {}, presentation: {
    ...dependencies['./open-tui-brand.js'], stylePanel: dependencies['@oma/tui/panel-style'].stylePanel,
    createCompactTools: dependencies['@oma/tui/compact-tools'].createCompactToolRuntime,
    registerQuestions: dependencies['@oma/tui/ask-user-question/presenter'].registerAskUserQuestionPresenter,
  } });
  if (!observe) modules.length = 0;
  return { timers, hooks, sent, picks, changes, channels, signals, context, runtime, commands, modules, notices, modes, overrides,
    command(command = 'principal-model') { channels[0].accept({ type: 'engine_command', command }); },
    tick() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
  };
}
test('interactive owner: /society chooses Personal before the first conversation', async () => {
  const w = await world();
  assert.equal(w.picks.length, 0);
  const choosing = w.commands.society.handler('', w.context); await flush();
  w.picks[0].choose('Personal'); await choosing;
  assert.deepEqual(JSON.parse(JSON.stringify(w.sent.filter(event => event.type === 'switch'))), [{ type: 'switch', mode: 'personal' }]);
});
for (const condition of ['conversation', 'busy', 'cancel', 'same-mode', 'stale', 'changed', 'extension-cancel'])
  test(`interactive owner: mode choice ${condition} keeps Society`, async () => {
    const w = await world();
    if (condition === 'conversation') w.runtime.session.messages.push({ role: 'user' });
    if (condition === 'busy') w.context.isIdle = () => false;
    if (condition === 'extension-cancel') w.runtime.session.extensionRunner.emit = async () => ({ cancel: true });
    const choosing = w.commands.society.handler('', w.context); await flush();
    if (condition === 'stale') w.hooks.session_shutdown({ reason: 'reload' });
    if (condition === 'changed') w.runtime.session.messages.push({ role: 'user' });
    if (w.picks.length) w.picks[0].choose(condition === 'same-mode' ? 'Society' : condition === 'cancel' ? undefined : 'Personal');
    await choosing;
    assert.equal(w.sent.some(event => event.type === 'switch'), false);
  });
test('interactive owner: native extension identity advances before the existing loader reloads and returns on quit', async () => {
  const w = await world();
  await w.runtime.services.resourceLoader.reload();
  assert.deepEqual(w.modules, ['modules-refresh', 'resources-reload']);
  await w.runtime.dispose(); await w.runtime.dispose();
  assert.deepEqual(w.modules, ['modules-refresh', 'resources-reload', 'abort', 'dispose', 'modules-close']);
});
test('interactive owner: rejected reload waits for runtime cleanup before fatal presentation', async () => {
  let finish;
  const problem = new Error('injected reload'), w = await world({ resourceReload: async () => { throw problem; },
    dispose: () => new Promise(resolve => { finish = resolve; }) });
  const pending = assert.rejects(w.runtime.session.reload(), error => error === problem); await flush();
  assert.deepEqual(w.modules, ['modules-refresh', 'resources-reload', 'resources-invalidate', 'abort', 'dispose']);
  finish(); await pending;
  assert.equal(w.modules.filter(value => value === 'modules-close').length, 1);
  assert.deepEqual(w.modules.at(-1), ['fatal', problem]);
});
for (const failure of ['session', 'constructor', 'init']) test(`interactive owner: ${failure} failure returns the acquired extension owners`, async () => {
  let observed;
  await assert.rejects(world({ fail: failure, init: failure === 'init' ? () => { throw new Error('injected init'); } : undefined,
    observe: value => { observed = value; } }), new RegExp(`injected ${failure}`));
  assert.equal(observed.modules.filter(value => value === 'modules-close').length, 1);
  assert.equal(observed.modules.filter(value => value === (failure === 'session' ? 'resources-invalidate' : 'dispose')).length, 1);
});
test('interactive owner: primary and module-hook cleanup failures remain visible together', async () => {
  const cleanup = new Error('injected hook cleanup');
  await assert.rejects(world({ fail: 'constructor', moduleClose: () => { throw cleanup; } }), error =>
    error.name === 'AggregateError' && error.errors.some(value => value.message === 'injected constructor') && error.errors.includes(cleanup));
});
test('interactive owner: normal model then effort is persisted and the panel returns', async () => {
  const w = await world(); w.command(); w.tick();
  assert.equal(w.picks[0].kind, 'model'); w.picks[0].choose({ id: 'chosen', provider: 'fake' }); await flush();
  assert.equal(w.picks[1].kind, 'effort'); w.picks[1].choose('high'); await flush();
  assert.deepEqual(w.changes, [['model', 'chosen'], ['effort', 'high']]); w.tick(); await flush();
  assert.ok(w.sent.some(event => event.type === 'panel_open'));
});
for (const end of ['quit', 'resume', 'new', 'fork', 'reload', 'channel']) {
  test(`interactive owner: ${end} returns deferred UI tasks and fences old callbacks`, async () => {
    const w = await world(); w.command(); w.hooks.model_select();
    const old = [...w.timers]; assert.equal(old.length, 2);
    if (end === 'channel') w.channels[0].ended(); else w.hooks.session_shutdown({ reason: end });
    assert.equal(w.timers.size, 0, 'old UI deferred tasks outlived their session');
    const sent = w.sent.length; for (const timer of old) timer.run(); await flush();
    assert.equal(w.picks.length, 0); assert.equal(w.sent.length, sent); assert.equal(w.timers.size, 0);
  });
}
for (const end of ['quit', 'resume']) for (const step of ['model', 'effort', 'worker-kind', 'worker-model', 'worker-effort']) {
  test(`interactive owner: ${end} during ${step} cannot persist or reopen UI`, async () => {
    const w = await world(); const worker = step.startsWith('worker'); w.command(worker ? 'worker-model' : 'principal-model'); w.tick();
    if (worker && step !== 'worker-kind') { w.picks.at(-1).choose('Choose a model and effort'); await flush(); }
    if (step.endsWith('effort')) { w.picks.at(-1).choose({ id: 'chosen', provider: 'fake', reasoning: true }); await flush(); }
    const before = w.changes.length; w.hooks.session_shutdown({ reason: end });
    if (end === 'resume') w.hooks.session_start({}, w.context);
    const pending = w.picks.at(-1), count = w.picks.length;
    pending.choose(step === 'worker-kind' ? 'Same as the Principal' : step.endsWith('effort') ? 'high' : { id: 'late', provider: 'fake', reasoning: true });
    await flush(); w.tick(); await flush();
    assert.equal(w.changes.length, before, 'a stopped selector changed persistent settings');
    assert.equal(w.picks.length, count); assert.equal(w.timers.size, 0);
    assert.equal(w.sent.some(event => event.type === 'worker_model' || event.type === 'panel_open'), false);
  });
}

test('interactive owner: a replacement accepts fresh selections but rejects the old deferred callbacks', async () => {
  const w = await world(); w.command(); w.hooks.thinking_level_select(); const old = [...w.timers];
  w.hooks.session_shutdown({ reason: 'resume' }); w.hooks.session_start({}, w.context);
  const sent = w.sent.length; for (const timer of old) timer.run(); await flush();
  assert.equal(w.picks.length, 0); assert.equal(w.sent.length, sent);
  w.command('worker-model'); w.tick(); w.picks.at(-1).choose('Same as the Principal'); await flush();
  assert.ok(w.sent.some(event => event.type === 'worker_model' && event.same === true));
  assert.equal(w.timers.size, 1);
});
test('interactive owner: a consumed callback runs once and the reopen timer is returned at shutdown', async () => {
  const w = await world(); w.command(); const old = [...w.timers][0]; w.tick(); old.run();
  assert.equal(w.picks.length, 1); w.picks[0].choose(undefined); await flush();
  const reopen = [...w.timers][0]; assert.ok(reopen);
  w.hooks.session_shutdown({ reason: 'quit' }); assert.equal(w.timers.size, 0);
  reopen.run(); await flush(); assert.equal(w.sent.some(event => event.type === 'panel_open'), false);
});
test('interactive owner: an already accepted model change does not open effort after the session ends', async () => {
  let finish;
  const w = await world({ setModel: () => new Promise(resolve => { finish = resolve; }) });
  w.command(); w.tick(); w.picks[0].choose({ id: 'accepted', provider: 'fake' }); await flush();
  assert.deepEqual(w.changes, [['model', 'accepted']]);
  w.hooks.session_shutdown({ reason: 'resume' }); w.hooks.session_start({}, w.context);
  const sent = w.sent.length; finish(); await flush(); w.tick();
  assert.equal(w.picks.length, 1); assert.equal(w.sent.length, sent);
});
for (const command of ['principal-model', 'worker-model']) {
  test(`interactive owner: an ended channel cannot acquire ${command}`, async () => {
    const w = await world(); w.channels[0].ended(); w.command(command); w.hooks.model_select(); w.tick();
    assert.equal(w.picks.length, 0); assert.equal(w.timers.size, 0);
    assert.deepEqual(w.signals, [[123, 'SIGTERM']]);
  });
}

for (const choice of ['Same as the Principal', 'Choose a model and effort']) {
  test(`interactive owner: worker ${choice} persists normally`, async () => {
    const w = await world(); w.command('worker-model'); w.tick(); w.picks[0].choose(choice); await flush();
    if (choice !== 'Same as the Principal') {
      w.picks[1].choose({ id: 'worker', provider: 'fake', reasoning: true }); await flush();
      w.picks[2].choose('high'); await flush();
    }
    const event = w.sent.find(event => event.type === 'worker_model'); assert.ok(event);
    if (choice === 'Same as the Principal') assert.equal(event.same, true);
    else assert.deepEqual([event.provider, event.model, event.thinking], ['fake', 'worker', 'high']);
    w.tick(); await flush(); assert.ok(w.sent.some(event => event.type === 'panel_open'));
  });
}
test('interactive owner: old panel cleanup cannot clear the replacement panel', async () => {
  const w = await world(); w.command(); w.tick(); w.picks[0].choose(undefined); await flush(); w.tick();
  const old = w.picks.at(-1); assert.equal(typeof old.render, 'function');
  w.hooks.session_shutdown({ reason: 'resume' }); w.hooks.session_start({}, w.context);
  w.command(); w.tick(); w.picks.at(-1).choose(undefined); await flush(); w.tick(); await flush();
  const sent = w.sent.length;
  assert.equal(old.render(80).length, 0); old.handleInput('old'); assert.equal(w.sent.length, sent);
  w.picks.at(-1).handleInput('current'); assert.equal(w.sent.at(-1).data, 'current');
  w.hooks.session_shutdown({ reason: 'quit' }); await flush();
});
test('interactive owner: channel loss during initialization never reports readiness', async () => {
  const w = await world({ init: ({ channels }) => channels[0].ended() });
  assert.equal(w.sent.some(event => event.type === 'ready' || event.type === 'engine_state'), false);
  w.command(); w.tick(); assert.equal(w.picks.length, 0);
});

for (const path of ['/sessions/old.jsonl', '/other/old.jsonl']) {
  test(`interactive owner: an old resume selector cannot switch to ${path}`, async () => {
    const w = await world(); assert.equal(w.commands.extensionCommand('/resume'), true);
    const selector = w.picks.at(-1); assert.equal(selector.kind, 'resume');
    w.hooks.session_shutdown({ reason: 'resume' }); w.hooks.session_start({}, w.context);
    const sent = w.sent.length; selector.choose(path); selector.quit(); await flush();
    assert.equal(w.changes.length, 0); assert.equal(w.sent.length, sent);
    assert.equal((await selector.load()).length, 0);
  });
}
test('interactive suggestions: OMA command descriptions are structured replacements, not scraped suffixes', async () => {
  const w = await world();
  const items = [
    { value: 'quit', label: 'quit', description: 'unexpected — description — format' },
    { value: 'new', label: 'new' },
    { value: 'resume', label: 'resume', description: '' },
    { value: 'changelog', label: 'changelog', description: 'Show changelog' },
    { value: 'model', label: 'model', description: '<provider/model> — Select model' },
    { value: 'custom', label: 'custom', description: '[t] Description — with a dash' },
    { value: 'plain', label: 'plain' },
    { value: 'tag-inside', label: 'tag-inside', description: 'Keep [t] inside' },
    ...['oma-deliver', 'trust', 'bug', 'import'].map(value => ({ value, label: value })),
  ];
  const snapshot = JSON.stringify(items);
  const suggestions = w.commands.suggest(items);
  assert.equal(JSON.stringify(items), snapshot);
  assert.deepEqual(Array.from(suggestions, item => item.value), items.slice(0, 8).map(item => item.value));
  assert.deepEqual(Array.from(suggestions, item => item.description), [
    'Quit oma', 'Start a new oma session (its own conversation, mail, workers and repositories)',
    'Reopen an earlier oma session of this project', "Show the bundled engine's changelog",
    '<provider/model> — Select model', 'Description — with a dash', undefined, 'Keep [t] inside',
  ]);
  assert.equal(Object.hasOwn(suggestions[6], 'description'), false);
});

test('interactive owner: an image paste is refused with a visible notice, never silently', async () => {
  const w = await world();
  w.commands.pasteImage();
  assert.ok(w.notices.some(([message, level]) => level === 'warning' && /image/i.test(message)),
    `no image-paste notice reached the Human: ${JSON.stringify(w.notices)}`);
});

test('interactive owner: the current resume selector retains same-society and other-society behavior', async () => {
  const w = await world(); w.commands.extensionCommand('/resume'); w.picks.at(-1).choose('/sessions/current.jsonl'); await flush();
  assert.deepEqual(w.changes, [['switch', '/sessions/current.jsonl']]);
  w.commands.extensionCommand('/resume'); w.picks.at(-1).choose('/other/current.jsonl'); await flush();
  assert.ok(w.sent.some(event => event.type === 'switch' && event.session === '/other/current.jsonl'));
});

test('interactive owner: presentation wraps the render lookup and never writes the registry', async () => {
  const w = await world();
  // The engine resolves a definition through its own lookup; the override
  // wraps the answer for display while the registry keeps Pi's object.
  const raw = { renderResult() {}, execute() {} };
  const mode = w.modes[0];
  mode.engineDefinitions = { oma_mail_send: raw };
  const presented = mode.getRegisteredToolDefinition('oma_mail_send');
  assert.notEqual(presented, raw, 'the render seam hands components a wrapped definition');
  assert.equal(presented.__safe, true, 'the wrap is OMA\u2019s presentation policy');
  assert.equal(mode.engineDefinitions.oma_mail_send, raw, 'the registry keeps the object Pi loaded');
  assert.equal(mode.getRegisteredToolDefinition('missing'), undefined);
  // The load-time seam still orders OMA's boundary first and touches no tool.
  const tools = new Map([['oma_mail_send', { definition: raw }]]);
  const upstream = '/fake/pi-open-tui/extensions/open-tui/index.ts';
  const loaded = { errors: [], runtime: { invalidate() {} },
    extensions: [
      { path: upstream, resolvedPath: upstream, tools: new Map() },
      { path: '<inline:oma>', resolvedPath: '<inline:oma>', tools },
    ] };
  const result = w.overrides[0](loaded);
  assert.equal(tools.get('oma_mail_send').definition, raw, 'extensionsOverride wrote no tool entry');
  assert.equal(result.extensions[0].path, '<inline:oma>', 'the boundary still installs before upstream');
});
