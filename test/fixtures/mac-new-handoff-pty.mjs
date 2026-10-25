// Actual Mac CLI/attach/holder then explicit Personal birth on Linux, not native VM evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { startHostApi } from "#oma-test/app/platform/host/host-api";
import { encodeTerminalJson } from '@oma/protocol/host-guest';
import { scriptedProvider, text } from '../../dist/test/fixtures/scripted-provider.js';
import { holdSocketNames } from '../../dist/test/fixtures/socket-names.js';
const [root, ending = 'personal'] = process.argv.slice(2);
const repo = process.cwd(), cwd = join(root, 'host-project'), guest = join(root, 'guest-project');
const home = join(root, 'home'), data = join(root, 'data', 'oma'), run = join(data, 'run');
for (const path of [cwd, guest, home, run]) mkdirSync(path, { recursive: true });
const provider = await scriptedProvider([text('HOST_NEW_PERSONAL_COMPLETE')]);
provider.configure(join(data, '.engine'));
const settings = join(data, '.engine', 'settings.json');
writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, 'utf8')), defaultProvider: 'fake', defaultModel: 'scripted' }));
writeFileSync(join(run, 'token'), 'f'.repeat(64));
const names = holdSocketNames(root);
const preload = join(repo, 'dist/test/fixtures/socket-names.js');
const guestSocket = join(run, 'holder.sock');
const holder = spawn(process.execPath, ['--import', preload, join(repo, 'apps/oma/dist/entry/guest-session.js'), '--socket', guestSocket, '--cwd', guest,
  '--', process.execPath, join(repo, 'test/fixtures/fake-tui.mjs')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...names.env } });
const holderEnded = new Promise((resolve, reject) => { holder.once('error', reject); holder.once('close', (code, signal) => resolve({ code, signal })); });
let starts = 0, attaches = 0;
const sockets = new Set();
let api;
try {
  for (let i = 0; i < 200 && !existsSync(guestSocket); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(existsSync(guestSocket));
  const unused = async () => { assert.fail('no Society state/API effect is allowed by host-new'); };
  api = await startHostApi({ socketPath: join(run, 'hostapi.sock'), token: 'f'.repeat(64), uid: process.getuid(),
    frameBytes: 262144, helloDeadlineMs: 2000, requestTimeoutMs: 5000,
    backend: { state: () => 'ready', start: async () => { starts++; }, stop: unused, society: unused,
      importProject: unused, exportProject: unused, archive: unused, syncPackages: unused,
      async terminal(society, takeover) {
        attaches++; assert.equal(society, 'demo'); assert.equal(takeover, false);
        const socket = connect(guestSocket);
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
        socket.write(encodeTerminalJson('attach', {}));
        return { socket, rest: Buffer.alloc(0) };
      } } });
  api.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const entry = join(repo, 'apps/oma/dist/entry/oma-mac.js');
  // This is the actual Mac entry on this Linux machine. Its execve resolves
  // the same installed oma.js; only the native platform/VM are not exercised.
  const child = spawn(process.execPath, ['--import', preload, entry, 'attach', 'demo'], { cwd, stdio: 'inherit',
    env: { ...names.env, PATH: process.env.PATH, HOME: home, OMA_HOST_HOME: data, XDG_DATA_HOME: join(root, 'data'),
      XDG_RUNTIME_DIR: join(root, 'runtime'), TERM: 'xterm-256color', PI_OFFLINE: '1',
      OMA_RESUME_SESSION: join(guest, 'stale-history.jsonl') } });
  const end = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.deepEqual(end, { code: 0, signal: null });
  assert.deepEqual(await holderEnded, { code: 0, signal: null });
  assert.equal(starts, 1); assert.equal(attaches, 1);
  const personal = existsSync(join(data, '.personal')) ? readdirSync(join(data, '.personal')).filter(name => !name.includes('.')) : [];
  if (ending === 'personal') {
    assert.equal(personal.length, 1);
    const birth = JSON.parse(readFileSync(join(data, '.personal', personal[0], 'session-mode.json'), 'utf8'));
    assert.equal(birth.mode, 'personal'); assert.equal(birth.cwd, realpathSync(cwd));
    assert.equal(provider.seen.length, 1);
    assert.ok(provider.seen[0].body.tools.some(tool => tool.function.name === 'write'));
    assert.ok(provider.seen[0].body.tools.every(tool => !tool.function.name.startsWith('oma_')));
  } else { assert.equal(ending, 'close'); assert.equal(personal.length, 0); assert.equal(provider.seen.length, 0); }
  assert.equal(existsSync(join(guest, '.personal')), false);
  writeFileSync(join(root, 'facts.json'), JSON.stringify({ starts, attaches, requests: provider.seen.length, births: personal.length, cwd }));
} finally {
  if (holder.exitCode === null && holder.signalCode === null) { holder.kill('SIGKILL'); await holderEnded; }
  for (const socket of sockets) socket.destroy();
  if (api) await new Promise(resolve => api.close(resolve));
  try { await provider.close(); } finally { names.close(); }
}
