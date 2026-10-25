import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
import * as packagePolicy from "@oma/domain/package-policy";
/** Actual birth routers at controlled effect boundaries; no real service, VM or provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as cleanup from "@oma/native/cleanup";

class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
function compile(file, deps, host, expose = false) {
  let source = readFileSync(file, 'utf8');
  // Expose only the entry's main call; its routing and effect order are unchanged.
  if (expose) source = source.slice(0, source.lastIndexOf('main(process.argv.slice(2))')) + 'export { main };';
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    .outputText.replaceAll('import.meta.url', '"file:///fixture/apps/oma/dist/entry/oma-mac.js"');
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports, process: host, Buffer, URL,
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(deps, name)) return sessionHandoffMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(deps, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(deps, name)) return deploymentMeaning;
 assert.ok(Object.hasOwn(deps, name), `${file}: uncontrolled ${name}`); return deps[name]; } });
  return module.exports;
}
function world(platform, { selected = 'personal', birth, birthError, societies = [{ society: 'demo', running: true }], societyReply = { societies }, end, attachEnd, packages = false, tokenError } = {}) {
  const effects = [], personal = [], choices = [], attached = [], output = [];
  const host = { platform, env: { HOME: '/fixture/home', XDG_DATA_HOME: '/fixture/data' }, cwd: () => '/current',
    chdir(value) { effects.push(['chdir', value]); },
    stdin: { isTTY: true }, stdout: { isTTY: true, write: line => output.push(line), on() {}, off() {} },
    stderr: { write: line => output.push(line) }, exit(code) { throw { exit: code }; },
    execPath: '/fixture/node', execArgv: ['--fixture'], execve(...args) { effects.push(['exec', ...args]); } };
  const grammar = compile('apps/oma/src/runtime/host-arguments.ts', {
    '@oma/domain/errors': { StoreError }, '@oma/domain/identifiers': { isValidSocietyName: value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value) },
    '@oma/protocol/host-guest': { isUuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) },
    '@oma/domain/session-mode': { isSessionMode: value => value === 'society' || value === 'personal' },
  }, host);
  const packageGrammar = compile(process.env.OMA_PACKAGE_GRAMMAR_SOURCE ?? 'apps/oma/src/runtime/packages/store.ts', {
    "@oma/engine/package-resources": {},
    'node:fs': {}, 'node:path': path, '@oma/domain/errors': { StoreError },
    "@oma/native/linux": {}, "@oma/native/files": {}, "@oma/storage/durable-fs": {},
    "@oma/config/operations": { PACKAGE_ENTRY_PREFIX: 'packages:', extensionEntryProblem() {} },
    '../user-files.js': {}, '@oma/protocol/host-guest': { isUuid: value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value) },
    "@oma/storage/directory": { listOwnedDirectory() { return null; } },
    '@oma/domain/package-policy': packagePolicy,
  }, host);
  const catalogue = { RESUME_SESSION_ENV: 'OMA_RESUME_SESSION', sessionBirthForHistory(...args) {
    effects.push(['birth', ...args]); if (birthError) throw birthError; return birth;
  } };
  const deps = {
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

    "../engine/start-effects.js": {engineLoginDirectory: {}},
    '../platform/package-files.js': { packageDirectories: {} },
    'node:fs': { realpathSync: value => value, readFileSync(file) { effects.push(['token', file]); if (tokenError) throw tokenError; return 'fixture-token'; } },
    'node:path': path, 'node:url': { fileURLToPath }, 'node:os': { constants: { signals: {} } },
    'node:crypto': { randomUUID: () => 'fixture-request' },
    '../runtime/host-arguments.js': grammar,
    '../runtime/compile-cache.js': { enableProcessCompileCache() {} },
    '../runtime/assets.js': { hostLaunchLocation: () => ({ stateRoot: '/fixture/data/oma/personal' }) },
    '../runtime/session-catalog.js': catalogue,
    '../runtime/session-mode.js': { requireSessionMode(value, requested) {
      if (requested !== undefined && value.mode !== requested) throw new StoreError('INVALID_REQUEST', 'mode cannot change');
    }, readSessionBirth: () => birth ?? null },
    '@oma/tui/session-mode': { async chooseSessionMode() { effects.push(['chooser']); return selected; },
      async chooseSociety(_streams, items) { choices.push({ items }); return end === 'cancel' ? null : items.at(-1); } },
    './personal-host.js': { async personalMain(options) { effects.push(['personal']); personal.push(options); } },
    './oma-society.js': { loaded: effects }, './oma-mac.js': { loaded: effects },
    '../application/exit.js': {}, '@oma/tui/words': {},
    '../runtime/user-files.js': { ensureUserDirectory(directory) { effects.push(['mkdir', directory]); },
      ensureOwnedUserDirectory(directory, ownedFrom) {
        effects.push(['mkdir', directory]);
        // The boundary is the app's own support directory, never the store's
        // or run root's own path -- an owned tail only exists under `home`.
        assert.equal(ownedFrom, '/fixture/home/Library/Application Support/OMA',
          `the owned boundary is the app home, got ${ownedFrom}`);
      } },
    '@oma/protocol/frame': { encodeFrame: value => value },
    '../platform/rpc.js': { PlatformError: class extends Error {},
      async connectSocket() { effects.push(['host-api']); return { write(value) { effects.push(['request', value.method, value.params]); }, unshift() {}, destroy() {} }; },
      async readLeadingResponse(_socket, id) { return { rest: Buffer.alloc(0), result: id === 'h' ? {} : societyReply }; } },
    '../platform/host/attach-client.js': { async attachTerminal(options) { attached.push(options); return attachEnd ?? { kind: 'exit', code: 0 }; } },
    '../platform/host/personal-histories.js': { async hostPersonalHistoryQuery() { return { sessions: [], after: null }; },
      async inspectHostPersonalHistory(_home, reference) {
        effects.push(['inspect-host-history', reference]);
        if (end === 'invalid-host-history') throw new StoreError('INVALID_REQUEST', 'history was replaced');
        return { birth: { mode: 'personal', cwd: '/host/saved-cwd' }, file: '/host/saved-history.jsonl' };
      } },
    '../platform/host/api-client.js': { async hostApiRequest(_socket, _token, method, params) {
      effects.push(['host-api']); effects.push(['request', 'hello', {}]); effects.push(['request', method, params]); return societyReply;
    } },
    '@oma/protocol/guest-history': { isGuestHistoryReference: value => value.startsWith('oma-guest-history:'),
      parseGuestHistoryReference() { return { projectId: 'fixture-project', society: 'demo', file: 'saved.jsonl', sessionId: 'saved-id' }; } },
    '@oma/protocol/host-api': { HOST_API_VERSION: 1 }, '@oma/protocol/host-guest': { PLATFORM_FRAME_BYTES: 262144 },
    '../runtime/packages/index.js': { PACKAGE_USAGE: 'usage: oma pi ...', packageCommand(args) {
      assert.equal(packages, true, 'not a package test');
      return packageGrammar.packageCommand(args, true);
    }, async writePackageIndex() { effects.push(['index']); }, packageActivation() { return 'npm:fixture'; } },
    '../application/local-packages.js': { stageLocalPackage(_store, source) { effects.push(['stage-local', source]); return 'local/staged-fixture'; },
      pruneLocalStage() { effects.push(['prune-local']); } },
    '../runtime/personal-settings.js': { reconcilePersonalSettings() { assert.equal(packages, true); effects.push(['reconcile']); } },
    "@oma/native/process-lock": { ProcessLock: { tryAcquire() { effects.push(['lock']); assert.equal(packages, true);
      return { descriptor: 17, assertHeld() {}, close() { effects.push(['return']); } }; } } },
    "@oma/engine/login": { runEngineLogin(_directoryOwner, options) { effects.push(['engine-login']);
      assert.equal(options.packages.args.includes('--host-only'), false, 'host selector reached Pi'); return 0; } },
    "@oma/native/cleanup": cleanup,
    '@oma/domain/errors': { StoreError }, '@oma/domain/identifiers': { isValidSocietyName: value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value) },
  };
  // Observe dynamic import admission rather than merely counting fake engine calls.
  for (const [name, effect] of [['./oma-society.js', 'society-import'], ['./oma-mac.js', 'mac-import']])
    Object.defineProperty(deps, name, { get() { effects.push([effect]); return {}; } });
  const api = compile(platform === 'darwin' ? process.env.OMA_MAC_ENTRY_SOURCE ?? 'apps/oma/src/entry/oma-mac.ts' : 'apps/oma/src/entry/oma.ts', deps, host, true);
  return { ...api, packageCommand: packageGrammar.packageCommand, effects, personal, choices, attached, output, host };
}
const plain = value => JSON.parse(JSON.stringify(value));
test('Package grammar: host-only is Mac-only and returns an explicit local decision', () => {
  const w = world('darwin', { packages: true });
  assert.deepEqual(plain(w.packageCommand(['list', '--host-only'], true)), { kind: 'run', command: 'list', args: ['list'], hostOnly: true });
  assert.equal(w.packageCommand(['list', '--host-only']).kind, 'refused');
});
for (const platform of ['linux', 'darwin']) {
  for (const args of [['--mode', 'personal']]) test(`birth router ${platform}: ${JSON.stringify(args)} Personal loads no Society or Host API`, async () => {
    const w = world(platform); await w.main(args);
    assert.equal(w.personal.length, 1); assert.equal(w.personal[0].cwd, '/current');
    assert.deepEqual(w.effects.map(item => item[0]), ['personal']);
    if (platform === 'darwin') assert.equal(w.personal[0].packages, '/fixture/home/Library/Application Support/OMA/packages');
  });
  test(`birth router ${platform}: saved Personal resumes its mode without a chooser`, async () => {
    const w = world(platform, { birth: { mode: 'personal', cwd: '/saved' } });
    await w.main(['--resume', '/saved/history.jsonl']);
    assert.deepEqual(w.effects.map(item => item[0]), ['birth', 'personal']);
    assert.equal(w.personal[0].resume, '/saved/history.jsonl');
  });
  test(`birth router ${platform}: explicit conflicting mode is refused before any start`, async () => {
    const w = world(platform, { birth: { mode: 'personal' } });
    await assert.rejects(w.main(['--mode', 'society', '--resume', '/saved/history.jsonl']), { code: 'INVALID_REQUEST' });
    assert.deepEqual(w.effects.map(item => item[0]), ['birth']);
  });
  test(`birth router ${platform}: unreadable birth remains a failure before start`, async () => {
    const problem = new StoreError('BROKER_UNAVAILABLE', 'birth unreadable'), w = world(platform, { birthError: problem });
    await assert.rejects(w.main(['--resume', '/saved/history.jsonl']), error => error === problem);
    assert.deepEqual(w.effects.map(item => item[0]), ['birth']);
  });
}
for (const tty of [true, false]) test(`Linux birth router: startup defaults to Society without a chooser (TTY ${tty})`, async () => {
  const w = world('linux', { selected: null }); w.host.stdin.isTTY = w.host.stdout.isTTY = tty; await w.main([]);
  assert.deepEqual(w.effects, [['society-import']]);
});
test('Mac birth router: explicit host-only package command requires neither token nor Host API', async () => {
  const w = world('darwin', { packages: true, tokenError: new Error('app absent') });
  await assert.rejects(w.main(['pi', 'install', 'npm:fixture', '--host-only']), error => error.exit === 0);
  assert.deepEqual(w.effects.map(item => item[0]), ['mkdir', 'mkdir', 'lock', 'engine-login', 'index', 'prune-local', 'reconcile', 'return']);
  assert.match(w.output.join(''), /Society packages were not synchronized/); assert.equal(w.attached.length, 0);
});
for (const args of [['list', '--host-only', '--host-only'], ['install', 'npm:fixture', '--host-only', '--project', '00000000-0000-4000-8000-000000000001'],
  ['install', 'npm:fixture', '--project', '00000000-0000-4000-8000-000000000001', '--host-only'], ['list', '--host-only=true']])
  test(`Mac birth router: invalid host-only grammar ${JSON.stringify(args)} has no package or token effects`, async () => {
    const w = world('darwin', { packages: true, tokenError: new Error('app absent') });
    await assert.rejects(w.main(['pi', ...args]), error => error.exit === 2); assert.deepEqual(w.effects, []);
  });
test('Mac birth router: an ordinary package command cannot become host-only when its token is unreadable', async () => {
  const w = world('darwin', { packages: true, tokenError: new Error('app absent') });
  await assert.rejects(w.main(['pi', 'install', 'npm:fixture']), error => error.exit === 3);
  assert.deepEqual(w.effects.map(item => item[0]), ['token']); assert.match(w.output.join(''), /Open the OMA app/);
});
test('Mac birth router: Society uses its token and attaches only an observed running Society', async () => {
  const w = world('darwin', { selected: 'society' });
  await assert.rejects(w.main([]), error => error.exit === 0);
  assert.deepEqual(w.effects.map(item => item[0]), ['token', 'host-api', 'request', 'request']);
  assert.deepEqual(w.effects.filter(item => item[0] === 'request').map(item => item[1]), ['hello', 'society.list']);
  assert.equal(w.attached[0].society, 'demo'); assert.equal(w.attached[0].takeover, false);
});
test('Mac birth router: choosing one Society never opens or wakes another', async () => {
  const w = world('darwin', { societies: [{ society: 'stopped', running: false }, { society: 'one', running: true }, { society: 'two', running: true }] });
  await assert.rejects(w.main(['--mode', 'society']), error => error.exit === 0);
  assert.deepEqual(plain(w.choices[0].items), ['one', 'two']); assert.equal(w.attached[0].society, 'two');
  assert.equal(w.effects.some(item => item[1] === 'society.open' || item[1] === 'engine.stop'), false);
});
test('Mac birth router: cancelling the Society selection does not attach', async () => {
  const w = world('darwin', { end: 'cancel', societies: [{ society: 'one', running: true }, { society: 'two', running: true }] });
  await w.main(['--mode', 'society']); assert.equal(w.attached.length, 0);
});
for (const societies of [undefined, null, {}, [null], [['demo', true]], [{ society: '../bad', running: true }],
  [{ society: 'demo', running: 'true' }], [{ society: 'one', running: true }, { society: 'two', running: 'false' }],
  [{ society: 'demo', running: false }, { society: 'demo', running: true }]])
  for (const args of [['--mode', 'society'], ['list']])
    test(`Mac birth router: ${args[0]} malformed Society list ${JSON.stringify(societies)} is not absence`, async () => {
      const w = world('darwin', { societyReply: { societies } });
      await assert.rejects(w.main(args), { code: 'BROKER_UNAVAILABLE' }); assert.equal(w.attached.length, 0);
      assert.deepEqual(w.output, [], 'no partial observation is displayed');
    });
test('Mac birth router: guest Personal choice re-enters the host with an explicit mode', async () => {
  const w = world('darwin', { attachEnd: { kind: 'exit', code: 0, signal: null, next: 'new', mode: 'personal' } });
  await w.main(['attach', 'demo']);
  const call = w.effects.find(item => item[0] === 'exec');
  assert.deepEqual(Array.from(call[2]), ['/fixture/node', '--fixture', '/fixture/apps/oma/dist/entry/oma.js', '--mode', 'personal']);
  assert.equal(Object.hasOwn(call[3], 'OMA_RESUME_SESSION'), false);
});
test('Mac birth router: completed guest /new restarts the host without stale resume or guest cwd', async () => {
  const w = world('darwin', { attachEnd: { kind: 'exit', code: 0, signal: null, next: 'new' } });
  w.host.env.OMA_RESUME_SESSION = '/guest/history.jsonl';
  await w.main(['attach', 'demo']);
  const call = w.effects.find(item => item[0] === 'exec'); assert.ok(call);
  assert.deepEqual(Array.from(call[2]), ['/fixture/node', '--fixture', '/fixture/apps/oma/dist/entry/oma.js']);
  assert.equal(Object.hasOwn(call[3], 'OMA_RESUME_SESSION'), false); assert.equal(call[3].HOME, '/fixture/home');
  assert.equal(w.personal.length, 0); assert.equal(w.effects.some(item => item[1] === 'engine.stop' || item[1] === 'society.open'), false);
});
for (const attachEnd of [{ kind: 'exit', code: 7, signal: null, next: 'new' },
  { kind: 'exit', code: 0, signal: 'SIGTERM', next: 'new' }])
  test(`Mac birth router: failed guest handoff ${JSON.stringify(attachEnd)} starts nothing`, async () => {
    const w = world('darwin', { attachEnd });
    await assert.rejects(w.main(['attach', 'demo']), { code: 'BROKER_UNAVAILABLE' });
    assert.equal(w.effects.some(item => item[0] === 'exec'), false);
  });
test('Mac birth router: unsupported execve is explicit and never starts a second engine', async () => {
  const w = world('darwin', { attachEnd: { kind: 'exit', code: 0, signal: null, next: 'new' } });
  delete w.host.execve;
  await assert.rejects(w.main(['attach', 'demo']), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(w.personal.length, 0);
});
test('DR29: a completed guest session revalidates its host Personal selection before restoring cwd and resuming', async () => {
  const w = world('darwin', { attachEnd: { kind: 'exit', code: 0, signal: null, next: 'resume', history: 'oma-host-history:fixture' } });
  await w.main(['attach', 'demo']);
  const inspect = w.effects.findIndex(item => item[0] === 'inspect-host-history');
  const change = w.effects.findIndex(item => item[0] === 'chdir');
  const exec = w.effects.findIndex(item => item[0] === 'exec');
  assert.ok(inspect >= 0 && change > inspect && exec > change);
  assert.deepEqual(w.effects[change], ['chdir', '/host/saved-cwd']);
  assert.equal(w.effects[exec][3].OMA_RESUME_SESSION, '/host/saved-history.jsonl');
  assert.equal(w.effects.some(item => item[1] === 'engine.stop'), false);
});
test('DR29: a host Personal history replaced after the guest ended grants no new engine', async () => {
  const w = world('darwin', { end: 'invalid-host-history', attachEnd: { kind: 'exit', code: 0, signal: null, next: 'resume', history: 'oma-host-history:fixture' } });
  await assert.rejects(w.main(['attach', 'demo']), { code: 'INVALID_REQUEST' });
  assert.equal(w.effects.some(item => item[0] === 'chdir' || item[0] === 'exec'), false);
});
test('DR29: a guest Society handoff retains its opaque identity for the next explicit guest resume', async () => {
  const w = world('darwin', { attachEnd: { kind: 'exit', code: 0, signal: null, next: 'resume', history: 'oma-guest-history:fixture' } });
  await w.main(['attach', 'demo']);
  const exec = w.effects.find(item => item[0] === 'exec');
  assert.equal(exec[3].OMA_RESUME_SESSION, 'oma-guest-history:fixture');
  assert.equal(w.effects.some(item => item[0] === 'chdir' || item[0] === 'inspect-host-history'), false);
});
test('Mac birth router: list uses validated observations without attaching or opening a Society', async () => {
  const w = world('darwin', { societies: [{ society: 'one', running: true }, { society: 'two', running: false }] });
  await w.main(['list']); assert.deepEqual(w.output, ['one\tRunning\n', 'two\tStopped\n']);
  assert.equal(w.attached.length, 0); assert.equal(w.choices.length, 0);
  assert.deepEqual(w.effects.filter(item => item[0] === 'request').map(item => item[1]), ['hello', 'society.list']);
});
test('Mac birth router: no open Society requires explicit project selection rather than fake host binding', async () => {
  const w = world('darwin', { societies: [{ society: 'stopped', running: false }] });
  await assert.rejects(w.main(['--mode', 'society']), error => error.exit === 1);
  assert.equal(w.attached.length, 0); assert.match(w.output.join(''), /No Society is open/);
});
for (const [args, method] of [[['attach', 'demo', '--takeover'], null],
  [['open', 'demo', '--project', '00000000-0000-4000-8000-000000000001'], 'society.open']])
  test(`Mac birth router: existing ${args[0]} retains its explicit Society meaning`, async () => {
    const w = world('darwin'); await assert.rejects(w.main(args), error => error.exit === 0);
    assert.equal(w.effects.some(item => item[0] === 'chooser'), false);
    assert.equal(w.attached[0].society, 'demo'); assert.equal(w.attached[0].takeover, args[0] === 'attach');
    assert.deepEqual(w.effects.filter(item => item[0] === 'request' && item[1] !== 'hello').map(item => item[1]), method ? [method] : []);
  });
test('DR29: a Mac guest resume routes only its explicit identity to the guest, without a new mode or local file', async () => {
  const w = world('darwin');
  await assert.rejects(w.main(['--resume', 'oma-guest-history:controlled']), error => error.exit === 0);
  assert.equal(w.effects.some(item => item[0] === 'birth' || item[0] === 'chooser'), false);
  assert.equal(w.personal.length, 0);
  assert.equal(w.attached[0].society, 'demo');
  assert.deepEqual(w.effects.filter(item => item[0] === 'request' && item[1] !== 'hello').map(item => item[1]), ['session.resume']);
  const wrong = world('darwin');
  await assert.rejects(wrong.main(['--resume', 'oma-guest-history:controlled', '--mode', 'personal']), { code: 'INVALID_REQUEST' });
  assert.equal(wrong.effects.some(item => item[0] === 'token'), false); assert.equal(wrong.attached.length, 0);
});
