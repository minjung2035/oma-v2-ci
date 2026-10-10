import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { RESUME_SESSION_ENV } from '../dist/src/runtime/session-catalog.js';

function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, console: { error() {} }, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`); return dependencies[name]; } });
  return module.exports;
}
const normalized = { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', TERM: 'xterm-256color', SHELL: '/bin/sh', USER: 'oma', LOGNAME: 'oma', TMPDIR: '/tmp' };

test('F34 guesthost: package engines and Society launcher get normalized env, not host inheritance', async () => {
  let packages, launcher;
  const Empty = class {};
  load('src/entry/guesthost.ts', {
    'node:path': path,
    '../platform/guest/identity.js': { systemUser: () => ({}) },
    '../platform/guest/server.js': { startGuestServer: async () => {} },
    '../platform/guest/host.js': { GuestHost: Empty, listening: async () => false },
    '../platform/guest/systemd-launcher.js': { systemdSessionLauncher: options => { launcher = options; return {}; } },
    '../platform/guest/egress.js': { EgressPool: Empty, startEgressService: async () => {} },
    '../platform/guest/requests.js': { RequestLedger: Empty },
    '../platform/guest/project.js': { GuestProjects: Empty },
    '../platform/guest/stream.js': { serveStream() {} },
    '../platform/guest/archive.js': { GuestArchives: Empty },
    '../platform/guest/packages.js': { GuestPackages: class { constructor(options) { packages = options; } } },
    '../domain/deployment.js': { DEPLOYMENT_LAYOUT: { entries: { guestPackages: 'guest-packages.js' } } },
    '../protocol/host-guest.js': { PLATFORM_FRAME_BYTES: 65536 },
  }, { process: { argv: ['node', 'guesthost'], execPath: '/usr/bin/node', env: { HOME: '/guest/home', LANG: 'host', TZ: 'host', SHELL: '/host/shell', USER: 'host', SECRET_SENTINEL: 'host-only' }, exit() { assert.fail('entry exited'); } } });
  for (const env of [packages.env, launcher.env]) {
    for (const [key, value] of Object.entries(normalized)) assert.equal(env[key], value, key);
    assert.equal(env.HOME, '/guest/home'); assert.equal(env.SECRET_SENTINEL, undefined);
    assert.equal(env.XDG_DATA_HOME, '/var/lib/oma/data'); assert.equal(env.XDG_RUNTIME_DIR, '/run/user/1000');
  }
});

test('F34 systemd launcher: normalized values reach --setenv, stale resume is dropped and new resume is explicit', async () => {
  const calls = [];
  const { systemdSessionLauncher } = load('src/platform/guest/systemd-launcher.ts', {
    'node:path': path,
    '../../domain/errors.js': { StoreError: Error },
    '../../process/run.js': { runProcess: async spec => { calls.push(spec); return { kind: 'exited', exitCode: 0 }; } },
    './host.js': { listening: async () => true },
    '../../runtime/session-catalog.js': { RESUME_SESSION_ENV },
  }, { performance, setTimeout });
  const input = { HOME: '/guest/home', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', [RESUME_SESSION_ENV]: 'stale', TZ: 'host', USER: 'host' };
  const launcher = systemdSessionLauncher({ sessionsDir: '/guest/run', node: '/usr/bin/node', libdir: '/usr/lib/oma', env: input });
  for (const resume of [undefined, 'chosen']) {
    await launcher.start('demo', '/project', resume);
    const command = calls.at(-1);
    assert.equal(command.executable, '/usr/bin/systemd-run');
    for (const [key, value] of Object.entries(normalized).filter(([key]) => key !== 'LC_ALL')) assert.ok(command.argv.includes(`--setenv=${key}=${value}`), key);
    assert.equal(command.argv.includes(`--setenv=${RESUME_SESSION_ENV}=stale`), false);
    assert.equal(command.argv.includes(`--setenv=${RESUME_SESSION_ENV}=chosen`), resume !== undefined);
  }
  assert.equal(input.TZ, 'host'); assert.equal(input[RESUME_SESSION_ENV], 'stale');
});

const collected = 'MainPID=0\nControlPID=0\nControlGroup=\nLoadState=not-found\nActiveState=inactive\nSubState=dead\n';
for (const observation of [collected, collected.replace('inactive', 'active'), collected.replace('MainPID=0', 'MainPID=42'),
  collected.replace('ControlPID=0', 'ControlPID=42'), collected.replace('ControlGroup=', 'ControlGroup=/live'),
  collected.replace('SubState=dead\n', ''), collected.replace('not-found', 'error')])
 test(`DR42 systemd: failed stop needs complete manager proof: ${JSON.stringify(observation)}`, async () => {
  let calls = 0;
  const { systemdSessionLauncher } = load('src/platform/guest/systemd-launcher.ts', {
    'node:path': path, '../../domain/errors.js': {StoreError: Error},
    '../../process/run.js': {runProcess: async () => ++calls === 1 ? {kind:'exited', exitCode:5} :
      {kind:'exited', exitCode:0, stdout:Buffer.from(observation)}},
    './host.js': {listening: async () => false}, '../../runtime/session-catalog.js': {RESUME_SESSION_ENV},
  }, {performance, setTimeout});
  const launcher = systemdSessionLauncher({sessionsDir:'/unused', node:'/unused', libdir:'/unused', env:{}});
  assert.equal(await launcher.stop('demo', 100), observation === collected ? 'stopped' : 'unknown'); assert.equal(calls, 2);
 });
