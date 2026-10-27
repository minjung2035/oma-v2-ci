/** Actual Linux recvmsg backend; no protocol or peer observation is mocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { closeSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FrameParser, encodeFrame } from '@oma/protocol/frame';
import { matchesPinnedSender } from '@oma/broker/peer-authenticator';
import { credentialStream, prepareCredentialListener } from '@oma/platform-linux/credential-stream';
import { pinLinuxPeer } from '@oma/platform-linux/peer-identity';
import { socketDescriptor, peerCred, peerPidFd, pidfdLiveness } from '@oma/native/linux';

assert.equal(process.platform, 'linux');
async function transferFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'oma-real-transfer-')), path = join(root, 'peer.sock');
  const server = createServer({ pauseOnConnect: true });
  const children = []; let clientCopy, raw, stream, pin;
  t.after(async () => {
    stream?.destroy(); raw?.destroy(); clientCopy?.destroy();
    const closed = children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'close'));
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(closed); pin?.close();
    await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true });
  });
  server.listen(path); await once(server, 'listening'); prepareCredentialListener(server);
  const spawn = async mode => {
    const child = fork(fileURLToPath(new URL('./fixtures/socket-transfer.mjs', import.meta.url)), [mode, path], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    children.push(child); const [ready] = await once(child, 'message'); assert.equal(ready.ready, true); return child;
  };
  const holder = await spawn('holder'); // Exists before the original connect.
  const accepted = once(server, 'connection'), connector = await spawn('connector'); [raw] = await accepted;
  const original = peerCred(socketDescriptor(raw)); assert.equal(original.pid, connector.pid);
  pin = pinLinuxPeer(raw); assert.ok(pin);
  const peer = pin;
  assert.equal(peer.sameSender(original), false, 'connection credentials alone are not per-message kernel evidence');
  const ask = async (child, message, handle) => {
    const reply = once(child, 'message');
    await new Promise((resolve, reject) => child.send(message, handle, { keepOpen: true }, error => error ? reject(error) : resolve()));
    const response = await reply; assert.notEqual(response[0].failed, true, response[0].message); return response;
  };
  return { holder, connector, raw, peer, ask,
    async transfer() {
      const [message, socket] = await ask(connector, { op: 'handoff' }); assert.equal(message.transferred, true);
      clientCopy = socket; socket.pause();
      const [received] = await ask(holder, { op: 'adopt' }, socket); assert.equal(received.adopted, true);
    },
    receive(authorize) { stream = credentialStream(raw, authorize); return stream; },
  };
}
test('credential stream: actual sender is retained across fragmented and backpressured byte reads', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'oma-credential-stream-')), path = join(root, 'peer.sock');
  const server = createServer({ pauseOnConnect: true, allowHalfOpen: true });
  let client, raw, stream, pin;
  t.after(async () => {
    stream?.destroy(); raw?.destroy(); client?.destroy();
    if (pin !== undefined) closeSync(pin);
    await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true });
  });
  server.listen(path); await once(server, 'listening'); prepareCredentialListener(server);
  const accepted = once(server, 'connection');
  client = createConnection(path); await once(client, 'connect'); [raw] = await accepted;
  const original = peerCred(socketDescriptor(raw)); assert.equal(original.pid, process.pid);
  pin = peerPidFd(socketDescriptor(raw)); assert.notEqual(pin, null);
  let reads = 0;
  stream = credentialStream(raw, sender => {
    reads++; assert.deepEqual(sender, original); return pidfdLiveness(pin).kind === 'running';
  });
  const bytes = Buffer.alloc(1024 * 1024 + 37);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
  const digest = createHash('sha256'); let received = 0;
  const completed = new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('data', chunk => {
      digest.update(chunk); received += chunk.length;
      if (received > bytes.length) reject(new Error('stream duplicated bytes'));
      if (received === bytes.length) { stream.pause(); resolve(); }
    });
  });
  for (let offset = 0; offset < bytes.length; offset += 7001) {
    if (!client.write(bytes.subarray(offset, offset + 7001))) await once(client, 'drain');
  }
  await completed;
  assert.equal(digest.digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  assert.ok(reads > 1); assert.ok(stream.readableLength <= 65536);
  const answer = once(client, 'data'); stream.end(Buffer.from('ack')); assert.equal((await answer)[0].toString(), 'ack');
});
test('credential stream: refusal of a real kernel sender delivers no bytes to the frame owner', { timeout: 10000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'oma-credential-refusal-')), path = join(root, 'peer.sock');
  const server = createServer({ pauseOnConnect: true }); let client, raw, stream;
  t.after(async () => { stream?.destroy(); raw?.destroy(); client?.destroy(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true }); });
  server.listen(path); await once(server, 'listening'); prepareCredentialListener(server);
  const accepted = once(server, 'connection'); client = createConnection(path); await once(client, 'connect'); [raw] = await accepted;
  let delivered = 0, observed;
  stream = credentialStream(raw, sender => { observed = sender; return false; });
  const refused = once(stream, 'error'); stream.on('data', bytes => { delivered += bytes.length; });
  client.on('error', () => {}); client.write(Buffer.from('must not reach framing'));
  assert.equal((await refused)[0].code, 'AUTH_FAILED'); assert.equal(delivered, 0); assert.equal(observed.pid, process.pid);
});
for (const queued of [false, true]) test(`credential stream: live connector and pre-existing sibling transfer, queued prefix=${queued}`, { timeout: 15000 }, async t => {
  const f = await transferFixture(t), frame = encodeFrame({ v: 1, id: 'forged', method: 'status.get', params: {} });
  const prefix = queued ? frame.subarray(0, 13) : Buffer.alloc(0);
  if (prefix.length) await f.ask(f.connector, { op: 'write', hex: prefix.toString('hex') });
  await f.transfer();
  // SO_PEERCRED and its pidfd still name the living original connector. The
  // transport must use per-message credentials before feeding the parser.
  assert.equal(f.peer.alive(), true); assert.equal((await f.ask(f.connector, { op: 'alive' }))[0].alive, true);
  const parser = new FrameParser(65536), seen = []; let frames = 0, acceptedBytes = 0;
  const stream = f.receive(sender => { seen.push(sender.pid); return matchesPinnedSender(f.peer, sender); });
  const refused = once(stream, 'error');
  stream.on('data', bytes => { acceptedBytes += bytes.length; frames += parser.feed(bytes).length; });
  await f.ask(f.holder, { op: 'write', hex: frame.subarray(prefix.length).toString('hex') });
  assert.equal((await refused)[0].code, 'AUTH_FAILED');
  assert.equal(frames, 0); assert.equal(acceptedBytes, prefix.length);
  assert.equal(seen.at(-1), f.holder.pid); if (queued) assert.equal(seen[0], f.connector.pid);
  assert.equal(f.peer.alive(), true, 'refusal was not obtained by killing the original connector');
});
