/** Keychain-only helper boundary: controlled child/channel, never a VM or real credential. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Script } from 'node:vm';
import ts from 'typescript';
import { macBundleResources } from '../dist/src/platform/host/bundle.js';

const code = ts.transpileModule(readFileSync('src/platform/host/keychain-client.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const libdir = '/fixture/OMA.app/Contents/Resources/install';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
function world({ fault, noChannel = false, spawnError } = {}) {
  const children = [], launches = [];
  const deps = {
    './bundle.js': { macBundleResources },
    'node:path': path, '../../domain/errors.js': { StoreError },
    '../../process/async.js': {
      spawnSupervisedService(...args) {
        launches.push(args); if (spawnError) throw spawnError;
        const channel = new EventEmitter(), child = new EventEmitter();
        channel.destroyed = false; channel.requests = [];
        channel.setEncoding = value => assert.equal(value, 'utf8');
        channel.write = (line, callback) => { channel.requests.push(JSON.parse(line)); callback?.(); return true; };
        channel.destroy = () => { if (channel.destroyed) return; channel.destroyed = true; channel.emit('close'); };
        child.stdio = [null, null, null, noChannel ? null : channel];
        child.stderr = { resume() {} }; child.killed = false;
        child.close = () => child.emit('close', 0, null);
        children.push({ child, channel }); fault?.(child, channel);
        return child;
      },
      stopOwnedChild(child) { child.killed = true; child.stdio[3]?.destroy(); },
    },
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer, setTimeout, clearTimeout,
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  return { ...module.exports, children, launches };
}
function answer(channel, fields = {}, index = 0) {
  channel.emit('data', JSON.stringify({ id: channel.requests[index].id, ok: true, ...fields }) + '\n');
}
const unavailable = error => error.code === 'BROKER_UNAVAILABLE';

test('Keychain client: fixed signed bundle path, no PATH lookup or other bundle fallback', () => {
  const w = world();
  assert.equal(w.bundledKeychainHelper(libdir), '/fixture/OMA.app/Contents/MacOS/oma-vmhelper');
  for (const dir of ['/fixture/install', '/fixture/Resources/install', '/'])
    assert.throws(() => w.bundledKeychainHelper(dir), { code: 'UNSUPPORTED_PROFILE' });
  assert.equal(w.launches.length, 0);
});
test('Keychain client: only get/put requests; fragmented UTF-8 responses retain correlation', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir);
  assert.deepEqual(JSON.parse(JSON.stringify(w.launches[0].slice(0, 4))),
    ['/fixture/OMA.app/Contents/MacOS/oma-vmhelper', ['--keychain-only'], { PATH: '/usr/bin:/bin' }, true]);
  assert.equal(w.launches[0][4], undefined);
  const { child, channel } = w.children[0];
  const first = client.get('engine-managed'), second = client.get('other');
  answer(channel, {}, 1);
  const response = JSON.stringify({ id: channel.requests[0].id, ok: true, value: 'fixture-한글' }) + '\n';
  channel.emit('data', response.slice(0, 10)); channel.emit('data', response.slice(10));
  assert.equal(await first, 'fixture-한글'); assert.equal(await second, undefined);
  const put = client.put('engine-managed', '{"fixture":true}'); answer(channel, {}, 2); await put;
  assert.deepEqual(channel.requests.map(item => item.op), ['keychain.get', 'keychain.get', 'keychain.put']);
  const closed = client.close(); child.close(); await closed;
});
for (const event of ['end', 'close', 'error', 'child-error']) test(`Keychain client: ${event} rejects pending work, not actual child death`, async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  const pending = client.get('engine-managed');
  const refused = assert.rejects(pending, unavailable);
  if (event === 'child-error') child.emit('error', new Error('spawn failed'));
  else channel.emit(event, new Error('channel failed'));
  await refused; await assert.rejects(client.get('engine-managed'), unavailable);
  let returned = false;
  const closed = client.close().then(() => { returned = true; }); await flush();
  assert.equal(returned, false, 'EOF/error is not the child close observation');
  child.close(); await closed; assert.equal(returned, true);
});
for (const response of ['{\n', 'null\n', '[]\n', '{"id":999,"ok":true}\n', '{"id":1,"ok":"true"}\n', '{"id":1,"ok":true,"value":3}\n'])
  test(`Keychain client: invalid response ${response.trim()} is not a missing credential`, async () => {
    const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
    const refused = assert.rejects(client.get('engine-managed'), unavailable);
    channel.emit('data', response); await refused; assert.equal(channel.destroyed, true);
    const closed = client.close(); child.close(); await closed;
  });
test('Keychain client: locked Keychain rejects without printing the helper response', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  const refused = assert.rejects(client.get('engine-managed'), error => unavailable(error) && !error.message.includes('PRIVATE_FIXTURE'));
  channel.emit('data', '{"id":1,"ok":false,"error":"PRIVATE_FIXTURE"}\n'); await refused;
  assert.equal(channel.destroyed, false, 'a refusal is not channel corruption');
  const closed = client.close(); child.close(); await closed;
});
for (const newline of [false, true]) test(`Keychain client: oversized ${newline ? 'complete' : 'partial'} line ends the channel`, async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  const refused = assert.rejects(client.get('engine-managed'), unavailable);
  channel.emit('data', 'x'.repeat(1024 * 1024 + 1) + (newline ? '\n' : '')); await refused;
  assert.equal(channel.destroyed, true); const closed = client.close(); child.close(); await closed;
});
test('Keychain client: several individually bounded responses in one read are accepted', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  const value = 'x'.repeat(600_000), first = client.get('a'), second = client.get('b');
  channel.emit('data', [1, 2].map(id => JSON.stringify({ id, ok: true, value }) + '\n').join(''));
  assert.equal(await first, value); assert.equal(await second, value);
  const closed = client.close(); child.close(); await closed;
});
test('Keychain client: oversized outgoing credential is refused before any write', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  await assert.rejects(client.put('engine-managed', '한'.repeat(400_000)), { code: 'INVALID_REQUEST' });
  assert.equal(channel.requests.length, 0); assert.equal(channel.destroyed, false);
  const closed = client.close(); child.close(); await closed;
});
for (const kind of ['synchronous', 'callback']) test(`Keychain client: ${kind} write failure rejects all outstanding requests`, async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir), { child, channel } = w.children[0];
  const first = assert.rejects(client.get('a'), unavailable);
  channel.write = (_line, callback) => { if (kind === 'synchronous') throw new Error('fixture write'); callback(new Error('fixture callback')); };
  const second = assert.rejects(client.get('b'), unavailable); await Promise.all([first, second]);
  const closed = client.close(); child.close(); await closed;
});
for (const kind of ['channel', 'encoding', 'listener', 'stderr']) test(`Keychain client: failed ${kind} acquisition retains ownership until child close`, async () => {
  const problem = new Error('injected setup');
  const w = world({ noChannel: kind === 'channel', fault(child, channel) {
    if (kind === 'encoding') channel.setEncoding = () => { throw problem; };
    if (kind === 'stderr') child.stderr.resume = () => { throw problem; };
    if (kind === 'listener') { const original = channel.on; channel.on = function (...args) { original.apply(this, args); throw problem; }; }
  } });
  let returned = false;
  const refused = assert.rejects(w.KeychainClient.launch(libdir)).then(() => { returned = true; }); await flush();
  assert.equal(w.children[0].child.killed, true); assert.equal(returned, false);
  w.children[0].child.close(); await refused;
});
test('Keychain client: synchronous spawn failure has no acquired child to abandon', async () => {
  const problem = new Error('injected spawn'), w = world({ spawnError: problem });
  await assert.rejects(w.KeychainClient.launch(libdir), error => error === problem); assert.equal(w.children.length, 0);
});
for (const failing of [false, true]) test(`Keychain client: fenced writer ${failing ? 'failure' : 'success'} waits for actual writer close`, async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir);
  let returned = false;
  const run = client.withWriter(73, async writer => {
    const pending = writer.get('engine-managed'); answer(w.children[1].channel); await pending;
    if (failing) throw new StoreError('BROKER_UNAVAILABLE', 'fixture write failed');
    return 'finished';
  });
  const observed = run.then(value => { returned = true; return value; }, error => { returned = true; throw error; });
  const refused = failing ? assert.rejects(observed, unavailable) : undefined;
  await flush(); assert.equal(w.launches[1][4], 73); assert.equal(w.children[1].channel.destroyed, true);
  assert.equal(returned, false, 'returning before close would release the writer fence too early');
  w.children[1].child.close();
  if (failing) await refused; else assert.equal(await observed, 'finished');
  const closed = client.close(); w.children[0].child.close(); await closed;
});
test('NB-30 Keychain client: a request the helper never answers ends within its deadline, and the untrusted channel with it', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir, undefined, { requestMs: 40 }), { child, channel } = w.children[0];
  await assert.rejects(client.get('engine-managed'), error => unavailable(error) && /did not answer .* in time/.test(error.message));
  assert.equal(channel.destroyed, true, 'a channel that cannot order answers is not trusted with the next request');
  const closed = client.close(); child.close(); await closed;
});
test('NB-30 Keychain client: a wedged close ends the child rather than waiting on it forever', async () => {
  const w = world(), client = await w.KeychainClient.launch(libdir, undefined, { closeMs: 40 }), { child } = w.children[0];
  let returned = false;
  const closed = client.close().then(() => { returned = true; });
  for (let i = 0; i < 100 && !child.killed; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(child.killed, true, 'the wedged helper was ended, not waited on');
  assert.equal(returned, false, 'close still waits for the actual child close');
  child.close(); await closed; assert.equal(returned, true);
});
