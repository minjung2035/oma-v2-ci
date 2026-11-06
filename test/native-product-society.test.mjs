/** Actual product path on Darwin: a fresh `oma` Society, then its Broker to readiness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {readSessionBirth} from '#oma-test/app/runtime/session-mode';

const entry=name=>join(import.meta.dirname,'../apps/oma/dist/entry',name+'.js');
function darwin(t){if(process.platform==='darwin')return true;t.diagnostic('NOT_RUN: actual Darwin product Society');return false;}
function start(argv,cwd,env){
 const child=spawn(process.execPath,argv,{cwd,env,stdio:['ignore','pipe','pipe']});let stderr='',stdout='';
 child.stderr.on('data',bytes=>{stderr+=bytes;});child.stdout.on('data',bytes=>{stdout=(stdout+bytes).slice(-8192);});
 const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 return {child,exited,stderr:()=>stderr,stdout:()=>stdout};
}
async function until(check,ms,what){const limit=performance.now()+ms;let value;while(!(value=check())){if(performance.now()>=limit)throw new Error('timed out: '+(typeof what==='function'?what():what));await new Promise(resolve=>setTimeout(resolve,50));}return value;}
/** Bounded stop: an owner that does not exit is reported, then killed, never awaited forever. */
async function stop(owner,ms=20000){owner.child.kill('SIGTERM');const end=await Promise.race([owner.exited,new Promise(resolve=>setTimeout(()=>resolve(null),ms))]);if(end===null){owner.child.kill('SIGKILL');await owner.exited;}return end;}
/** What a timed-out product run actually left: files, processes and the terminal tail. */
const evidence=(base,owner)=>JSON.stringify({files:spawnSync('/usr/bin/find',[base,'-maxdepth','6','-not','-path','*/node_modules/*'],{encoding:'utf8'}).stdout.split('\n').slice(0,200),
 processes:spawnSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).stdout.split('\n').filter(line=>line.includes(base)||line.includes(String(owner.child.pid))),
 stderr:owner.stderr().slice(-4096),stdout:owner.stdout().replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').slice(-4096)},null,1);
const owned=base=>spawnSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).stdout.split('\n').filter(line=>line.includes(base));

test('001. A fresh oma Society is born on Darwin and its Broker reaches readiness, then stops without residue',{timeout:240000},async t=>{
 if(!darwin(t))return;
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-product-'))),project=join(base,'project'),data=join(base,'data','oma');mkdirSync(project);
 const env={...process.env,HOME:join(base,'home'),XDG_DATA_HOME:join(base,'data'),XDG_RUNTIME_DIR:join(base,'run'),NODE_DISABLE_COMPILE_CACHE:'1'};
 const running=[];
 t.after(async()=>{for(const owner of running)if(owner.child.exitCode===null&&owner.child.signalCode===null){owner.child.kill('SIGKILL');await Promise.race([owner.exited,new Promise(resolve=>setTimeout(resolve,5000))]);}
  spawnSync('/bin/chmod',['-R','u+w',base]);rmSync(base,{recursive:true,force:true});});
 // 1. The real product entry creates the Society: birth, binding and configuration.
 const host=start([entry('oma')],project,env);running.push(host);
 const root=await until(()=>{try{return readdirSync(data).filter(name=>!name.startsWith('.')).map(name=>join(data,name))
  .find(path=>{try{return readSessionBirth(path)!==null;}catch{return false;}});}catch{return undefined;}},60000,()=>'fresh Society birth '+evidence(base,host));
 await until(()=>{try{return readdirSync(root).includes('config.json');}catch{return false;}},60000,()=>'Society configuration after birth '+evidence(base,host));
 const birth=readSessionBirth(root);assert.equal(birth.mode,'society');assert.equal(birth.surface,'collaboration-v1');
 assert.notEqual(await stop(host),null,'the Host ends on SIGTERM: '+host.stderr());
 await until(()=>owned(base).length===0,30000,'Host and its children ended: '+owned(base).join('\n'));
 // 2. The real Broker entry boots that Society through the Darwin composition.
 const society=birth.id,runRoot=join(base,'run','oma',society);
 const broker=start([entry('broker'),'--society',society,'--state-root',root,'--run-root',runRoot,'--config',join(root,'config.json')],project,env);running.push(broker);
 await until(()=>/broker ready/.test(broker.stderr())||/broker (startup|initialization) failed/.test(broker.stderr())||broker.child.exitCode!==null,180000,()=>'Broker readiness '+evidence(base,broker));
 assert.match(broker.stderr(),/broker ready/,broker.stderr());
 assert.deepEqual(await stop(broker),{code:0,signal:null},broker.stderr());
 await until(()=>owned(base).length===0,30000,'no Broker descendant remains: '+owned(base).join('\n'));
});

test('002. A fresh Personal session is born on Darwin and stops without residue',{timeout:120000},async t=>{
 if(!darwin(t))return;
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-personal-'))),project=join(base,'project'),sessions=join(base,'data','oma','.personal');mkdirSync(project);
 const env={...process.env,HOME:join(base,'home'),XDG_DATA_HOME:join(base,'data'),XDG_RUNTIME_DIR:join(base,'run'),NODE_DISABLE_COMPILE_CACHE:'1'};
 const personal=start([entry('oma'),'--mode','personal'],project,env);
 t.after(async()=>{if(personal.child.exitCode===null&&personal.child.signalCode===null){personal.child.kill('SIGKILL');await Promise.race([personal.exited,new Promise(resolve=>setTimeout(resolve,5000))]);}
  spawnSync('/bin/chmod',['-R','u+w',base]);rmSync(base,{recursive:true,force:true});});
 const root=await until(()=>{try{return readdirSync(sessions).map(name=>join(sessions,name)).find(path=>{try{return readSessionBirth(path)!==null;}catch{return false;}});}catch{return undefined;}},60000,()=>'Personal birth '+evidence(base,personal));
 const birth=readSessionBirth(root);assert.equal(birth.mode,'personal');assert.equal(birth.cwd,project);
 assert.doesNotMatch(personal.stderr(),/UNSUPPORTED_PROFILE|blocked by/,personal.stderr());
 assert.notEqual(await stop(personal),null,'Personal ends on SIGTERM: '+personal.stderr());
 await until(()=>owned(base).length===0,30000,'no Personal descendant remains: '+owned(base).join('\n'));
});
