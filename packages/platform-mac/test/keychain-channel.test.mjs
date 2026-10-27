/** Real POSIX sockets and clocks on Linux and both Darwin CI images. Scripted
 * replies verify framing, not signed Keychain access, TCC or G-AUTH. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { setImmediate } from 'node:timers/promises';
import { controlSocketPair } from '@oma/native/control-socket';
import { closeEvery } from '@oma/native/files';
import { withAsyncCleanup } from '@oma/native/cleanup';
import { NativeChannel } from '@oma/platform-mac/native-channel';
import { StoreError } from '@oma/domain/errors';

async function fixture(t) {
  const pair = controlSocketPair(); let left = pair.parent, right = pair.child;
  let client, server; const closed = [];
  try {
    client = new Socket({ fd: left, readable: true, writable: true }); left = undefined;
    client.on('error', () => {}); closed.push(new Promise(resolve => client.once('close', resolve)));
    server = new Socket({ fd: right, readable: true, writable: true }); right = undefined;
    server.on('error', () => {}); closed.push(new Promise(resolve => server.once('close', resolve)));
    const channel = new NativeChannel(client, { endedMessage: 'Keychain channel ended',
      refusal: () => new StoreError('BROKER_UNAVAILABLE', 'Keychain access refused') });
    t.after(async () => { channel.close(); server.destroy(); await Promise.all(closed); });
    return { channel, client, server };
  } catch (error) {
    return withAsyncCleanup(async () => { throw error; }, async () => {
      client?.destroy(); server?.destroy();
      await withAsyncCleanup(() => closeEvery(left, right), () => Promise.all(closed));
    });
  }
}
const get = (f, deadline = 10000) => f.channel.request('keychain.get', { account: 'fixture-only' }, deadline);

test('NATIVE-KEYCHAIN-01: real sockets retain fragmented UTF-8, BOM values and out-of-order correlation', { timeout: 10000 }, async t => {
  const f = await fixture(t), first = get(f), second = get(f);
  f.server.write('{"id":2,"ok":true}\n');
  const response = Buffer.from('{"id":1,"ok":true,"value":"\uFEFFfixture-한글"}\n');
  // Yield between individual bytes so partial multibyte sequences really cross
  // writes; the receiver must also handle any coalescing the OS chooses.
  for (const byte of response) { f.server.write(Buffer.from([byte])); await setImmediate(); }
  assert.equal((await first).value, '\uFEFFfixture-한글'); assert.equal((await second).value, undefined);
  const put = f.channel.request('keychain.put', { account: 'fixture-only', value: 'fixture' }, 1000);
  f.server.write('{"id":3,"ok":true}\n'); assert.deepEqual(await put, { id: 3, ok: true });
});

const malformed = [
  ['invalid UTF-8', Buffer.concat([Buffer.from('{"id":1,"ok":true,"value":"'), Buffer.from([0xff]), Buffer.from('"}\n')])],
  ['JSON BOM', Buffer.from('\uFEFF{"id":1,"ok":true}\n')],
  ['duplicate key', Buffer.from('{"id":1,"id":1,"ok":true}\n')],
  ['unknown correlation', Buffer.from('{"id":999,"ok":true}\n')],
  ['retired helper event', Buffer.from('{"event":"ready"}\n')],
  ['nonboolean status', Buffer.from('{"id":1,"ok":"true"}\n')],
  ['unknown field', Buffer.from('{"id":1,"ok":true,"extra":1}\n')],
  ['invalid credential type', Buffer.from('{"id":1,"ok":true,"value":3}\n')],
  ['invalid refusal', Buffer.from('{"id":1,"ok":false}\n')],
  ['oversize line', Buffer.alloc(1024 * 1024 + 1, 0x20)],
];
for (const [name, bytes] of malformed) test(`NATIVE-KEYCHAIN-02: real socket ${name} poisons every pending request`, { timeout: 5000 }, async t => {
  const f = await fixture(t), pending = [get(f), get(f)];
  const refused = pending.map(p => assert.rejects(p, { code: 'BROKER_UNAVAILABLE' }));
  f.server.write(Buffer.concat([bytes, Buffer.from('{"id":1,"ok":true,"value":"must-not-revive"}\n')]));
  await Promise.all(refused); assert.equal(f.client.destroyed, true);
  await assert.rejects(get(f), { code: 'BROKER_UNAVAILABLE' });
});

for (const ending of ['end', 'destroy']) test(`NATIVE-KEYCHAIN-03: real socket ${ending} rejects an unterminated credential`, { timeout: 5000 }, async t => {
  const f = await fixture(t), refused = assert.rejects(get(f), { code: 'BROKER_UNAVAILABLE' });
  if (ending === 'end') f.server.end('{"id":1,"ok":true,"value":"partial');
  else f.server.destroy();
  await refused; await assert.rejects(get(f), { code: 'BROKER_UNAVAILABLE' });
});
test('NATIVE-KEYCHAIN-04: real timeout ends correlation and rejects other pending work', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await Promise.all([assert.rejects(get(f, 20), { code: 'BROKER_UNAVAILABLE' }), assert.rejects(get(f), { code: 'BROKER_UNAVAILABLE' })]);
  assert.equal(f.client.destroyed, true); await assert.rejects(get(f), { code: 'BROKER_UNAVAILABLE' });
});
test('NATIVE-KEYCHAIN-05: retired VM operations write no request and cannot reach the helper', { timeout: 5000 }, async t => {
  const f = await fixture(t), requests = [];
  f.server.on('data', chunk => requests.push(chunk));
  await assert.rejects(f.channel.request('vm.start', {}, 1000), { code: 'INVALID_REQUEST' });
  await setImmediate(); assert.equal(requests.length, 0);
  const valid = get(f); f.server.write('{"id":1,"ok":true}\n'); await valid;
});
