// DR27/P0-4: real terminal owners with fake streams and manually fired timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Script(code, { filename: file }).runInNewContext({ module, exports: module.exports, Buffer, ...globals,
    require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
  });
  return module.exports;
}
function world() {
  const bounds = load('packages/domain/src/surface-bounds.ts', {});
  const host = new EventEmitter();
  const input = new EventEmitter(), output = new EventEmitter();
  const raw = [], bytes = [], timers = new Set();
  let resumes = 0, pauses = 0;
  Object.assign(input, { isTTY: true, setRawMode(value) { raw.push(value); },
    resume() { resumes++; }, pause() { pauses++; } });
  Object.assign(output, { columns: 80, rows: 24, write(value) { bytes.push(value); return true; } });
  const screen = load('packages/tui/src/screen.ts', { '@oma/domain/surface-bounds': bounds }, { process: host, Buffer });
  const { PanelTerminal } = load('packages/tui/src/panel-terminal.ts', { '@oma/domain/surface-bounds': bounds, './screen.js': screen }, {
    setTimeout(run) { const timer = { run, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
  });
  const panel = new PanelTerminal({ input, output }, () => true);
  return { panel, input, output, raw, bytes, timers, host, screen,
    tick() { for (const timer of [...timers]) { timers.delete(timer); timer.run(); } },
    get resumes() { return resumes; }, get pauses() { return pauses; },
  };
}

test('DR27 terminal: unclaimed startup draws once and final restore returns modes/listeners', t => {
  const w = world(); t.after(() => w.panel.restore());
  let shown = 0, keys = 0, resized = 0;
  w.panel.onKeys(() => { keys++; }); w.panel.onResize(() => { resized++; });
  w.panel.whenUnclaimed(() => { shown++; });
  w.tick(); w.input.emit('data', Buffer.from('x')); w.output.emit('resize');
  assert.equal(shown, 1); assert.equal(keys, 1); assert.equal(resized, 1);
  assert.equal(w.host.listenerCount('exit'), 1);
  w.panel.restore();
  assert.deepEqual(w.raw, [true, false]);
  assert.equal(w.input.listenerCount('data'), 0); assert.equal(w.output.listenerCount('resize'), 0);
  assert.equal(w.host.listenerCount('exit'), 0);
  assert.equal(w.timers.size, 0);
});

test('DR27 terminal: restore before startup cancels fallback instead of reacquiring raw mode', t => {
  const w = world(); t.after(() => w.panel.restore());
  let shown = 0;
  w.panel.whenUnclaimed(() => { shown++; });
  const old = [...w.timers][0];
  w.panel.restore();
  assert.equal(w.timers.size, 0, 'final restore retained its startup timer');
  old.run(); w.tick();
  assert.equal(shown, 0, 'ended host ran its startup fallback');
  assert.deepEqual(w.raw, []); assert.deepEqual(w.bytes, []);
  assert.equal(w.host.listenerCount('exit'), 0);
});

for (const claim of ['handoff', 'reclaim']) test(`DR27 terminal: ${claim} returns the losing startup timer`, t => {
  const w = world(); t.after(() => w.panel.restore());
  let shown = 0; w.panel.whenUnclaimed(() => { shown++; });
  if (claim === 'handoff') w.panel.handoff(() => {}); else w.panel.reclaim();
  assert.equal(w.timers.size, 0, 'claimed terminal retained a fallback timer');
  w.tick(); assert.equal(shown, 0);
});

test('DR27 terminal: rearming replaces its own timer and old callback cannot claim the terminal', t => {
  const w = world(); t.after(() => w.panel.restore());
  const shown = [];
  w.panel.whenUnclaimed(() => { shown.push('old'); });
  const old = [...w.timers][0];
  w.panel.whenUnclaimed(() => { shown.push('new'); });
  assert.equal(w.timers.size, 1);
  old.run(); assert.deepEqual(shown, [], 'old callback acquired successor startup');
  w.tick(); assert.deepEqual(shown, ['new']);
});

test('DR27 terminal: final restore is idempotent after remote ownership', () => {
  const w = world(); w.panel.handoff(() => {});
  w.panel.restore(); const bytes = [...w.bytes], pauses = w.pauses;
  w.panel.restore();
  assert.deepEqual(w.bytes, bytes); assert.equal(w.pauses, pauses); assert.deepEqual(w.raw, [false]);
});

test('DR27 terminal: late UI callbacks after final restore cannot acquire, register or draw', t => {
  const w = world(); t.after(() => w.panel.restore());
  w.panel.restore(); let sent = 0;
  w.panel.whenUnclaimed(() => { sent++; });
  w.panel.handoff(() => { sent++; }); w.panel.open({ columns: 80, rows: 24 });
  w.panel.draw(['late']); w.panel.reclaim(); w.panel.onKeys(() => {}); w.panel.onResize(() => {});
  w.panel.repaint(); w.tick();
  assert.equal(sent, 0); assert.deepEqual(w.raw, []); assert.deepEqual(w.bytes, []);
  assert.equal(w.input.listenerCount('data'), 0); assert.equal(w.output.listenerCount('resize'), 0);
  assert.equal(w.host.listenerCount('exit'), 0); assert.equal(w.timers.size, 0);
});

test('DR27 terminal: local-to-remote-to-local handoff keeps one listener owner', t => {
  const w = world(); t.after(() => w.panel.restore());
  let keys = 0, frames = 0;
  w.panel.onKeys(() => { keys++; }); w.panel.reclaim();
  w.input.emit('data', Buffer.from('a'));
  w.panel.handoff(() => { frames++; });
  assert.equal(w.input.listenerCount('data'), 0); assert.equal(w.host.listenerCount('exit'), 0);
  w.panel.open({ columns: 80, rows: 24 }); w.panel.draw(['remote']); assert.equal(frames, 1);
  w.panel.reclaim(); w.input.emit('data', Buffer.from('b'));
  assert.equal(keys, 2); assert.equal(w.input.listenerCount('data'), 1);
  assert.equal(w.host.listenerCount('exit'), 1);
});

test('DR27 terminal: restored screen cannot acquire late input/resize listeners', () => {
  const w = world(); const screen = w.screen.openTerminal({ input: w.input, output: w.output });
  screen.restore(); screen.onKeys(() => {}); screen.onResize(() => {}); screen.restore();
  assert.equal(w.input.listenerCount('data'), 0); assert.equal(w.output.listenerCount('resize'), 0);
  assert.equal(w.host.listenerCount('exit'), 0);
});

function failOnce(target, method, accepts = () => true) {
  const original = target[method], problem = new Error(`injected ${method} failure`);
  let armed = true;
  target[method] = function (...args) {
    const result = original.apply(this, args);
    if (armed && accepts(...args)) { armed = false; throw problem; }
    return result;
  };
  return problem;
}
function returned(w) {
  assert.equal(w.raw.at(-1), false, 'raw mode was not returned');
  assert.ok(w.pauses > 0, 'input was not paused');
  assert.ok(w.bytes.at(-1)?.endsWith('\x1b[?1049l'), 'alternate screen was not returned');
  assert.equal(w.input.listenerCount('data'), 0);
  assert.equal(w.output.listenerCount('resize'), 0);
  assert.equal(w.host.listenerCount('exit'), 0);
}
for (const [owner, method] of [['input', 'setRawMode'], ['input', 'resume'], ['output', 'write'], ['host', 'once']]) {
  test(`DR27 terminal: failed screen acquisition at ${owner}.${method} returns partial modes`, () => {
    const w = world(), problem = failOnce(w[owner], method);
    assert.throws(() => w.screen.openTerminal({ input: w.input, output: w.output }), error => error === problem);
    returned(w);
    const next = w.screen.openTerminal({ input: w.input, output: w.output });
    assert.equal(w.host.listenerCount('exit'), 1); next.restore(); returned(w);
  });
}
for (const owner of ['input', 'output']) {
  test(`DR27 terminal: failed panel ${owner} wiring returns the acquired screen before retry`, () => {
    const w = world(); w.panel.onKeys(() => {}); w.panel.onResize(() => {});
    const problem = failOnce(w[owner], 'on');
    assert.throws(() => w.panel.reclaim(), error => error === problem);
    returned(w);
    w.panel.reclaim();
    assert.equal(w.input.listenerCount('data'), 1); assert.equal(w.output.listenerCount('resize'), 1);
    assert.equal(w.host.listenerCount('exit'), 1); w.panel.restore(); returned(w);
  });
}
for (const [owner, method] of [['host', 'off'], ['input', 'off'], ['output', 'off'], ['input', 'setRawMode'], ['input', 'pause']]) {
  test(`DR27 terminal: failed ${owner}.${method} cleanup cannot strand the remaining resources`, () => {
    const w = world(); w.panel.onKeys(() => {}); w.panel.onResize(() => {}); w.panel.reclaim();
    const problem = failOnce(w[owner], method);
    assert.throws(() => w.panel.restore(), error => error === problem || error.errors?.includes(problem));
    returned(w);
    const count = w.bytes.length; w.panel.restore(); assert.equal(w.bytes.length, count);
  });
}
test('DR27 terminal: failed screen setup retains its primary error and attempts all cleanup', () => {
  const w = world(); const primary = failOnce(w.output, 'write'), cleanup = failOnce(w.input, 'pause');
  assert.throws(() => w.screen.openTerminal({ input: w.input, output: w.output }),
    error => error.errors?.[0] === primary && (error.errors?.[1] === cleanup || error.errors?.[1]?.errors?.includes(cleanup)));
  returned(w);
});
test('DR27 terminal: remote pause failure still restores terminal modes once', () => {
  const w = world(); w.panel.handoff(() => {}); const problem = failOnce(w.input, 'pause');
  assert.throws(() => w.panel.restore(), error => error === problem || error.errors?.includes(problem));
  returned(w);
  const count = w.bytes.length; w.panel.restore(); assert.equal(w.bytes.length, count);
});
