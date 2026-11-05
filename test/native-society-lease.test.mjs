/** Product lease owner, real creator and inherited last-close fence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,existsSync,fstatSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync,fork} from 'node:child_process';
import {Socket} from 'node:net';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
import {tryHoldSociety,societyLeaseName,inheritedFence} from '#oma-test/app/runtime/society-lease';
import {holdDarwinSocietyFence,darwinSocietyFencePort,identifyDarwinSocietyFence} from '@oma/native/darwin-society-fence';
import {controlSocketPair} from '@oma/native/control-socket';
import {watchDarwinProcess} from '@oma/native/process-event';
import {load} from 'koffi';
import {machoImageCdHashes} from '@oma/native/darwin-macho-image';
import {SOCIETY_FENCE_ENV} from '@oma/process/async';
import {runProcessSync} from '@oma/process/run';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {ExecutionRuntime,recoverExecutionState} from '#oma-test/app/runtime/execution-runtime';
import {HostTenure} from '#oma-test/app/runtime/host-tenure';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {observeDarwinCoalitionPopulation,pinDarwinProcess} from '@oma/native/audit-session';
import {inspect} from 'node:util';
import {pinDarwinPrivateParent} from '@oma/native/private-parent';
const runFence=(executable,argv,fd)=>runProcessSync({executable,argv,env:{PATH:'/usr/bin:/bin'},timeoutMs:15000,stdoutBytes:16384,stderrBytes:16384},undefined,fd===undefined?[]:[fd],{killSignal:'SIGTERM'});

const leaseModule=fileURLToPath(new URL(import.meta.resolve('#oma-test/app/runtime/society-lease')));
function fixture(t){const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-product-lease-')));t.after(()=>rmSync(base,{recursive:true}));return{base,state:join(base,'state')};}
function darwin(t){if(process.platform==='darwin')return true;t.diagnostic('NOT_RUN: actual Darwin Society lease');return false;}
function closedEnv(){const env={...process.env};for(const key of [SOCIETY_FENCE_ENV,'NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE'])delete env[key];return env;}
function refused(state){let lease;try{lease=tryHoldSociety(state);}catch(error){assert.equal(error.code,'BROKER_UNAVAILABLE');return;}if(lease!==null){lease.release();assert.fail('another Host acquired a live inherited fence');}}
async function exited(pin){const deadline=performance.now()+3000;while(pin.state()!=='exited'&&performance.now()<deadline)await delay(5);assert.equal(pin.state(),'exited','original pinned process must positively exit');}

test('001. Product Darwin lease rejects a second fresh Host before state effects and reacquires after release',{timeout:45000},t=>{
 if(!darwin(t))return;const f=fixture(t);let held=tryHoldSociety(f.state);assert.notEqual(held,null);t.after(()=>{try{held?.release();}catch{}});
 assert.equal(existsSync(f.state),false);assert.equal(inheritedFence(held.fence,f.state).kind,'society');
 const script=`import {tryHoldSociety} from ${JSON.stringify(leaseModule)};const held=tryHoldSociety(${JSON.stringify(f.state)});if(held){held.release();throw Error('second Host acquired');}console.log('refused');`;
 const second=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:20000,env:closedEnv()});
 assert.equal(second.error,undefined);assert.equal(second.signal,null,second.stderr);assert.equal(second.status,0,second.stderr);assert.equal(second.stdout.trim(),'refused');
 assert.equal(existsSync(f.state),false);held.release();held=tryHoldSociety(f.state);assert.notEqual(held,null);assert.equal(existsSync(f.state),false);
 const fake=controlSocketPair();try{assert.equal(inheritedFence(fake.parent,f.state).kind,'not-a-lease');}finally{closeSync(fake.parent);closeSync(fake.child);}
});

test('002. Product fence survives Host SIGKILL and rejects takeover until the inherited child exits',{timeout:45000},async t=>{
 if(!darwin(t))return;const f=fixture(t),pair=controlSocketPair();const wire=new Socket({fd:pair.parent,readable:true,writable:true}),lines=createInterface({input:wire});
 let host,pin,hostClosed,nextLease;
 t.after(async()=>{try{if(host?.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');wire.end('finish\n');await hostClosed;}finally{pin?.close();lines.close();wire.destroy();try{nextLease?.release();}catch{}}});
 const childScript=`import {Socket} from 'node:net';import {inheritedFence} from ${JSON.stringify(leaseModule)};const wire=new Socket({fd:3,readable:true,writable:true});wire.on('end',()=>process.exit(0));wire.on('error',()=>process.exit(0));wire.on('data',()=>process.exit(0));wire.write(JSON.stringify({pid:process.pid,kind:inheritedFence(4,${JSON.stringify(f.state)}).kind})+'\\n');`;
 const hostScript=`import {spawn} from 'node:child_process';import {closeSync} from 'node:fs';import {tryHoldSociety} from ${JSON.stringify(leaseModule)};
 const held=tryHoldSociety(${JSON.stringify(f.state)});if(!held)throw Error('initial Host did not acquire');
 const env={...process.env,${JSON.stringify(SOCIETY_FENCE_ENV)}:'4'};delete env.NODE_CHANNEL_FD;delete env.NODE_CHANNEL_SERIALIZATION_MODE;
 spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(childScript)}],{stdio:['ignore','ignore','ignore',3,held.fence],env});closeSync(3);setInterval(()=>{},1000);`;
 const ready=once(lines,'line');host=spawn(process.execPath,['--input-type=module','-e',hostScript],{stdio:['ignore','ignore','pipe',pair.child],env:closedEnv()});closeSync(pair.child);
 let stderr='';host.stderr.on('data',bytes=>{stderr+=bytes;});hostClosed=new Promise((yes,no)=>{host.once('error',no);host.once('close',(code,signal)=>yes({code,signal}));});void hostClosed.catch(()=>{});
 const child=JSON.parse((await Promise.race([ready,hostClosed.then(value=>{throw new Error('Host closed before child readiness: '+JSON.stringify(value)+' '+stderr);})]))[0]);assert.equal(child.kind,'society',stderr);pin=watchDarwinProcess(child.pid);assert.equal(pin.state(),'live');
 host.kill('SIGKILL');assert.deepEqual(await hostClosed,{code:null,signal:'SIGKILL'},stderr);assert.equal(pin.state(),'live');refused(f.state);assert.equal(existsSync(f.state),false);
 wire.end('finish\n');await exited(pin);nextLease=tryHoldSociety(f.state);assert.notEqual(nextLease,null,'last inherited reference returned');assert.equal(existsSync(f.state),false);
});

test('003. Creator death withdraws discovery without releasing a still-held product fence',{timeout:45000},async t=>{
 if(!darwin(t))return;const f=fixture(t);let held=tryHoldSociety(f.state),next,pin;assert.notEqual(held,null);
 t.after(()=>{pin?.close();try{held?.release();}catch{}try{next?.release();}catch{}});
 const nativeRoot=new URL('../packages/native/dist/society-fence/',import.meta.url),producer=fileURLToPath(new URL('oma-society-fence-producer',nativeRoot)),control=fileURLToPath(new URL('oma-society-fence-control',nativeRoot));
 const hashes=machoImageCdHashes(readFileSync(producer),process.arch==='arm64'?'arm64':'x64');assert.equal(hashes.length,1);
 const name=societyLeaseName(f.state),result=spawnSync(control,['holder',name.slice('\0oma.society.'.length),hashes[0],String(darwinSocietyFencePort(name))],{encoding:'utf8',timeout:15000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);const creator=JSON.parse(result.stdout);assert.equal(creator.kind,'matched');
 pin=watchDarwinProcess(creator.creatorPid);assert.equal(pin.state(),'live');
 const fresh=spawnSync(control,['holder',name.slice('\0oma.society.'.length),hashes[0],String(darwinSocietyFencePort(name))],{encoding:'utf8',timeout:15000});
 assert.equal(fresh.status,0,fresh.stderr);assert.deepEqual(JSON.parse(fresh.stdout),creator,'fresh authenticated creator must still match after watcher registration');
 const token=Buffer.alloc(32);creator.creatorToken.forEach((word,index)=>token.writeUInt32LE(word,index*4));
 assert.equal(load('/usr/lib/libproc.dylib').func('int proc_signal_with_audittoken(void *token, int signal)')(token,9),0);await exited(pin);
 assert.equal(fstatSync(held.fence).isSocket(),true);refused(f.state);assert.equal(existsSync(f.state),false);
 assert.throws(()=>held.release(),{code:'BROKER_UNAVAILABLE'});held=undefined;next=tryHoldSociety(f.state);assert.notEqual(next,null);
});

test('004. Colliding exclusion ports never confuse distinct full identities or grant an alternate fence',{timeout:45000},t=>{
 const suffix=randomBytes(28).toString('hex'),a='\0oma.society.00002000'+suffix,b='\0oma.society.0000dc00'+suffix;
 assert.notEqual(a,b);assert.equal(darwinSocietyFencePort(a),darwinSocietyFencePort(b));if(!darwin(t))return;
 let first=holdDarwinSocietyFence(a,runFence),second;t.after(()=>{try{first?.release();}catch{}try{second?.release();}catch{}});assert.equal(first.kind,'held');
 assert.throws(()=>holdDarwinSocietyFence(b,runFence),{code:'BROKER_UNAVAILABLE'},'another full identity is unavailable, never busy-as-that-Society');
 assert.equal(identifyDarwinSocietyFence(first.fd,a,runFence).kind,'matched');first.release();first=undefined;
 second=holdDarwinSocietyFence(b,runFence);assert.equal(second.kind,'held');assert.equal(identifyDarwinSocietyFence(second.fd,b,runFence).kind,'matched');
});

test('005. An inherited holder cannot free the exclusion resource by mutating its shared socket',{timeout:45000},t=>{
 if(!darwin(t))return;const f=fixture(t),held=tryHoldSociety(f.state);assert.notEqual(held,null);t.after(()=>{try{held.release();}catch{}});
 const program=join(f.base,'mutate');
 const built=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-society-fence-mutate.c',import.meta.url)),'-o',program],{encoding:'utf8',timeout:30000});
 assert.equal(built.error,undefined);assert.equal(built.status,0,built.stderr);
 const result=spawnSync(program,[],{stdio:['ignore','pipe','pipe',held.fence],encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.signal,null,result.stderr);assert.equal(result.status,0,result.stderr);t.diagnostic(result.stdout);
 refused(f.state);assert.equal(inheritedFence(held.fence,f.state).kind,'society');assert.equal(existsSync(f.state),false);
});

test('006. A paid Darwin execution scope holds the Society until complete scope death and descriptor drain',{timeout:45000},async t=>{
 if(!darwin(t))return;
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-paid-society-'))),state=join(base,'state'),controller=new AbortController();
 const previous=process.env[SOCIETY_FENCE_ENV],restore=()=>{if(previous===undefined)delete process.env[SOCIETY_FENCE_ENV];else process.env[SOCIETY_FENCE_ENV]=previous;};
 let held,next,runtime,running;
 t.after(async()=>{
  restore();controller.abort();await running?.catch(()=>{});let safe=runtime===undefined;const failures=[];
  try{await runtime?.close();safe=true;}catch(error){failures.push(error);}
  for(const lease of[held,next])try{lease?.release();}catch(error){failures.push(error);}
  if(safe)rmSync(base,{recursive:true});else t.diagnostic('Retained unconfirmed paid Society scope: '+base);
  if(failures.length)throw new AggregateError(failures,'paid Society scope cleanup remains unknown');
 });
 held=tryHoldSociety(state);assert.notEqual(held,null);assert.equal(existsSync(state),false);
 ExecutionJournal.initialize(state);runtime=new ExecutionRuntime(state,launchDarwinJobScope);await runtime.recover();
 const descendant=`const fs=require('node:fs'),assert=require('node:assert/strict');const fd=Number(process.env.${SOCIETY_FENCE_ENV});assert.equal(fd,4);assert.equal(fs.fstatSync(fd).isSocket(),true);process.stdout.write('society-descendant-ready'+String.fromCharCode(10));setInterval(()=>{},1000);`;
 const workload=`const fs=require('node:fs'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');const fd=Number(process.env.${SOCIETY_FENCE_ENV});assert.equal(fd,4);assert.equal(fs.fstatSync(fd).isSocket(),true);spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{detached:true,stdio:['ignore',1,2,'ignore',fd],env:process.env});setInterval(()=>{},1000);`;
 let output='',ready;const entered=new Promise(resolve=>{ready=resolve;});
 process.env[SOCIETY_FENCE_ENV]=String(held.fence);
 running=runtime.run('preparation',{executable:realpathSync(process.execPath),argv:['-e',workload],env:{HOME:base,TMPDIR:base,PATH:'/usr/bin:/bin'},
  cwd:base,timeoutMs:15000,stdoutBytes:4096,stderrBytes:16384},controller.signal,()=>{},[],undefined,undefined,
  (source,options)=>launchDarwinJobScope(source,{...options,stdoutSink:bytes=>{output+=Buffer.from(bytes).toString();if(output.includes('society-descendant-ready\n'))ready();}}));
 void running.catch(error=>t.diagnostic('Original paid Society scope failure: '+inspect(error,{depth:null,maxStringLength:8192,maxArrayLength:128})));
 await Promise.race([entered,running.then(result=>{throw new Error('paid scope ended before descendant readiness: '+JSON.stringify({...result,stdout:result.stdout.toString(),stderr:result.stderr.toString()}));})]);
 restore();const rows=ExecutionJournal.inspect(state);assert.equal(rows.length,1);const identity=rows[0].witness;
 assert.equal(identity.kind,'darwin-resource-coalition');assert.equal(observeDarwinCoalitionPopulation(identity),'populated');
 const released=held;held=undefined;released.release();refused(state);
 assert.equal(observeDarwinCoalitionPopulation(identity),'populated','scope must still be live while takeover is refused');
 controller.abort();const result=await running;assert.equal(result.kind,'aborted');
 assert.equal(observeDarwinCoalitionPopulation(identity),'empty');assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(state),[]);
 next=tryHoldSociety(state);assert.notEqual(next,null,'only complete scope death and descriptor drain return the Society');
});

test('007. A live Host tenure keeps the Society through its fenced execution owner crash and journal recovery',{timeout:45000},async t=>{
 if(!darwin(t))return;
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-society-recovery-'))),state=join(base,'state');
 let tenure,other,owner,closed,pin,identity,initialized=false,recovered=false;
 t.after(async()=>{
  const failures=[];
  if(owner?.exitCode===null&&owner.signalCode===null)owner.kill('SIGKILL');try{await closed;}catch(error){failures.push(error);}
  if(initialized&&!recovered&&tenure?.held)try{tenure.assertOwned('Society crash recovery');await recoverExecutionState(state,false);if(identity&&observeDarwinCoalitionPopulation(identity)!=='empty')throw new Error('original fenced scope remains unconfirmed');recovered=true;}catch(error){failures.push(error);}
  try{pin?.close();}catch(error){failures.push(error);}
  for(const held of[other,tenure])try{await held?.end();}catch(error){failures.push(error);}
  if(!initialized||recovered)rmSync(base,{recursive:true});else t.diagnostic('Retained unconfirmed fenced recovery: '+base);
  if(failures.length)throw new AggregateError(failures,'fenced recovery cleanup remains unknown');
 });
 tenure=HostTenure.take(state);assert.notEqual(tenure,null);ExecutionJournal.initialize(state);initialized=true;
 owner=fork(fileURLToPath(new URL('./fixtures/darwin-recovery.mjs',import.meta.url)),[state,'released-society'],
  {stdio:['ignore','ignore','pipe','ipc',tenure.fence],env:{...closedEnv(),[SOCIETY_FENCE_ENV]:'4'}});
 let stderr='';owner.stderr.on('data',bytes=>{stderr+=bytes;});
 closed=new Promise((yes,no)=>{owner.once('error',no);owner.once('close',(code,signal)=>yes({code,signal}));});void closed.catch(()=>{});
 assert.deepEqual(await closed,{code:null,signal:'SIGKILL'},stderr);
 const rows=ExecutionJournal.inspect(state);assert.equal(rows.length,1);identity=rows[0].witness;
 assert.equal(identity.kind,'darwin-resource-coalition');assert.equal(observeDarwinCoalitionPopulation(identity),'populated');
 pin=pinDarwinProcess(Number(readFileSync(join(state,'descendant.pid'),'utf8')));assert.equal(pin.state(),'live');assert.deepEqual(pin.identity,identity);
 other=HostTenure.take(state);assert.equal(other,null,'a dead broker owner cannot create a gap in the live Host tenure');
 const before=readFileSync(join(state,'execution/scopes.jsonl'));tenure.assertOwned('Society crash recovery');
 try{await recoverExecutionState(state,false);}catch(error){t.diagnostic('Original fenced recovery failure: '+JSON.stringify({identity,rows:ExecutionJournal.inspect(state).length})+' '+inspect(error,{depth:null,maxStringLength:8192,maxArrayLength:128}));throw error;}
 assert.equal(observeDarwinCoalitionPopulation(identity),'empty');assert.equal(pin.state(),'exited');assert.deepEqual(ExecutionJournal.inspect(state),[]);recovered=true;
 assert.deepEqual(readFileSync(join(state,'execution/scopes.jsonl')).subarray(0,before.length),before,'recovery preserves the original journal frames');
 const ended=tenure;tenure=undefined;await ended.end();tenure=HostTenure.take(state);assert.notEqual(tenure,null,'only the completed Host tenure and recovered scope permit a new owner');
});

test('008. The product private supervision channel binds the actual Host and ends its fenced Broker after Host SIGKILL',{timeout:45000},async t=>{
 if(!darwin(t))return;
 const fake=controlSocketPair();try{assert.equal(pinDarwinPrivateParent(fake.parent),null,'a same-user socket owned by this process is not its parent');}finally{closeSync(fake.parent);closeSync(fake.child);}
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-private-supervision-'))),f={base,state:join(base,'state')};ExecutionJournal.initialize(f.state);
 const host=fork(fileURLToPath(new URL('./fixtures/darwin-supervision.mjs',import.meta.url)),[f.state,'host'],{stdio:['ignore','ignore','pipe','ipc'],env:closedEnv()});
 let stderr='',pin,next;host.stderr.on('data',bytes=>{stderr+=bytes;});
 const closed=new Promise((yes,no)=>{host.once('error',no);host.once('close',(code,signal)=>yes({code,signal}));});void closed.catch(()=>{});
 t.after(async()=>{
  if(host.exitCode===null&&host.signalCode===null)host.kill('SIGKILL');await closed;
  const limit=performance.now()+16000;while(pin?.state()==='live'&&performance.now()<limit)await delay(10);
  const ended=pin?.state()==='exited';pin?.close();next?.release();
  if(ended)rmSync(base,{recursive:true});else t.diagnostic('Retained unconfirmed private supervision: '+base);
 });
 const [ready]=await Promise.race([once(host,'message'),closed.then(status=>{throw new Error('Host/Broker supervision failed before readiness: '+JSON.stringify(status)+' '+stderr);})]);
 assert.equal(ready.kind,'ready');assert.equal(ready.host,host.pid);assert.ok(ready.broker>1);
 pin=watchDarwinProcess(ready.broker);assert.equal(pin.state(),'live');refused(f.state);
 host.kill('SIGKILL');assert.deepEqual(await closed,{code:null,signal:'SIGKILL'},stderr);await exited(pin);
 const ended=JSON.parse(readFileSync(join(f.state,'broker-ended.json'),'utf8'));assert.equal(ended.pid,ready.broker);assert.match(ended.reason,/host/);
 next=tryHoldSociety(f.state);assert.notEqual(next,null,'the ended private Broker returns its inherited Society fence');
});
