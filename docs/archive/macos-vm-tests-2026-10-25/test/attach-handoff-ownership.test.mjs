import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostErrorMeaning from "@oma/protocol/host-errors";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
// MAC-222/230 and MODE-006: actual attach owner over controlled transport/terminal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import * as protocol from "@oma/protocol/host-guest";
import { TerminalModes } from "#oma-test/app/platform/terminal-modes";
import { withAsyncCleanup } from "@oma/native/cleanup";
import { parseJsonObject } from "@oma/protocol/frame";
import * as histories from "@oma/protocol/host-history";
const code = ts.transpileModule(readFileSync(process.env.OMA_ATTACH_CLIENT_SOURCE ?? 'apps/oma/src/platform/host/attach-client.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
async function world(fault, rest = Buffer.alloc(0), observe) {
  const problem = new Error(`fixture ${fault}`);
  const sent = [];
  const socket = Object.assign(new EventEmitter(), { write(bytes) { sent.push(bytes); }, unshift() {}, resume() { if (fault === 'sync-close') this.emit('close'); },
    destroy() { queueMicrotask(() => this.emit('close')); } });
  const raw = [], writes = [], resize = [], signals = new Map();
  const input = Object.assign(new EventEmitter(), { isTTY: true, paused: false,
    setRawMode(on) { raw.push(on); if (fault === 'raw-acquire' && on || fault === 'raw-return' && !on) throw problem; },
    resume() { this.paused = false; }, pause() { this.paused = true; } });
  const deps = {
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/protocol/host-errors": hostErrorMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

    '../rpc.js': { async connectSocket() { return socket; }, async readLeadingResponse(_socket, id) { return { result: {}, rest: id === 'attach' ? rest : Buffer.alloc(0) }; } },
    '@oma/protocol/frame': { encodeFrame: value => value, parseJsonObject }, '../terminal-modes.js': { TerminalModes },
    '@oma/protocol/host-history': histories,
    "@oma/native/cleanup": { withAsyncCleanup },
    "@oma/broker/lifetime": { HOST_LOSS_SIGNALS: ['SIGTERM'] },
    '@oma/protocol/host-api': { HOST_API_VERSION: 2 }, '@oma/protocol/host-guest': protocol,
  };
  const module = { exports: {} };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer, Promise, AggregateError,
    process: { on(name, listener) { signals.set(name, listener); }, off(name) { signals.delete(name); } },
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(deps, name)) return sessionHandoffMeaning;
if (name === "@oma/protocol/host-errors" && !Object.hasOwn(deps, name)) return hostErrorMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(deps, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(deps, name)) return deploymentMeaning;
 assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  let settled = false;
  const pending = module.exports.attachTerminal({ socketPath: '/fixture', token: 'fixture', society: 'demo', takeover: false,
    histories: observe,
    frameBytes: 262144, deadlineMs: 5000, terminal: { input, output: { write(bytes) { writes.push(bytes.toString()); if (fault === 'output-return') throw problem; } },
      onResize(listener) { if (fault === 'resize-acquire') throw problem; resize.push(listener);
        return () => { resize.pop(); if (fault === 'resize-return') throw problem; }; } } }).then(end => { settled = true; return { ...end }; });
  pending.catch(() => {});
  await flush(); if (!fault) assert.equal(input.listenerCount('data'), 1);
  return { socket, input, raw, writes, sent, resize, signals, pending, problem, settled: () => settled };
}
const frame = value => protocol.encodeTerminalFrame('exit', Buffer.from(JSON.stringify(value)));
const normal = { code: 0, signal: null, next: 'new' };
test('DR29: host history replies are owned by this screen; a late observation after exit cannot write a control reply', async () => {
  const pending = [];
  const w = await world(undefined, Buffer.alloc(0), query => new Promise(resolve => pending.push({ query, resolve })));
  const request = id => protocol.encodeTerminalJson('historyQuery', { id: `host-history-${id}`, method: 'list' });
  w.socket.emit('data', request(1)); await flush(); assert.equal(pending.length, 1);
  w.socket.emit('data', request(2)); await flush(); assert.equal(pending.length, 2);
  const before = w.sent.length;
  pending[0].resolve({ sessions: [], after: null }); await flush(); assert.equal(w.sent.length, before);
  pending[1].resolve({ sessions: [], after: null }); await flush(); assert.equal(w.sent.length, before + 1);
  const parser = new protocol.TerminalFrameParser(), response = parser.feed(w.sent.at(-1))[0];
  assert.equal(response.kind, 'histories'); assert.deepEqual(JSON.parse(response.payload.toString()), { id: 'host-history-2', result: { sessions: [], after: null } });
  w.socket.emit('data', request(3)); await flush();
  w.socket.emit('data', frame(normal)); w.socket.emit('close'); await w.pending;
  const final = w.sent.length; pending[2].resolve({ sessions: [], after: null }); await flush(); assert.equal(w.sent.length, final);
});
test('attach handoff: a complete successful exit waits for close and returns the entire attach lifetime', async () => {
  const w = await world();
  w.socket.emit('data', protocol.encodeTerminalFrame('output', Buffer.from('\x1b[?1049h\x1b[?2004h')));
  w.socket.emit('data', frame(normal)); await flush(); assert.equal(w.settled(), false);
  w.socket.emit('close'); assert.deepEqual(await w.pending, { kind: 'exit', ...normal });
  assert.deepEqual(w.raw, [true, false]); assert.equal(w.input.paused, true); assert.equal(w.input.listenerCount('data'), 0);
  assert.deepEqual(w.resize, []); assert.equal(w.signals.size, 0); assert.match(w.writes.at(-1), /\x1b\[\?1049l$/);
});
for (const kind of ['eof', 'bad-exit', 'duplicate-key', 'duplicate-exit', 'trailing-partial', 'trailing-invalid', 'wrong-direction'])
  test(`attach handoff: ${kind} is lost, not replacement authority`, async () => {
    const w = await world();
    const bytes = kind === 'bad-exit' ? frame({ ...normal, code: 7 })
      : kind === 'duplicate-key' ? protocol.encodeTerminalFrame('exit', Buffer.from('{"code":7,"code":0,"signal":null,"next":"new"}'))
      : kind === 'duplicate-exit' ? Buffer.concat([frame(normal), frame(normal)])
      : kind === 'trailing-partial' ? Buffer.concat([frame(normal), Buffer.from([0])])
      : kind === 'trailing-invalid' ? Buffer.concat([frame(normal), Buffer.from([0, 0, 0, 1, 0xff])])
      : kind === 'wrong-direction' ? protocol.encodeTerminalFrame('input', Buffer.from('q')) : Buffer.alloc(0);
    if (bytes.length > 0) w.socket.emit('data', bytes);
    w.socket.emit('close'); assert.deepEqual(await w.pending, { kind: 'lost' });
    assert.deepEqual(w.raw, [true, false]); assert.equal(w.input.listenerCount('data'), 0); assert.equal(w.signals.size, 0);
  });
test('attach handoff: a transport error after a guest exit is lost, not a new birth', async () => {
  const w = await world(); w.socket.emit('data', frame(normal)); w.socket.emit('error', new Error('reset'));
  assert.deepEqual(await w.pending, { kind: 'lost' }); assert.deepEqual(w.raw, [true, false]);
});
for (const fault of ['raw-acquire', 'resize-acquire', 'resize-return', 'output-return', 'raw-return'])
  test(`attach handoff: ${fault} returns all other owners and grants no birth`, async () => {
    const w = await world(fault);
    if (fault.endsWith('return')) { w.socket.emit('data', frame(normal)); w.socket.emit('close'); }
    await assert.rejects(w.pending, error => error === w.problem);
    assert.deepEqual(w.raw, [true, false]); assert.equal(w.input.listenerCount('data'), 0);
    assert.equal(w.input.paused, true); assert.equal(w.resize.length, 0); assert.equal(w.signals.size, 0);
    assert.equal(w.socket.listenerCount('data'), 0); assert.equal(w.socket.listenerCount('error'), 0);
    assert.equal(w.socket.listenerCount('close'), 0);
  });
test('attach handoff: synchronous close while resuming cannot miss the close owner', async () => {
  const w = await world('sync-close', frame(normal));
  assert.equal(w.settled(), true, 'synchronous close was not observed');
  assert.deepEqual(await w.pending, { kind: 'exit', ...normal }); assert.deepEqual(w.raw, [true, false]);
});
test('attach handoff: a local stop remains a stop even after a guest request', async () => {
  const w = await world(); w.socket.emit('data', frame(normal)); w.signals.get('SIGTERM')('SIGTERM');
  assert.deepEqual(await w.pending, { kind: 'stopped', signal: 'SIGTERM' }); assert.deepEqual(w.raw, [true, false]);
});
