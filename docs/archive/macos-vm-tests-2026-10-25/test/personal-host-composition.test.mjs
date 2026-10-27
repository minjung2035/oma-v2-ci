import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostErrorMeaning from "@oma/protocol/host-errors";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
/** Production Human lifecycle over controlled owners; no service, VM or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(process.env.OMA_PERSONAL_HOST_SOURCE ?? 'apps/oma/src/entry/personal-host.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll('import.meta.url', '"file:///fixture/apps/oma/dist/entry/personal-host.js"');
class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const plain = value => JSON.parse(JSON.stringify(value));
const options = { dataRoot: '/fixture/data', cwd: '/fixture/project' };
function world({ platform = 'linux', saved = false, config = true, snapshot = {}, configError, birthError,
  birth = { mode: 'personal', cwd: '/saved/project' }, realCwd, directory = true, historyFile = true,
  run = async () => ({ code: 0 }), nextBirth = { mode: 'personal', cwd: '/next/project' }, exec = true } = {}) {
  const effects = [], seeds = [], launches = [], replacements = [];
  const process = { platform, execPath: '/fixture/node', execArgv: ['--fixture-node-arg'],
    env: { HOME: '/fixture/home', OMA_HOST_HOME: '/fixture/data', OMA_RESUME_SESSION: '/stale/history.jsonl' },
    chdir(cwd) { effects.push(['chdir', cwd]); },
    ...(exec ? { execve(...args) { effects.push(['exec']); replacements.push(args); } } : {}),
  };
  const dependencies = {
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/protocol/host-errors": hostErrorMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

    'node:fs': {
      realpathSync(cwd) { effects.push(['realpath', cwd]); return realCwd ?? cwd; },
      lstatSync(file) {
        if (file === '/fixture/project-config.json') { effects.push(['config-exists']); return config ? {} : undefined; }
        return { isFile: () => historyFile, isDirectory: () => directory };
      },
    },
    'node:path': path, 'node:url': { fileURLToPath },
    "@oma/config/defaults": { defaultSocietyFor(cwd) { effects.push(['project', cwd]); return 'fixture-project'; } },
    '@oma/domain/canonical-json': { sha256Hex: () => 'fixture-hash' }, '@oma/domain/errors': { StoreError },
    '@oma/domain/deployment': { DEPLOYMENT_LAYOUT: { entries: { tui: 'apps/oma/dist/entry/oma.js' } } },
    '../runtime/session-catalog.js': { RESUME_SESSION_ENV: 'OMA_RESUME_SESSION', async sessionBirthForHistory(_data, file, cwd) {
      effects.push(['catalogue', file, cwd]); if (birthError) throw birthError;
      return file === '/next/history.jsonl' ? nextBirth : birth;
    } },
    '../runtime/session-mode.js': { sessionRootForHistory: () => '/saved/root' },
    '../runtime/personal-session.js': {
      personalBirth(data, cwd) { effects.push(['birth', data, cwd]); return { root: '/new/root', birth: { mode: 'personal', cwd } }; },
      async runPersonalSession(launch) { effects.push(['engine']); launches.push(launch); const ended = await run(); effects.push(['engine-return']); return ended; },
    },
    '../runtime/personal-settings.js': { async updatePersonalSettingsAsync(location, seed) {
      effects.push(['settings-take']); assert.equal(typeof seed, 'function', 'first choice must be queried by its writer');
      try { if (!saved) seeds.push(await seed()); effects.push(['settings-commit', location]); }
      finally { effects.push(['settings-return']); }
    } },
    '../platform/host/personal-seed.js': { async macProjectExtensionSeed(_data, cwd) {
      effects.push(['mac-seed', cwd]); if (configError) throw configError;
      return ['extensions/mac.js'];
    } },
    '@oma/protocol/guest-history': { isGuestHistoryReference: value => value.startsWith('oma-guest-history:') },
    '../platform/host/guest-histories.js': { async inspectMacGuestHistory() { effects.push(['guest-history']); } },
    '../application/settings.js': {
      projectSettingsPath: () => '/fixture/project-config.json',
      readSettingsForEditing() { effects.push(['config-read']); if (configError) throw configError; return { snapshot, config: { principalProfile: 'principal' } }; },
      roleSetOf() { effects.push(['roles']); return { principal: { extensions: ['society-core', 'extensions/user.js'] } }; },
    },
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, process, URL,
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(dependencies, name)) return sessionHandoffMeaning;
if (name === "@oma/protocol/host-errors" && !Object.hasOwn(dependencies, name)) return hostErrorMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(dependencies, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(dependencies, name)) return deploymentMeaning;
 assert.ok(Object.hasOwn(dependencies, name), `Personal host must not load ${name}`); return dependencies[name]; } });
  return { ...module.exports, effects, seeds, launches, replacements, process };
}
for (const platform of ['linux', 'darwin']) {
  test(`Personal host ${platform}: explicit first inheritance opt-out does not observe unavailable projects`, async () => {
    const w = world({ platform, configError: new Error('unrelated bookmark is stale') });
    await w.personalMain({ ...options, noProjectExtensions: true });
    assert.deepEqual(plain(w.seeds), [[]]);
    assert.equal(w.launches.length, 1);
    assert.equal(w.effects.some(item => ['project', 'config-read', 'mac-seed'].includes(item[0])), false);
    const resumed = world({ platform });
    await assert.rejects(resumed.personalMain({ ...options, noProjectExtensions: true, resume: '/saved/history.jsonl' }), { code: 'INVALID_REQUEST' });
    assert.equal(resumed.effects.length, 0);
  });
  test(`Personal host ${platform}: first choice belongs to the settings writer before birth and child`, async () => {
    const w = world({ platform }); await w.personalMain(options);
    const names = w.effects.map(item => item[0]);
    assert.ok(names.indexOf('settings-take') < names.indexOf('config-read') || platform === 'darwin');
    assert.ok(names.indexOf('settings-return') < names.indexOf('birth'));
    assert.ok(names.indexOf('birth') < names.indexOf('engine'));
    assert.deepEqual(plain(w.seeds), platform === 'darwin' ? [['extensions/mac.js']] : [['society-core', 'extensions/user.js']]);
    assert.equal(names.includes('config-read'), platform !== 'darwin');
    assert.equal(w.process.exitCode, 0);
  });
  test(`Personal host ${platform}: existing choices need no old project observation`, async () => {
    const w = world({ platform, saved: true, configError: new Error('the old project is unreadable') });
    await w.personalMain(options);
    assert.equal(w.effects.some(item => ['project', 'config-exists', 'config-read', 'roles'].includes(item[0])), false);
    assert.equal(w.launches.length, 1); assert.equal(w.seeds.length, 0);
  });
  test(`Personal host ${platform}: saved birth restores cwd and root without a new identity`, async () => {
    const w = world({ platform }); await w.personalMain({ ...options, resume: '/saved/history.jsonl' });
    assert.deepEqual(w.effects[0], ['catalogue', '/saved/history.jsonl', options.cwd]);
    assert.deepEqual(w.effects[1], ['realpath', '/saved/project']);
    assert.equal(w.effects.some(item => item[0] === 'birth'), false);
    assert.equal(w.launches[0].root, '/saved/root'); assert.equal(w.launches[0].resume, '/saved/history.jsonl');
    if (platform === 'linux') assert.deepEqual(w.effects.find(item => item[0] === 'project'), ['project', '/saved/project']);
  });
}
for (const [label, fault] of [
  ['other mode', { birth: { mode: 'society', cwd: '/saved/project' } }],
  ['missing saved directory', { directory: false }],
  ['rebound saved directory', { realCwd: '/changed/project' }],
  ['nonregular history', { historyFile: false }],
  ['unobserved birth', { birthError: new StoreError('BROKER_UNAVAILABLE', 'birth unobserved') }],
]) test(`Personal host: ${label} has no preferences, birth or child effects`, async () => {
  const w = world(fault); await assert.rejects(w.personalMain({ ...options, resume: '/saved/history.jsonl' }));
  assert.equal(w.effects.some(item => ['settings-take', 'birth', 'engine', 'exec'].includes(item[0])), false);
});
for (const [label, fault] of [['unobserved', { configError: new Error('config unobserved') }], ['uncommitted', { snapshot: null }]])
  test(`Personal host: ${label} project seed consumes no preference or birth`, async () => {
    const w = world(fault); await assert.rejects(w.personalMain(options));
    assert.equal(w.effects.some(item => ['settings-commit', 'birth', 'engine'].includes(item[0])), false);
    assert.equal(w.effects.at(-1)[0], 'settings-return');
  });
test('Personal host: an observed absent project seeds no extensions without provisioning', async () => {
  const w = world({ config: false }); await w.personalMain(options);
  assert.deepEqual(plain(w.seeds), [[]]); assert.equal(w.effects.some(item => item[0] === 'config-read'), false);
});
for (const [label, next, target] of [['new', {}, undefined], ['Personal resume', { session: '/next/history.jsonl' }, { mode: 'personal', cwd: '/next/project' }],
  ['Society resume', { session: '/next/history.jsonl' }, { mode: 'society', cwd: '/guest/project' }]])
  test(`Personal host: ${label} replaces the entry only after the actual child owner returns`, async () => {
    let finish; const w = world({ nextBirth: target, run: () => new Promise(resolve => { finish = resolve; }) });
    const pending = w.personalMain(options); pending.catch(() => {}); await flush();
    assert.equal(typeof finish, 'function', 'the engine must reach its owned run');
    assert.equal(w.effects.some(item => ['exec', 'chdir'].includes(item[0])), false);
    finish({ code: 0, next }); await pending;
    assert.ok(w.effects.findIndex(item => item[0] === 'engine-return') < w.effects.findIndex(item => item[0] === 'exec'));
    const [executable, argv, env] = w.replacements[0];
    assert.equal(executable, '/fixture/node');
    assert.deepEqual(Array.from(argv), ['/fixture/node', '--fixture-node-arg', '/fixture/apps/oma/dist/entry/oma.js',
      ...(label === 'new' ? ['--mode', 'personal'] : [])]);
    assert.equal(env.OMA_RESUME_SESSION, next.session); assert.equal(env.OMA_HOST_HOME, '/fixture/data');
    assert.deepEqual(w.effects.filter(item => item[0] === 'chdir'), target?.mode === 'personal' ? [['chdir', target.cwd]] : []);
  });
for (const platform of ['linux', 'darwin']) test(`Personal host ${platform}: mode choice waits for actual exit and starts Society without a saved history`, async () => {
  let finish; const w = world({ platform, run: () => new Promise(resolve => { finish = resolve; }) });
  const pending = w.personalMain(options); await flush();
  assert.equal(w.replacements.length, 0);
  finish({ code: 0, next: { mode: 'society' } }); await pending;
  const [, argv, env] = w.replacements[0];
  assert.deepEqual(Array.from(argv), ['/fixture/node', '--fixture-node-arg', '/fixture/apps/oma/dist/entry/oma.js', '--mode', 'society']);
  assert.equal(env.OMA_RESUME_SESSION, undefined);
  assert.deepEqual(w.effects.filter(item => item[0] === 'chdir'), [['chdir', options.cwd]]);
});
test('Personal host: /society re-enters as a fresh `oma --society` birth after the actual child exit', async () => {
  let finish; const w = world({ run: () => new Promise(resolve => { finish = resolve; }) });
  const pending = w.personalMain(options); pending.catch(() => {}); await flush();
  assert.equal(w.effects.some(item => ['exec', 'chdir'].includes(item[0])), false, 'no replacement before the writer actually exits');
  finish({ code: 0, next: { society: 'fixture-project' } }); await pending;
  assert.ok(w.effects.findIndex(item => item[0] === 'engine-return') < w.effects.findIndex(item => item[0] === 'exec'));
  assert.deepEqual(w.effects.filter(item => item[0] === 'chdir'), [['chdir', '/fixture/project']]);
  const [executable, argv, env] = w.replacements[0];
  assert.equal(executable, '/fixture/node');
  assert.deepEqual(Array.from(argv), ['/fixture/node', '--fixture-node-arg', '/fixture/apps/oma/dist/entry/oma.js', '--society', 'fixture-project']);
  assert.equal(env.OMA_RESUME_SESSION, undefined, 'a fresh Society birth is never a resume');
});
test('Personal host: /society names only this project\'s own Society', async () => {
  const w = world({ run: async () => ({ code: 0, next: { society: 'not-this-project' } }) });
  await assert.rejects(w.personalMain(options), { code: 'INVALID_REQUEST' });
  assert.equal(w.replacements.length, 0);
});
test('Personal host: Node without in-place restart refuses the /society transition', async () => {
  const w = world({ exec: false, run: async () => ({ code: 0, next: { society: 'fixture-project' } }) });
  await assert.rejects(w.personalMain(options), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(w.replacements.length, 0);
});
test('Personal host: child-owner failure never authorizes a replacement', async () => {
  const problem = new Error('writer return failed'), w = world({ run: async () => { throw problem; } });
  await assert.rejects(w.personalMain(options), error => error === problem); assert.equal(w.replacements.length, 0);
});
test('Personal host: Node without in-place restart refuses after writer return, not a second spawned engine', async () => {
  const w = world({ exec: false, run: async () => ({ code: 0, next: {} }) });
  await assert.rejects(w.personalMain(options), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(w.launches.length, 1); assert.equal(w.replacements.length, 0);
});
test('DR29: Mac Personal releases its actual child before inspecting a guest reference and replacing the host', async () => {
  let finish;
  const reference = 'oma-guest-history:controlled', w = world({ platform: 'darwin', run: () => new Promise(resolve => { finish = resolve; }) });
  const pending = w.personalMain(options); pending.catch(() => {}); await flush();
  assert.equal(w.effects.some(item => item[0] === 'guest-history'), false);
  finish({ code: 0, next: { session: reference } }); await pending;
  const names = w.effects.map(item => item[0]);
  assert.ok(names.indexOf('engine-return') < names.indexOf('guest-history'));
  assert.ok(names.indexOf('guest-history') < names.indexOf('exec'));
  assert.equal(w.replacements[0][2].OMA_RESUME_SESSION, reference);
  assert.equal(names.includes('chdir'), false, 'a guest reference must not become a host pathname');
});
