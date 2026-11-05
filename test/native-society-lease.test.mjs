/** Product lease owner, real creator and inherited last-close fence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,existsSync,fstatSync,mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
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
