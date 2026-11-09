import test from 'node:test';
import assert from 'node:assert/strict';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { CONVERSATION_BOUNDS, TERMINAL_BOUNDS } from '@oma/domain/surface-bounds';
import { UNSEEN, UNSEEN_EXCEPT_LAYOUT } from '@oma/domain/unseen-text';
import { sourceWorld } from './source-world.mjs';
import { stripVTControlCharacters } from 'node:util';

const dependencies = {
  '@earendil-works/pi-tui': { truncateToWidth },
  'node:util': { stripVTControlCharacters },
  '@oma/domain/surface-bounds': { CONVERSATION_BOUNDS, TERMINAL_BOUNDS },
  '@oma/domain/unseen-text': { UNSEEN, UNSEEN_EXCEPT_LAYOUT },
  './pi-rpc.js': { SKIPPED_EVENT: 'oma_event_skipped' },
};

test('001. Queue previews bound Korean and emoji by terminal cells without splitting text', () => {
  const { queuePreviewLine } = sourceWorld('principal-events.ts', dependencies);
  for (const text of ['한글'.repeat(100), 'a'.repeat(158) + '😀😀', '👨‍👩‍👧‍👦'.repeat(90)]) {
    const preview = queuePreviewLine(text);
    assert.ok(visibleWidth(preview) <= CONVERSATION_BOUNDS.queuePreviewCells.value);
    assert.ok(preview.isWellFormed());
    assert.ok(preview.endsWith('…'));
  }
});

test('002. Queue widget respects narrow terminal columns with Korean and emoji', () => {
  const { createInteractiveView } = sourceWorld('interactive-view.ts', {
    ...dependencies, '@earendil-works/pi-coding-agent': { DynamicBorder: class {} },
  });
  const view = createInteractiveView({ presentation: {} }, { send() {} });
  let factory;
  view.context = { ui: { setWidget(_name, value) { factory = value; } } };
  view.receive({ type: 'queued_prompts', total: 1, prompts: ['한글😀한글😀한글'] }, {});
  const widget = factory({}, { fg: (_color, text) => text });
  for (const width of [0, 1, 6, 12]) for (const line of widget.render(width)) {
    assert.ok(visibleWidth(line) <= width, `line exceeds ${width} terminal cells: ${line}`);
    assert.ok(line.isWellFormed());
  }
});
