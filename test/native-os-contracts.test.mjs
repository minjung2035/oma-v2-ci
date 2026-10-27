import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { peerUid } from '@oma/native/peer-uid';
import { closeSync, constants, existsSync, fchmodSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { ProcessLock } from '@oma/native/process-lock';
import { closeEvery, openBeneath, openDirectory } from '@oma/native/files';
import { directoryNames, readlinkAt, readlinkBytesAt } from '@oma/native/posix-files';
import { hostProcessProbe } from '@oma/broker/process-ancestry';
import { withCleanup } from '@oma/native/cleanup';

const fixture = fileURLToPath(new URL('./fixtures/native-os-actor.mjs', import.meta.url));
const owners = new WeakMap();
function scratch(t, base = tmpdir()) {
  const root = realpathSync(mkdtempSync(join(base, 'oma-os-contracts-')));
  const children = []; owners.set(t, children);
  t.after(async () => {
    const results = await Promise.allSettled(children.map(close => close()));
    const errors = results.filter(x => x.status === 'rejected').map(x => x.reason);
    try { rmSync(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'OS fixture cleanup failed');
  }); return root;
}
function actor(t, args, fd) {
  const child = spawn(process.execPath, [fixture, ...args], { stdio: fd === undefined ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe', fd, 'ipc'] });
  let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal, stderr })); });
  const messages = [], waiting = [];
  child.on('message', message => { if (waiting.length) waiting.shift()(message); else messages.push(message); });
  const receive = () => messages.length ? Promise.resolve(messages.shift()) : Promise.race([new Promise(resolve => waiting.push(resolve)), closed.then(result => { throw new Error('fixture closed before its reply: ' + JSON.stringify(result)); })]);
  const cleanup = async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; };
  const registry = owners.get(t); if (!registry) throw new Error('child requires its scratch owner first'); registry.push(cleanup);
  return { child, closed, receive, send: message => new Promise((resolve, reject) => child.send(message, error => error ? reject(error) : resolve())) };
}

test('real OS: no-replace publication has exactly one winner in cross-process races', { timeout: 30000 }, async t => {
  const root = scratch(t); writeFileSync(join(root, 'a'), 'immutable-a'); writeFileSync(join(root, 'b'), 'immutable-b');
  const held = openDirectory(root);
  try {
    const a = actor(t, ['publish'], held), b = actor(t, ['publish'], held);
    assert.deepEqual(await a.receive(), { ready: true }); assert.deepEqual(await b.receive(), { ready: true });
    for (let round = 0; round < 16; round++) {
      const target = 'published-' + round;
      await Promise.all([a.send({ round, source: 'a', target }), b.send({ round, source: 'b', target })]);
      const answers = await Promise.all([a.receive(), b.receive()]);
      assert.deepEqual(answers.map(x => x.round), [round, round]);
      assert.equal(answers.filter(x => x.result === 'published').length, 1, JSON.stringify(answers));
      assert.deepEqual(answers.filter(x => x.result === 'error').map(x => x.code), ['EEXIST']);
      assert.equal(readFileSync(join(root, target), 'utf8'), answers[0].result === 'published' ? 'immutable-a' : 'immutable-b');
    }
    await Promise.all([a.send({ op: 'close' }), b.send({ op: 'close' })]);
    for (const x of [await a.closed, await b.closed]) assert.equal(x.code, 0, x.stderr);
    assert.ok(fstatSync(held).isDirectory());
  } finally { closeSync(held); }
});

test('real OS: flock contention and SIGKILL release follow the actual owning process', { timeout: 20000 }, async t => {
  const root = scratch(t), path = join(root, 'broker.lock'), owner = actor(t, ['lock', path]);
  assert.deepEqual(await owner.receive(), { ready: true });
  assert.equal(ProcessLock.tryAcquire(path), null);
  const identity = hostProcessProbe.identity(owner.child.pid); assert.ok(identity);
  assert.equal(hostProcessProbe.ended(identity), 'running');
  owner.child.kill('SIGKILL'); const result = await owner.closed; assert.equal(result.signal, 'SIGKILL');
  assert.equal(hostProcessProbe.ended(identity), 'ended');
  const next = ProcessLock.acquire(path); next.assertHeld(path); next.close(); next.close();
  assert.throws(() => next.descriptor, { code: 'BROKER_UNAVAILABLE' });
});

test('real OS: an inherited descriptor keeps flock after the parent owner closes', { timeout: 20000 }, async t => {
  const root = scratch(t), path = join(root, 'broker.lock'), original = ProcessLock.acquire(path);
  try {
    const retained = actor(t, ['retain'], original.descriptor); assert.deepEqual(await retained.receive(), { ready: true });
    original.close(); assert.equal(ProcessLock.tryAcquire(path), null);
    await retained.send({ close: true }); assert.equal((await retained.closed).code, 0);
    const next = ProcessLock.acquire(path); try { next.assertHeld(path); } finally { next.close(); }
  } finally { original.close(); }
});

test('real OS: native root and file capabilities are closed across exec without explicit handoff', { timeout: 20000 }, async t => {
  const root = scratch(t), held = openDirectory(root), file = openBeneath(held, 'data', constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600);
  try {
    const identities = [held, file].map(fd => { const s = fstatSync(fd, { bigint: true }); return { fd, dev: String(s.dev), ino: String(s.ino) }; });
    const child = actor(t, ['inspect', '-', JSON.stringify(identities)]);
    assert.deepEqual(await child.receive(), { inherited: [false, false] }); assert.equal((await child.closed).code, 0);
    assert.ok(fstatSync(held).isDirectory()); assert.ok(fstatSync(file).isFile());
  } finally { closeSync(file); closeSync(held); }
});

test('real OS: directory cursors cover multiple buffers and leave no descriptor behind on repeated use', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oma-os-cursors-'))), held = openDirectory(root);
  try {
    for (let i = 0; i < 520; i++) writeFileSync(join(root, String(i).padStart(4, '0') + '-한글-🙂'), '');
    const expected = readdirSync(root).sort();
    for (let i = 0; i < 4; i++) assert.deepEqual(directoryNames(held), expected);
    const fdRoot = process.platform === 'darwin' ? '/dev/fd' : '/proc/self/fd';
    const baseline = readdirSync(fdRoot).length;
    for (let i = 0; i < 64; i++) assert.deepEqual(directoryNames(held), expected);
    assert.equal(readdirSync(fdRoot).length, baseline, 'every fdopendir cursor must have been closed');
    assert.ok(fstatSync(held).isDirectory());
  } finally { closeSync(held); rmSync(root, { recursive: true, force: true }); }
});

test('real OS: readlink preserves raw bytes, long targets and syscall errors', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'oma-os-links-'))), held = openDirectory(root);
  try {
    const raw = Buffer.from([0x2e, 0x2e, 0x2f, 0xff, 0xfe]);
    symlinkSync(raw, join(root, 'raw'));
    assert.deepEqual(readlinkBytesAt(held, 'raw'), raw);
    assert.throws(() => readlinkAt(held, 'raw'), TypeError);
    const long = '\ufeff../' + 'x'.repeat(700); symlinkSync(long, join(root, 'long'));
    assert.deepEqual(readlinkBytesAt(held, 'long'), Buffer.from(long)); assert.equal(readlinkAt(held, 'long'), long);
    writeFileSync(join(root, 'plain'), 'plain');
    assert.throws(() => readlinkBytesAt(held, 'plain'), { code: 'EINVAL' });
    assert.throws(() => readlinkBytesAt(held, 'missing'), { code: 'ENOENT' });
  } finally { closeSync(held); rmSync(root, { recursive: true, force: true }); }
});

test('real OS: a concurrent directory-to-symlink swap never writes outside the held root', { timeout: 30000 }, async t => {
  const root = scratch(t), inside = join(root, 'inside'), outside = join(root, 'outside');
  mkdirSync(inside); mkdirSync(outside); mkdirSync(join(inside, 'branch')); writeFileSync(join(outside, 'sentinel'), 'untouched');
  const held = openDirectory(inside);
  try {
    const before = openBeneath(held, 'branch/control', constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600); closeSync(before);
    symlinkSync(outside, join(inside, 'escape'));
    assert.throws(() => openBeneath(held, 'escape/sentinel', constants.O_RDWR), { code: 'STORE_CORRUPT' });
    const race = actor(t, ['race', inside, outside]); assert.deepEqual(await race.receive(), { ready: true });
    let opened = 0, refused = 0;
    for (let i = 0; i < 1200; i++) {
      try { const fd = openBeneath(held, 'branch/written', constants.O_CREAT | constants.O_RDWR, 0o600); try { writeFileSync(fd, 'contained'); opened++; } finally { closeSync(fd); } }
      catch (error) { assert.ok(['STORE_CORRUPT', 'ENOENT', 'EAGAIN'].includes(error.code), String(error)); refused++; }
      if (i % 32 === 0) await setImmediate();
    }
    await race.send({ stop: true }); const stats = await race.receive(); assert.ok(stats.swaps > 0); assert.equal((await race.closed).code, 0);
    // Contended names may all refuse; stable controls before and after must work.
    assert.equal(opened + refused, 1200);
    const after = openBeneath(held, 'branch/control', constants.O_RDONLY); closeSync(after);
    assert.deepEqual(readdirSync(outside), ['sentinel']); assert.equal(readFileSync(join(outside, 'sentinel'), 'utf8'), 'untouched');
    assert.ok(existsSync(join(inside, 'branch')));
  } finally { closeSync(held); }
});


test('real OS: permission failure and a closed directory are errors, never empty observations', t => {
  assert.notEqual(process.getuid(), 0, 'qualification requires an unprivileged test account');
  const root = scratch(t), held = openDirectory(root);
  writeFileSync(join(root, 'retained'), 'retained bytes');
  try {
    assert.deepEqual(directoryNames(held), ['retained']);
    const fdRoot = process.platform === 'darwin' ? '/dev/fd' : '/proc/self/fd';
    const before = readdirSync(fdRoot).length;
    fchmodSync(held, 0);
    try { assert.throws(() => directoryNames(held), { code: 'EACCES' }); }
    finally { fchmodSync(held, 0o700); }
    assert.equal(readdirSync(fdRoot).length, before);
    assert.deepEqual(directoryNames(held), ['retained']);
    assert.equal(readFileSync(join(root, 'retained'), 'utf8'), 'retained bytes');
  } finally { closeSync(held); }
  assert.throws(() => directoryNames(held), { code: 'EBADF' });
});

test('real OS: failed close still closes every remaining owner and retains both syscall failures', t => {
  const root = scratch(t), a = openDirectory(root), b = openDirectory(root);
  closeSync(a);
  assert.throws(() => closeEvery(a, b), { code: 'EBADF' });
  assert.throws(() => fstatSync(b), { code: 'EBADF' });
  const held = openDirectory(root);
  try {
    const bad = openBeneath(held, 'closed', constants.O_CREAT | constants.O_EXCL | constants.O_RDWR, 0o600); closeSync(bad);
    assert.throws(() => withCleanup(() => openBeneath(held, 'missing', constants.O_RDONLY), () => closeSync(bad)), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors.map(item => item.code), ['ENOENT', 'EBADF']); return true;
    });
    assert.ok(fstatSync(held).isDirectory());
  } finally { closeSync(held); }
});

test('real OS: ancestry distinguishes live siblings and retains identity across observed exit', { timeout: 20000 }, async t => {
  const root = scratch(t), a = actor(t, ['lock', join(root, 'a.lock')]), b = actor(t, ['lock', join(root, 'b.lock')]);
  assert.deepEqual(await a.receive(), { ready: true }); assert.deepEqual(await b.receive(), { ready: true });
  const parent = hostProcessProbe.identity(process.pid), first = hostProcessProbe.identity(a.child.pid), sibling = hostProcessProbe.identity(b.child.pid);
  assert.ok(parent && first && sibling);
  assert.equal(hostProcessProbe.parentOf(first.pid), process.pid);
  assert.equal(hostProcessProbe.descendsFrom(first.pid, parent), true);
  assert.equal(hostProcessProbe.descendsFrom(first.pid, sibling), false);
  await a.send({ close: true }); assert.equal((await a.closed).code, 0);
  assert.equal(hostProcessProbe.ended(first), 'ended');
  assert.equal(hostProcessProbe.ended(sibling), 'running');
  await b.send({ close: true }); assert.equal((await b.closed).code, 0);
});


test('real OS: peer UID comes from the kernel and a closed endpoint grants no identity', { timeout: 20000 }, async t => {
  const root = scratch(t, '/tmp'), path = join(root, 'peer.sock'), sockets = new Set();
  const server = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  owners.get(t).push(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const connection = once(server, 'connection'), child = actor(t, ['connect', path]);
  const [peer] = await connection; const data = once(peer, 'data');
  assert.deepEqual(await child.receive(), { ready: true });
  assert.deepEqual(JSON.parse((await data)[0].toString()), { claimedUid: -1 });
  assert.equal(peerUid(peer), process.getuid());
  const closed = once(peer, 'close'); peer.end(); await closed;
  assert.equal(peerUid(peer), null);
  assert.equal((await child.closed).code, 0);
});
