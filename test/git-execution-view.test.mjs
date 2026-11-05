/** Closed description policy; actual kernel execution is tested separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCandidateExecutionView, decodePipelineExecutionView, decodeQuarantineExecutionView } from '@oma/protocol/git-execution-view';
import { decodeCandidateInvocation } from '@oma/git/candidate-check';
import { decodeQuarantineInput } from '@oma/git/quarantine-worker';

const candidateView = () => ({ git: '/usr/bin/git', project: '/private/var/한 글자 "project.git', workspace: '/private/var/check work' });
const quarantineView = () => ({ git: '/usr/bin/git', project: '/private/var/한 글자 "project.git', root: '/private/var/quarantine work',
  bundle: '/private/var/quarantine work/input.bundle', temporary: '/private/var/quarantine work/tmp' });
test("001. Git execution views preserve literal physical paths and snapshot all fields", () => {
  for (const [decode, make] of [[decodeCandidateExecutionView,candidateView], [decodeQuarantineExecutionView,quarantineView]]) {
    const source = make(), expected = { ...source }, decoded = decode(source);
    assert.deepEqual(decoded, expected); assert.ok(Object.isFrozen(decoded)); source.project = '/other';
    assert.deepEqual(decoded, expected);
    for (const key of Object.keys(expected)) for (const path of ['/', 'relative', '/a/../b', '/a//b', '/a/./b', '/bad\0name', '/bad\ud800'])
      assert.throws(() => decode({ ...expected, [key]: path }), { code:'INVALID_REQUEST' }, `${key}:${path}`);
    for (const bad of [null, [], { ...expected, authority: true }, Object.fromEntries(Object.entries(expected).slice(1))])
      assert.throws(() => decode(bad), { code:'INVALID_REQUEST' });
  }
});
test("004. Pipeline physical views keep mutable cache apart from verified downloads and reject an open payload",()=>{
  const pipeline={version:2,setupSteps:[],checkSteps:[{id:'check',argv:['node','-e','0'],cwd:'.',env:{}}],env:{},toolchainDigest:'b'.repeat(64),cachePolicy:{kind:'off'}};
  const input={candidate:'a'.repeat(40),argv:['oma-pipeline-v2'],view:candidateView(),pipeline,
    pipelineView:{temporary:'/tmp',npm:'/opt/oma-node/lib/node_modules/npm/package.json'}};
  assert.deepEqual(decodeCandidateInvocation(input),input);
  const mounted={...input.pipelineView,downloads:'/tmp/oma-downloads'};
  assert.deepEqual(decodePipelineExecutionView(mounted),mounted);
  const cached={...input,pipelineView:mounted,downloadCache:{key:'c'.repeat(64),files:[]}};
  assert.deepEqual(decodeCandidateInvocation(cached),cached);
  const {pipelineView,...missing}=input;
  for(const bad of [missing,{...input,downloadCache:cached.downloadCache},{...input,pipelineView:mounted},
    {...input,pipelineView:{...pipelineView,authority:true}},{...input,pipelineView:{...pipelineView,npm:'/human/npm'}},
    {...cached,pipelineView:{...mounted,downloads:'/tmp/oma-npm-cache/content'}},
    {...cached,pipelineView:{...mounted,temporary:'/opt/oma-node'}}])
    assert.throws(()=>decodeCandidateInvocation(bad),{code:'INVALID_REQUEST'});
});
test("002. Git execution views refuse repository/workspace overlap and writable bundle aliases", () => {
  for (const workspace of ['/private/var', candidateView().project, candidateView().project+'/inside'])
    assert.throws(() => decodeCandidateExecutionView({ ...candidateView(), workspace }), { code:'INVALID_REQUEST' });
  assert.throws(() => decodeCandidateExecutionView({ ...candidateView(),project:'/same/',workspace:'/same' }), { code:'INVALID_REQUEST' });
  const q = quarantineView();
  for (const patch of [{ root:q.project }, { root:'/private' }, { temporary:q.project },
    { bundle:q.project+'/input.bundle' }, { bundle:q.temporary+'/input.bundle' }])
    assert.throws(() => decodeQuarantineExecutionView({ ...q,...patch }), { code:'INVALID_REQUEST' });
});
test("003. Private Git setup invocations require explicit views and reject legacy or open payloads", () => {
  const candidate = 'a'.repeat(40), c = { candidate, argv:['/bin/echo','literal $x'], view:candidateView() },
    q = { phase:'verify',candidate,exportRef:'refs/oma/export/view-test',prerequisites:[],view:quarantineView() };
  assert.deepEqual(decodeCandidateInvocation(c), c); assert.deepEqual(decodeQuarantineInput(q), q);
  for (const [decode, input] of [[decodeCandidateInvocation,c],[decodeQuarantineInput,q]]) {
    const {view,...legacy}=input; assert.throws(() => decode(legacy), { code:'INVALID_REQUEST' });
    assert.throws(() => decode({ ...input, ignored:true }), { code:'INVALID_REQUEST' });
    assert.throws(() => decode({ ...input, view:{...view, hidden:true} }), { code:'INVALID_REQUEST' });
  }
});
