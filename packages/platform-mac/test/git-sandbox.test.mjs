/** Pure plans only: these tests never impersonate a Darwin kernel/scope. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMacDeveloperTools} from '@oma/protocol/mac-developer-tools';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {candidateSeatbelt,quarantineSeatbelt} from '@oma/platform-mac/git-sandbox';
import {snapshotIntegrationPolicy} from '@oma/domain/integration-policy';
import {exportRefForRequestKey} from '@oma/domain/derived';
const developer='/Applications/Xcode beta.app/Contents/Developer';
const tools=describeMacDeveloperTools(developer,developer+'/usr/bin/git',developer+'/usr/libexec/git-core');
const host={node:'/opt/pinned-node/bin/node',libdir:'/opt/oma installation',tools};
const root='/private/var/oma/staging/한 글자 "\\line\nstage',project='/private/var/oma/repos/project.git';
const candidate='a'.repeat(40),view={git:tools.git,project,workspace:root+'/workspace'};
const check=snapshotIntegrationPolicy({policyRevision:'test',protectedPaths:[],checks:[{id:'exact',argv:['node','literal "\\$()\narg'],
  env:{HOME:'/human',PATH:'/human/bin',GIT_CONFIG_GLOBAL:'/human/gitconfig',CHECK:'literal'}}]}).checks[0];
test('Mac setup describes the selected exact developer bundle without granting its parent or exec over frameworks',()=>{
  const recipe=candidateSeatbelt(host,view,root+'/tmp',candidate,check),env=recipe.command.env;
  assert.deepEqual(recipe.command.argv.slice(0,2),['--profile-stdin','--keep-fds=6,8,9']);
  assert.deepEqual(recipe.privateInputs,[]);assert.ok(recipe.command.input instanceof Uint8Array);
  assert.deepEqual(JSON.parse(recipe.command.argv.at(-1)),{candidate,argv:check.argv,view});
  assert.equal(env.HOME,root+'/tmp');assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');assert.equal(env.GIT_EXEC_PATH,tools.execPath);
  assert.equal(env.PATH,'/opt/pinned-node/bin:'+developer+'/usr/bin:/usr/bin:/bin');assert.equal(env.CHECK,'literal');
  assert.ok(recipe.profile.includes(`(allow file-read* (subpath ${JSON.stringify(tools.contents)}))`));
  assert.ok(recipe.profile.includes(`(allow file-map-executable (subpath ${JSON.stringify(tools.contents)}))`));
  assert.ok(!recipe.profile.includes(`(allow process-exec* (subpath ${JSON.stringify(tools.contents)}))`));
  for(const path of [view.workspace,root+'/tmp',developer+'/usr/bin',developer+'/Toolchains/XcodeDefault.xctoolchain/usr/bin'])
    assert.ok(recipe.profile.includes(`(allow process-exec* (subpath ${JSON.stringify(path)}))`));
  assert.ok(!recipe.profile.includes(`(allow process-exec* (subpath ${JSON.stringify(project)}))`));
  for(const broad of ['/Applications','/Library','/Users','/private/var/oma'])assert.ok(!recipe.profile.includes(`(subpath ${JSON.stringify(broad)})`));
});
test('Mac quarantine separates readonly accepted input, writable verify repo and canonical promotion',()=>{
  const base={candidate,exportRef:exportRefForRequestKey('mac-plan'),prerequisites:[]};
  for(const phase of ['verify','import']){
    const view={git:tools.git,project,root,bundle:root+'/input.bundle',temporary:root+'/'+phase+'-tmp'};
    const recipe=quarantineSeatbelt(host,{...base,phase},view);
    assert.equal(recipe.command.argv[1],'--keep-fds=7');assert.equal(recipe.command.cwd,view.temporary);
    assert.deepEqual(JSON.parse(recipe.command.argv.at(-1)),{...base,phase,view});
    for(const path of [root,view.bundle])assert.ok(!recipe.profile.includes(`(allow file-write* (subpath ${JSON.stringify(path)}))`));
    assert.equal(recipe.profile.includes(`(allow file-write* (subpath ${JSON.stringify(project)}))`),phase==='import');
    assert.equal(recipe.profile.includes(`(allow file-write* (subpath ${JSON.stringify(root+'/repo')}))`),phase==='verify');
  }
});
test('Mac setup refuses overlapping staging, widened toolchains and loader injection',async()=>{
  for(const temporary of [project,project+'/tmp',view.workspace,view.workspace+'/tmp','/'])
    assert.throws(()=>candidateSeatbelt(host,view,temporary,candidate,check));
  for(const libdir of ['/private/var/oma',project,view.workspace])
    assert.throws(()=>candidateSeatbelt({...host,libdir},view,root+'/tmp',candidate,check),{code:'UNSUPPORTED_PROFILE'});
  const injected=snapshotIntegrationPolicy({policyRevision:'test',protectedPaths:[],checks:[{id:'bad',argv:['node'],env:{DYLD_INSERT_LIBRARIES:'/human/inject'}}]}).checks[0];
  assert.throws(()=>candidateSeatbelt(host,view,root+'/tmp',candidate,injected),{code:'UNSUPPORTED_PROFILE'});
  for(const input of [['/Applications','/usr/bin/git','/usr/libexec/git-core'],[developer,'/usr/bin/git',tools.execPath],
    [developer,tools.git,'/human/helpers'],[developer+'\n',tools.git,tools.execPath]])assert.throws(()=>describeMacDeveloperTools(...input),{code:'UNSUPPORTED_PROFILE'});
  const clt='/Library/Developer/CommandLineTools';assert.equal(describeMacDeveloperTools(clt,clt+'/usr/bin/git',clt+'/usr/libexec/git-core').contents,clt);
  if(process.platform!=='darwin')await assert.rejects(observeMacDeveloperTools('/tmp',async()=>{throw new Error('no fake Darwin command may execute');}),{code:'UNSUPPORTED_PROFILE'});
});
