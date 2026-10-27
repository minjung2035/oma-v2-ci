// DR27/P0-4/P0-5: real session ownership over fake PTY, child and time boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import * as terminalProtocol from "@oma/protocol/host-guest";
import * as historyProtocol from "@oma/protocol/host-history";
import { parseJsonObject } from "@oma/protocol/frame";
const code = ts.transpileModule(readFileSync(process.env.OMA_GUEST_SESSION_SOURCE ?? 'apps/oma/src/platform/guest/session.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function world({ pid = 100 } = {}) {
  const timers = new Set(), scheduled = [], closed = [], terminals = [], ends = [];
  const replies = [];
  const handoff = Object.assign(new EventEmitter(), { write(bytes) { replies.push(bytes); return true; }, end() {}, destroy() { this.emit('close'); } });
  const child = Object.assign(new EventEmitter(), { pid, stdio: [null, null, null, handoff], exitCode: null, signalCode: null, kills: [],
    kill(signal) { this.kills.push(signal); return true; } });
  class ReadStream extends EventEmitter {
    destroyed = false;
    constructor(fd) { super(); this.fd = fd; terminals.push(this); }
    write() { return true; }
    destroy() { this.destroyed = true; }
  }
  const dependencies = {
    'node:fs': { closeSync(fd) { closed.push(fd); } },
    'node:tty': { default: { ReadStream } },
    "@oma/process/async": { spawnInTerminal() { return child; } },
    "@oma/native/pty": { openPseudoTerminal() { return { master: 10, slave: 11 }; }, setWindowSize() {} },
    '../terminal-modes.js': { TerminalModes: class { feed() {} replay() { return ''; } } },
    '@oma/protocol/frame': { FrameParser, encodeFrame, parseJsonObject },
    '@oma/protocol/host-guest': terminalProtocol,
    '@oma/protocol/host-history': historyProtocol,
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer,
    setTimeout(run, ms) { const timer = { run, ms, unref() {} }; timers.add(timer); scheduled.push(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  const session = module.exports.TerminalSession.start({ executable: '/fake', argv: [], cwd: '/fake', env: {} },
    { columns: 80, rows: 24, backlogBytes: 1024 });
  session.onEnd(end => ends.push({ ...end }));
  return { session, child, handoff, replies, terminal: terminals[0], timers, scheduled, closed, ends,
    exit(code = 0, signal = null, endHandoff = true) {
      child.exitCode = code; child.signalCode = signal; child.emit('exit', code, signal);
      if (endHandoff) handoff.emit('end');
    },
    tick() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
  };
}
test('DR29: host resume handoff requires actual child exit, terminal drain and complete private EOF', () => {
  const w = world(), history = historyProtocol.hostHistoryReference({ birthId: '11111111-1111-4111-8111-111111111111', file: 'saved.jsonl', sessionId: 'saved-id' });
  w.handoff.emit('data', encodeFrame({ next: 'resume', history }));
  w.exit(0, null, false); w.terminal.emit('end'); assert.deepEqual(w.ends, []);
  w.handoff.emit('end'); assert.deepEqual(w.ends, [{ code: 0, signal: null, next: 'resume', history }]);
});
test('DR29: host observations cannot substitute for an outgoing writer ending or authorize a guest-supplied path', () => {
  const w = world(); w.handoff.emit('data', encodeFrame({ id: 'host-history-1', method: 'list' }));
  const parser = new FrameParser(65535); assert.match(parser.feed(w.replies[0])[0].raw.error, /Attach a host terminal/);
  w.handoff.emit('data', encodeFrame({ next: 'resume', history: '/host/saved.jsonl' }));
  w.exit(); w.terminal.emit('end'); assert.deepEqual(w.ends, [{ code: 0, signal: null }]);
});
for (const event of ['end', 'error', 'close']) {
  test(`guest session: ${event} after exit returns the drain timer`, () => {
    const w = world(); w.exit(7); assert.equal(w.ends.length, 0); assert.equal(w.timers.size, 1);
    const old = [...w.timers][0]; w.terminal.emit(event, new Error('pty ended'));
    assert.deepEqual(w.ends, [{ code: 7, signal: null }]); assert.equal(w.timers.size, 0);
    assert.equal(w.terminal.destroyed, true); old.run(); assert.equal(w.ends.length, 1);
  });
}
test('guest session: terminal drainage before exit does not acquire a redundant timer', () => {
  const w = world(); w.terminal.emit('end'); assert.equal(w.ends.length, 0); w.exit();
  assert.deepEqual(w.ends, [{ code: 0, signal: null }]); assert.equal(w.timers.size, 0);
  assert.equal(w.scheduled.length, 0, 'an already-drained session acquired an unnecessary timer');
});
test('guest session: drainage stays bounded after actual child exit', () => {
  const w = world(); w.exit(null, 'SIGTERM'); assert.equal(w.ends.length, 0);
  assert.equal([...w.timers][0].ms, 1000); w.tick();
  assert.deepEqual(w.ends, [{ code: null, signal: 'SIGTERM' }]); assert.equal(w.timers.size, 0);
});
test('guest session: a live child error is not death even when the PTY is drained', () => {
  const w = world(); w.terminal.emit('end'); w.child.emit('error', new Error('signal was refused'));
  assert.equal(w.session.end, null); assert.equal(w.terminal.destroyed, false); assert.equal(w.ends.length, 0);
  w.exit(9); assert.deepEqual(w.ends, [{ code: 9, signal: null }]);
});
test('guest session: a failed spawn settles when child close confirms no process', () => {
  const w = world({ pid: null }); w.child.pid = undefined;
  w.child.emit('error', new Error('spawn failed'));
  assert.equal(w.ends.length, 0, 'error alone is not a closed child');
  w.child.emit('close', -2, null); w.handoff.emit('close');
  assert.deepEqual(w.ends, [{ code: null, signal: null }]); assert.equal(w.terminal.destroyed, true);
  assert.equal(w.timers.size, 0);
});
test('guest session: terminate never signals an exited child still draining output', () => {
  const w = world(); w.exit(); w.session.terminate(); assert.deepEqual(w.child.kills, []);
  w.tick(); w.session.terminate(); assert.deepEqual(w.child.kills, []);
});
test('guest session: a refused signal remains pending until actual exit', () => {
  const w = world(); w.child.kill = signal => {
    w.child.kills.push(signal); w.child.emit('error', new Error('signal failed')); return false;
  };
  w.session.terminate(); w.session.terminate();
  assert.equal(w.session.end, null); assert.equal(w.ends.length, 0);
  w.terminal.emit('end'); assert.equal(w.ends.length, 0); w.exit(5);
  assert.deepEqual(w.ends, [{ code: 5, signal: null }]);
});
for (const first of ['request', 'exit']) test(`guest handoff: ${first} alone cannot authorize a new host session`, () => {
  const w = world(); w.terminal.emit('end');
  if (first === 'request') { w.handoff.emit('data', encodeFrame({ next: 'new' })); w.handoff.emit('end'); }
  else w.exit(0, null, false);
  assert.equal(w.ends.length, 0);
  if (first === 'request') w.exit();
  else { w.handoff.emit('data', encodeFrame({ next: 'new' })); w.handoff.emit('end'); }
  assert.deepEqual(w.ends, [{ code: 0, signal: null, next: 'new' }]);
});
for (const ending of ['nonzero', 'signal', 'truncated', 'trailing-partial', 'duplicate', 'unknown', 'path', 'error', 'close'])
  test(`guest handoff: ${ending} never becomes a new host session`, () => {
    const w = world(); w.terminal.emit('end');
    const bytes = encodeFrame({ next: 'new' });
    w.handoff.emit('data', ending === 'truncated' ? bytes.subarray(0, bytes.length - 1)
      : ending === 'trailing-partial' ? Buffer.concat([bytes, Buffer.from([0])])
      : ending === 'unknown' ? encodeFrame({ next: 'personal' })
      : ending === 'path' ? encodeFrame({ next: 'new', cwd: '/guest' }) : bytes);
    if (ending === 'duplicate') w.handoff.emit('data', bytes);
    if (ending === 'error') w.handoff.emit('error', new Error('pipe failed'));
    if (ending === 'close') w.handoff.emit('close');
    w.exit(ending === 'nonzero' ? 7 : 0, ending === 'signal' ? 'SIGTERM' : null);
    assert.equal(w.ends.length, 1); assert.equal(Object.hasOwn(w.ends[0], 'next'), false);
  });
test('guest handoff: a terminal drain timeout does not substitute for private stream completion or child exit', () => {
  const w = world(); w.handoff.emit('data', encodeFrame({ next: 'new' }));
  w.child.emit('error', new Error('signal failed')); w.tick(); assert.equal(w.ends.length, 0);
  w.exit(0, null, false); w.tick(); assert.equal(w.ends.length, 0);
  w.handoff.emit('end'); assert.deepEqual(w.ends, [{ code: 0, signal: null, next: 'new' }]);
});
