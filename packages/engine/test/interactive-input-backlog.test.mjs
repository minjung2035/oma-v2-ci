import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractiveInput, requestSessionSwitch } from '../dist/interactive-input.js';
function uiHarness() {
  let epoch = 1, editor = '';
  const sent = [], notices = [], hooks = [];
  const view = { get epoch() { return epoch; }, current: value => value === epoch,
    context: { ui: { getEditorText: () => editor, setEditorText: value => { editor = value; } } },
    notify: (...args) => notices.push(args) };
  const state = { runtime: { session: { extensionRunner: { emit: async event => { hooks.push(event); return undefined; } } } } };
  const ui = { send: event => sent.push(event) };
  const human = createInteractiveInput(view, state, ui, { frameBytes: 65536 }, { showResume() {} });
  return { view, state, ui, human, sent, notices, hooks, leave() { epoch++; }, get editor() { return editor; } };
}

for (const accepted of [true, false]) test(`001. A late ${accepted ? 'acceptance' : 'refusal'} cannot affect the replacement UI`, () => {
  const h = uiHarness();
  h.human.submit('old draft'); const old = h.human.pendingInput.id;
  h.leave(); assert.equal(h.human.pendingInput, undefined);
  assert.equal(h.human.receive({ type: 'input_result', id: old, accepted, queued: true }), true);
  assert.equal(h.editor, ''); assert.deepEqual(h.notices, []);
  h.human.submit('new draft');
  assert.deepEqual(h.sent.map(event => event.text), ['old draft', 'new draft']);
  assert.notEqual(h.human.pendingInput.id, old);
});

test("002. A new input releases stale ownership before its old answer arrives", () => {
  const h = uiHarness(); h.human.submit('old'); const old = h.human.pendingInput.id;
  h.leave(); h.human.submit('new');
  assert.equal(h.human.receive({ type: 'input_result', id: old, accepted: false }), false);
  assert.equal(h.human.pendingInput.text, 'new'); assert.equal(h.editor, '');
});

for (const target of [{}, { session: '/history/saved.jsonl' }])
  for (const outcome of ['accept', 'cancel', 'stale', 'replaced', 'failure'])
    test(`003. Interactive input backlog: ${target.session ? 'resume' : 'new'} switch honors ${outcome} hook outcome`, async () => {
      const h = uiHarness(); let event;
      h.state.runtime.session.extensionRunner.emit = async value => {
        event = value;
        if (outcome === 'stale') h.leave();
        if (outcome === 'replaced') h.state.runtime = { session: {} };
        if (outcome === 'failure') throw new Error('hook unavailable');
        return outcome === 'cancel' ? { cancel: true } : undefined;
      };
      const attempt = requestSessionSwitch(h.view, h.state, h.ui, target);
      if (outcome === 'failure') await assert.rejects(attempt, /hook unavailable/); else await attempt;
      assert.deepEqual(event, { type: 'session_before_switch', reason: target.session ? 'resume' : 'new',
        ...(target.session ? { targetSessionFile: target.session } : {}) });
      assert.deepEqual(h.sent, outcome === 'accept' ? [{ type: 'switch', ...target }] : []);
    });

test("004. New uses the cancellation hook instead of sending a host switch directly", async () => {
  const h = uiHarness();
  h.state.runtime.session.extensionRunner.emit = async event => { h.hooks.push(event); return { cancel: true }; };
  assert.equal(h.human.extensionCommand('/new'), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.hooks.length, 1); assert.deepEqual(h.sent, []);
});
