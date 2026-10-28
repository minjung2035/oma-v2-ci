/** Real Darwin setup integration. All commands/files belong to this fixture;
 * direct-child closure is not an arbitrary-descendant or actor-auth proof.
 * An unavailable shared file primitive remains an explicit failed attempt. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,openSync,closeSync,readSync,createReadStream,writeSync,fstatSync,constants} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {candidateSeatbelt,quarantineSeatbelt} from '@oma/platform-mac/git-sandbox';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {runProcessSync,decodeProcessText} from '@oma/process/run';
import {startProcess} from '@oma/process/async';
import {GIT_ENV} from '@oma/process/policies';
import {snapshotIntegrationPolicy} from '@oma/domain/integration-policy';
import {exportRefForRequestKey} from '@oma/domain/derived';
import {CandidateSetupStatus} from '@oma/git/candidate-check';
import {controlPipe} from '@oma/native/control-socket';
import {openDirectory} from '@oma/native/files';
import {TreeLease} from '@oma/storage/tree-lease';
import {copyDescriptorToEntry} from '@oma/storage/file-digest';
import {cleanupAll,withAsyncCleanup} from '@oma/native/cleanup';

assert.equal(process.platform,'darwin','Git setup observations require an actual Darwin kernel');
const mode=process.argv[2];assert.ok(['git-setup-candidate','git-setup-quarantine'].includes(mode));
let observation;
const root=realpathSync(process.cwd()),temporary=join(root,'owner-tmp');mkdirSync(temporary);
// This fixture observes real tools/direct children, without asserting a
// production Mac scope proof. Product callers require their execution owner.
const tools=await observeMacDeveloperTools(temporary,async command=>runProcessSync(command));
const host={node:realpathSync(process.execPath),libdir:realpathSync(fileURLToPath(new URL('../../',import.meta.url))),tools};
const ownerEnv={...GIT_ENV,HOME:temporary,TMPDIR:temporary,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
  GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
function git(cwd,args,success=true){
  const result=runProcessSync({executable:tools.git,argv:args,cwd,env:ownerEnv,timeoutMs:20000,stdoutBytes:65536,stderrBytes:65536});
  assert.equal(result.kind,'exited',JSON.stringify(result));assert.equal(result.signal,null);assert.equal(result.stdoutTruncated,false);
  if(success)assert.equal(result.exitCode,0,result.stderr.toString());
  return success?decodeProcessText(result.stdout).trim():result.exitCode;
}
async function execute(command,inheritedFds){
  const task=startProcess({...command,timeoutMs:30000},{inheritedFds});
  return withAsyncCleanup(async()=>{const result=await task.result;await task.closed;
    assert.equal(result.kind,'exited',JSON.stringify(result));assert.equal(result.signal,null);assert.equal(result.exitCode,0,result.stderr.toString());
    return result;
  },async()=>{task.cancel();await task.closed;});
}
const source=join(root,'source'),project=join(root,'canonical.git');mkdirSync(source);
git(source,['init','-q']);writeFileSync(join(source,'exact.txt'),'committed\r\n$literal\n');
writeFileSync(join(source,'executable-check.sh'),'#!/bin/sh\nprintf "script-check\\n"\n',{mode:0o755});
git(source,['add','.']);git(source,['commit','-qm','base']);
const base=git(source,['rev-parse','HEAD']);git(root,['clone','-q','--bare',source,project]);
if(mode==='git-setup-candidate'){
const stage=join(root,'한 글자 "\\line\ncheck'),checkLease=TreeLease.take(stage,true);mkdirSync(stage);
const workspace=join(stage,'workspace'),checkTmp=join(stage,'tmp');mkdirSync(workspace);mkdirSync(checkTmp);
const status=controlPipe(),release=controlPipe(),spare=openSync('/dev/null',constants.O_RDONLY);
const identity=fd=>{const stat=fstatSync(fd,{bigint:true});return [String(stat.dev),String(stat.ino)];};
const channels=[identity(status.write),identity(release.read),identity(checkLease.descriptor)];
let statusWrite=status.write,releaseWrite=release.write,releaseRead=release.read,task,reader;
let gateReleases=0;
await withAsyncCleanup(async()=>{
  const check=snapshotIntegrationPolicy({policyRevision:'fixture',protectedPaths:[],checks:[{id:'exact',argv:[host.node,'--input-type=module','-e',
    `import assert from 'node:assert/strict';import {readFileSync,writeFileSync,fstatSync} from 'node:fs';import {spawnSync} from 'node:child_process';
     assert.equal(readFileSync('exact.txt','utf8'),'committed\\r\\n$literal\\n');assert.equal(readFileSync(0,'utf8'),'');
     const expected=${JSON.stringify(channels)};
     const same=(fd,id)=>{try{const s=fstatSync(fd,{bigint:true});return String(s.dev)===id[0]&&String(s.ino)===id[1];}
       catch(e){assert.equal(e.code,'EBADF');return false;}};
     // Node may reuse a returned integer for an unrelated internal FD. Check
     // the actual private channel identities instead of assuming EBADF.
     assert.equal(same(6,expected[0]),false);assert.equal(same(8,expected[1]),false);assert.equal(same(9,expected[2]),true);
     assert.throws(()=>writeFileSync(process.argv[1]+'/forbidden','no'),e=>['EPERM','EACCES'].includes(e.code));
     const run=(file,args)=>{const r=spawnSync(file,args,{env:process.env,encoding:'utf8',timeout:20000,maxBuffer:65536,killSignal:'SIGKILL'});
       assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r.stdout;};
     assert.equal(run('./executable-check.sh',[]),'script-check\\n');writeFileSync('native-check.c','int main(void){return 0;}');
     run('/usr/bin/cc',['native-check.c','-o','native-check']);run('./native-check',[]);console.log('exact-check');`,project],env:{}}]}).checks[0];
  const recipe=candidateSeatbelt(host,{git:tools.git,project,workspace},checkTmp,base,check);
  const sequence=new CandidateSetupStatus(()=>{gateReleases++;assert.equal(writeSync(releaseWrite,Buffer.from([1])),1);closeSync(releaseWrite);releaseWrite=undefined;});
  reader=createReadStream('',{fd:status.read,autoClose:true});
  const evidence=(async()=>{for await(const bytes of reader)sequence.write(bytes);return sequence.finish();})();
  task=startProcess({...recipe.command,timeoutMs:30000},{inheritedFds:[spare,spare,spare,statusWrite,spare,releaseRead,checkLease.descriptor]});
  // Hold a parent reference to each observed channel through target close.
  // XNU pipe_stat hashes the pipe address: after its final close the inode
  // number can be recycled quickly. A naked saved dev/inode is insufficient.
  // Refusal in trusted setup also releases the fixture's bounded direct child.
  void evidence.catch(()=>task.cancel());
  const result=await task.result;await task.closed;
  const writer=statusWrite;statusWrite=undefined;closeSync(writer);const released=releaseRead;releaseRead=undefined;closeSync(released);
  const setup=await evidence;
  assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,JSON.stringify({setup,gateReleases,stderr:result.stderr.toString()}));assert.deepEqual(setup,{kind:'ready'});
  assert.equal(gateReleases,1);assert.equal(result.stdout.toString(),'exact-check\n');
},async()=>{
  task?.cancel();await task?.closed;
  reader?.destroy();if(reader&&!reader.closed)await new Promise(resolve=>reader.once('close',resolve));
  cleanupAll([()=>{if(statusWrite!==undefined)closeSync(statusWrite);},()=>{if(!reader)closeSync(status.read);},
    ()=>{if(releaseWrite!==undefined)closeSync(releaseWrite);},()=>{if(releaseRead!==undefined)closeSync(releaseRead);},()=>checkLease.release(),()=>closeSync(spare)]);
});
observation={exactCheckout:true,privateExecGate:true,canonicalWriteDenied:true,statusClosedOnExec:true,
  ownScriptExecuted:true,nativeBuildOutputExecuted:true,directChildrenClosed:true};
}
if(mode==='git-setup-quarantine'){
// Thin bundle: the canonical prerequisite remains read-only while verification
// writes only its own repo/tmp. Import runs as a separate direct invocation.
writeFileSync(join(source,'new.txt'),'accepted candidate');git(source,['add','.']);git(source,['commit','-qm','candidate']);
const candidate=git(source,['rev-parse','HEAD']),exportRef=exportRefForRequestKey('darwin-git-setup'),bundle=join(root,'accepted.bundle');
git(source,['update-ref',exportRef,candidate]);git(source,['bundle','create',bundle,exportRef,'^'+base]);
const quarantine=join(root,'quarantine'),lease=TreeLease.take(quarantine,true);mkdirSync(quarantine);mkdirSync(join(quarantine,'repo'));
const input=openSync(bundle,constants.O_RDONLY),rootFd=openDirectory(quarantine),projectFd=openDirectory(project),empty=openSync('/dev/null',constants.O_RDONLY);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),accepted=digest(readFileSync(bundle));
await withAsyncCleanup(async()=>{
  const advanced=Buffer.alloc(5);assert.equal(readSync(input,advanced),5);
  const copied=copyDescriptorToEntry(input,rootFd,'input.bundle');assert.equal(copied.sha256,accepted);
  const next=Buffer.alloc(1);assert.equal(readSync(input,next),1);assert.equal(next[0],readFileSync(bundle)[5]);
  const refs=git(root,['--git-dir',project,'show-ref']);
  for(const phase of ['verify','import']){
    const temporary=join(quarantine,phase+'-tmp');mkdirSync(temporary);
    const recipe=quarantineSeatbelt(host,{phase,candidate,exportRef,prerequisites:[base]},
      {git:tools.git,project,root:quarantine,bundle:join(quarantine,'input.bundle'),temporary});
    assert.deepEqual(recipe.privateInputs,[]);const result=await execute(recipe.command,[empty,empty,empty,input,lease.descriptor,rootFd,projectFd]);
    assert.equal(result.stdout.toString(),candidate+'\n');
    assert.equal(git(root,['--git-dir',project,'show-ref']),refs);
    assert.equal(git(root,['--git-dir',project,'cat-file','-e',candidate+'^{commit}'],false),phase==='verify'?128:0);
  }
  assert.equal(digest(readFileSync(bundle)),accepted);assert.equal(digest(readFileSync(join(quarantine,'input.bundle'))),accepted);
},()=>cleanupAll([()=>closeSync(input),()=>closeSync(rootFd),()=>closeSync(projectFd),()=>closeSync(empty),()=>lease.release()]));
observation={thinBundle:true,verificationBeforeImport:true,canonicalRefsPreserved:true,acceptedBytesPreserved:true,acceptedCursorPreserved:true,directChildrenClosed:true};
}
console.log(JSON.stringify({case:mode,gitSetup:{selectedDeveloperTools:tools,...observation}}));
