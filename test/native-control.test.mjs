/** Same real POSIX primitive tests run on Linux and both Darwin CI images. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, readSync, writeSync } from 'node:fs';
import { Socket } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { load } from 'koffi';
import { controlPipe, controlSocketPair, closeOnExec } from '@oma/native/control-socket';
assert.ok(['linux', 'darwin'].includes(process.platform));
const fcntl = load(null).func('int fcntl(int fd, int command, ...)');
const openDescriptors = () => Array.from({ length: 512 }, (_, fd) => fd).filter(fd => fcntl(fd, 1) !== -1);
test('POSIX control pipe: actual byte transfer, CLOEXEC and exact descriptor return', () => {
  const before = openDescriptors();
  for (let n = 0; n < 64; n++) {
    const pipe = controlPipe();
    try {
      assert.equal(fcntl(pipe.read, 1) & 1, 1); assert.equal(fcntl(pipe.write, 1) & 1, 1);
      const payload = Buffer.from(`private-${n}`), received = Buffer.alloc(payload.length);
      assert.equal(writeSync(pipe.write, payload), payload.length); assert.equal(readSync(pipe.read, received), payload.length);
      assert.deepEqual(received, payload);
    } finally { closeSync(pipe.read); closeSync(pipe.write); }
  }
  assert.deepEqual(openDescriptors(), before);
});
test('POSIX control socket: actual cross-process duplex handoff, EOF and joined close', { timeout: 15000 }, async () => {
  const pair = controlSocketPair(); let parent, child;
  try {
    assert.equal(fcntl(pair.parent, 1) & 1, 1); assert.equal(fcntl(pair.child, 1) & 1, 1);
    parent = new Socket({ fd: pair.parent, readable: true, writable: true });
    child = spawn(process.execPath, ['--input-type=module', '-e', `import {Socket} from 'node:net'; const socket=new Socket({fd:3,readable:true,writable:true});socket.once('data',bytes=>socket.end(Buffer.from(bytes).reverse()));`],
      { stdio: ['ignore', 'ignore', 'inherit', pair.child] });
  } catch (error) { if (parent) parent.destroy(); else closeSync(pair.parent); throw error; }
  finally { closeSync(pair.child); }
  const joined = once(child, 'close'); const chunks = [];
  try {
    parent.on('data', bytes => chunks.push(bytes)); const ended = once(parent, 'end');
    parent.write('private-control'); await ended; assert.equal(Buffer.concat(chunks).toString(), 'lortnoc-etavirp');
    const [code, signal] = await joined; assert.equal(code, 0); assert.equal(signal, null);
  } finally { parent.destroy(); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await joined; }
});
test('POSIX CLOEXEC: direct exec replacement cannot retain a marked capability', { timeout: 15000 }, async () => {
  const pair = controlPipe(); let child;
  try {
    child = spawn(process.execPath, ['--input-type=module', '-e', `import {load} from 'koffi'; import {closeOnExec} from '@oma/native/control-socket';
      const control=load(null).func('int fcntl(int fd, int command, ...)'); const fd=control(3,0,'int',200);
      if(fd!==200)throw Error('failed to reserve actual exec capability');closeOnExec(fd);
      process.execve(process.execPath,[process.execPath,'--input-type=module','-e',"import {fstatSync} from 'node:fs';import assert from 'node:assert/strict';assert.throws(()=>fstatSync(200),{code:'EBADF'});"],process.env);`],
      { stdio: ['ignore', 'ignore', 'inherit', pair.write] });
  } finally { closeSync(pair.read); closeSync(pair.write); }
  const [code, signal] = await once(child, 'close'); assert.equal(code, 0); assert.equal(signal, null);
});
