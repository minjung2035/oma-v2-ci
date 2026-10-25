import { closeSync, fstatSync, lstatSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { ProcessLock } from '@oma/native/process-lock';
import { linkAt } from '@oma/native/posix-files';

const [mode, root, detail] = process.argv.slice(2);
const reply = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));
if (mode === 'publish') {
  process.on('message', message => {
    if (message.op === 'close') { closeSync(3); process.disconnect(); return; }
    try { linkAt(3, message.source, 3, message.target); process.send({ round: message.round, result: 'published' }); }
    catch (error) { process.send({ round: message.round, result: 'error', code: error.code, message: error.message }); }
  });
  await reply({ ready: true });
} else if (mode === 'lock') {
  const lock = ProcessLock.acquire(root);
  process.on('message', () => { lock.close(); process.disconnect(); });
  await reply({ ready: true });
} else if (mode === 'retain') {
  process.on('message', () => { closeSync(3); process.disconnect(); });
  await reply({ ready: true });
} else if (mode === 'inspect') {
  const inherited = JSON.parse(detail).map(expected => {
    try { const stat = fstatSync(expected.fd, { bigint: true }); return String(stat.dev) === expected.dev && String(stat.ino) === expected.ino; }
    catch (error) { if (error.code === 'EBADF') return false; throw error; }
  });
  await reply({ inherited }); process.disconnect();
} else if (mode === 'connect') {
  const socket = createConnection(root); await once(socket, 'connect');
  process.on('message', () => socket.end());
  socket.on('close', () => process.disconnect());
  socket.write(JSON.stringify({ claimedUid: -1 }));
  await reply({ ready: true });
} else if (mode === 'race') {
  const live = root + '/branch', parked = root + '/parked';
  let stopped = false, swaps = 0;
  process.on('message', () => { stopped = true; });
  process.on('disconnect', () => { stopped = true; });
  await reply({ ready: true });
  try {
    while (!stopped) {
      renameSync(live, parked);
      symlinkSync(detail, live);
      unlinkSync(live);
      renameSync(parked, live);
      swaps++;
      await setImmediate();
    }
  } finally {
    if (lstatSync(parked, { throwIfNoEntry: false })) {
      if (lstatSync(live, { throwIfNoEntry: false })) unlinkSync(live);
      renameSync(parked, live);
    }
  }
  await reply({ swaps }); process.disconnect();
} else throw new Error('unknown OS fixture mode');
