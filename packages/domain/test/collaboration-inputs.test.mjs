import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationArguments, collaborationInputProblem, collaborationMutationMethod, collaborationMutationMethods } from '../dist/collaboration-inputs.js';
import { mailAttachmentRootId, attachmentPublicationId, createRootId, createSourcePublicationId } from '../dist/derived.js';
import { parseOperationId } from '../dist/identifiers.js';

const rows = [
  ['oma_send', { to: ['bob'], content: { kind: 'text', value: '' }, subject: '' }, 'mail.send'],
  ['oma_spawn', { name: 'bob', from: 'HEAD', brief: { kind: 'file', value: 'brief.md' } }, 'agent.create'],
  ['oma_merge', { reason: 'change', tier: 'LOW' }, 'attest.record'],
  ['oma_challenge', { merge: 'exact-merge', reason: 'fix', tier: 'HIGH' }, 'attest.record'],
  ['oma_review', { target: '/oma/reviews/target.json', decision: 'withdraw', reason: 'No longer approving this exact target' }, 'attest.record'],
  ['oma_wait', {}, null],
  ['oma_follow', { topic: 'runtime', enabled: false }, 'route.unfollow'],
  ['oma_goal', { content: { kind: 'text', value: '# GOAL' }, expectedRevision: null }, 'context.publish'],
  ['oma_society', { action: 'close' }, 'society.set'],
];
for (const [tool, input, method] of rows) {
  test(`001. Closed collaboration input: ${tool} preserves presence and rejects extra fields/coercions`, () => {
    const original = JSON.stringify(input);
    assert.equal(collaborationInputProblem(tool, input), null);
    assert.notEqual(collaborationInputProblem(tool, { ...input, requestKey: 'model-key' }), null);
    assert.notEqual(collaborationInputProblem(tool, null), null);
    assert.equal(JSON.stringify(input), original);
    if (method === null) assert.throws(() => collaborationMutationMethod(tool, input));
    else assert.equal(collaborationMutationMethod(tool, input), method);
  });
}
test("002. Collaboration input defaults preserve required GOAL null and false while normalizing known optional null", () => {
  assert.notEqual(collaborationInputProblem('oma_goal', { content: { kind: 'text', value: '' } }), null);
  assert.notEqual(collaborationInputProblem('oma_follow', { topic: 'x', enabled: 'false' }), null);
  assert.notEqual(collaborationInputProblem('oma_send', { to: 'bob', content: { kind: 'text', value: '' } }), null);
  assert.notEqual(collaborationInputProblem('oma_send', { to: ['bob'], content: { kind: 'text', value: '', actor: 'principal' } }), null);
  assert.deepEqual(collaborationArguments('oma_send', { to: ['bob'], content: { kind: 'text', value: '' }, urgent: null }),
    { to: ['bob'], content: { kind: 'text', value: '' } });
  assert.notEqual(collaborationInputProblem('oma_wait', { release: false }), null);
  assert.notEqual(collaborationInputProblem('constructor', {}), null);
  assert.deepEqual(collaborationMutationMethods('constructor'), []);
  const names = collaborationMutationMethods('oma_send'); names.push('agent.stop');
  assert.deepEqual(collaborationMutationMethods('oma_send'), ['mail.send', 'agent.continue']);
});

test("003. Frozen Mail/create root and publication IDs retain the existing operation grammar and separate original identities", () => {
  const key = `inv1-${'a'.repeat(64)}`, mail = mailAttachmentRootId('alice', key), create = createRootId('alice', key);
  const attachment = attachmentPublicationId(mail, 0), source = createSourcePublicationId(create);
  const ids = [mail, create, attachment, source, attachmentPublicationId(mail, 1),
    mailAttachmentRootId('bob', key), mailAttachmentRootId('alice', `inv1-${'b'.repeat(64)}`),
    createRootId('bob', key), createRootId('alice', `inv1-${'b'.repeat(64)}`)];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^op-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(parseOperationId(id), id);
  }
  assert.equal(mailAttachmentRootId('alice', key), mail);
  assert.equal(createRootId('alice', key), create);
  assert.equal(attachmentPublicationId(mail, 0), attachment);
  assert.equal(createSourcePublicationId(create), source);
  assert.equal(parseOperationId('op-00000000-0000-5000-8000-000000000001'), null, 'the historical decoder is not widened');
  for (const ordinal of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => attachmentPublicationId(mail, ordinal), /ordinal/);
});
