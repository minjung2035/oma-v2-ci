import test from 'node:test';
import assert from 'node:assert/strict';
import { registerPromptBoundary } from '@oma/extension/prompt-boundary';

test("001. Request-local oma_tools guidance follows activation and removal without another run start", () => {
  const handlers = new Map(); let active = ['core'];
  registerPromptBoundary({ on: (name, handler) => handlers.set(name, handler), getActiveTools: () => active }, process.cwd(), false);
  const options = { sections: {}, contextFiles: [], appendSystemPrompt: '', selectedTools: active,
    toolSnippets: { core: 'core guidance', optional: 'optional guidance' }, toolGuidelines: { optional: ['optional rule'] } };
  handlers.get('before_agent_start')({ systemPromptOptions: options });
  const initial = [{ role: 'system', content: 'ROLE IDENTITY', sections: { oma_tools: `<oma_tools>\n${options.sections.oma_tools}\n</oma_tools>`, other: 'preserve me' }, timestamp: 1 }];
  const frozen = structuredClone(initial);
  assert.equal(handlers.get('context_with_system')({ messages: initial }), undefined);
  active = ['core', 'optional'];
  const expanded = handlers.get('context_with_system')({ messages: initial }).messages;
  assert.match(expanded.at(-1).sections.oma_tools, /optional guidance/);
  assert.match(expanded.at(-1).sections.oma_tools, /optional rule/);
  assert.deepEqual(initial, frozen, 'projection never rewrites persisted history or another section');
  active = ['core'];
  const reset = handlers.get('context_with_system')({ messages: expanded }).messages;
  assert.doesNotMatch(reset.at(-1).sections.oma_tools, /optional/);
  active = [];
  assert.equal(handlers.get('context_with_system')({ messages: reset }).messages.at(-1).sections.oma_tools, null);
});
