import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostErrorMeaning from "@oma/protocol/host-errors";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
// MODE-006: actual request writer over controlled private descriptor ownership.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { withCleanup } from "@oma/native/cleanup";
const code = ts.transpileModule(readFileSync(process.env.OMA_SESSION_HANDOFF_SOURCE ?? 'apps/oma/src/runtime/session-handoff.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function world(env, failure, chunk = Infinity, closeFailure) {
  const writes = [], closed = [], module = { exports: {} };
  const deps = {
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/protocol/host-errors": hostErrorMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,
 'node:fs': {
    writeSync(fd, bytes, at, length) {
      if (failure === 'throw') throw new Error('write failed');
      const count = failure === 'zero' ? 0 : Math.min(chunk, length);
      writes.push([fd, bytes.subarray(at, at + count)]); return count;
    }, closeSync(fd) { closed.push(fd); if (closeFailure) throw closeFailure; },
  }, '@oma/protocol/frame': { encodeFrame }, "@oma/native/cleanup": { withCleanup } };
  new Script(code).runInNewContext({ module, exports: module.exports, Buffer, process: { env },
    require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(deps, name)) return sessionHandoffMeaning;
if (name === "@oma/protocol/host-errors" && !Object.hasOwn(deps, name)) return hostErrorMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(deps, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(deps, name)) return deploymentMeaning;
 assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  return { ...module.exports, writes, closed };
}
test('host handoff writer: a direct Linux session has no private request or descriptor effects', () => {
  const w = world({}); assert.equal(w.requestHostNewSession(), false);
  assert.deepEqual(w.writes, []); assert.deepEqual(w.closed, []);
});
for (const value of ['4', '', '03', '3x']) test(`host handoff writer: invalid declared descriptor ${JSON.stringify(value)} is refused`, () => {
  const w = world({ OMA_HOST_SESSION_HANDOFF: value });
  assert.throws(() => w.requestHostNewSession(), /descriptor/); assert.deepEqual(w.writes, []); assert.deepEqual(w.closed, []);
});
test('host handoff writer: partial writes complete one strict request and return descriptor 3 once', () => {
  const w = world({ OMA_HOST_SESSION_HANDOFF: '3' }, undefined, 3);
  assert.equal(w.requestHostNewSession(), true); assert.ok(w.writes.length > 1);
  assert.ok(w.writes.every(([fd]) => fd === 3)); assert.deepEqual(w.closed, [3]);
  const parser = new FrameParser(65535), frames = parser.feed(Buffer.concat(w.writes.map(([, bytes]) => bytes)));
  assert.equal(frames.length, 1); assert.deepEqual(frames[0].raw, { next: 'new' }); parser.finish();
});
for (const failure of ['throw', 'zero']) test(`host handoff writer: ${failure} remains failure and returns its descriptor`, () => {
  const w = world({ OMA_HOST_SESSION_HANDOFF: '3' }, failure);
  assert.throws(() => w.requestHostNewSession()); assert.deepEqual(w.closed, [3]);
});
test('host handoff writer: write and close failures are both retained', () => {
  const cleanup = new Error('close failed'), w = world({ OMA_HOST_SESSION_HANDOFF: '3' }, 'throw', Infinity, cleanup);
  assert.throws(() => w.requestHostNewSession(), error => error instanceof AggregateError &&
    error.errors[0].message === 'write failed' && error.errors[1] === cleanup);
  assert.deepEqual(w.closed, [3]);
});
test('host handoff writer: a failed close cannot report a successful request', () => {
  const cleanup = new Error('close failed'), w = world({ OMA_HOST_SESSION_HANDOFF: '3' }, undefined, Infinity, cleanup);
  assert.throws(() => w.requestHostNewSession(), error => error === cleanup); assert.deepEqual(w.closed, [3]);
});
