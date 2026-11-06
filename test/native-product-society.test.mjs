/** Actual product path on Darwin: a fresh `oma` Society, then its Broker to readiness. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {readSessionBirth} from '#oma-test/app/runtime/session-mode';
import {managedResticPath} from '@oma/storage/restic-tool';

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

test('001. A fresh oma Society is born on Darwin and its Broker reaches readiness, then stops without residue',{timeout:540000},async t=>{
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
 // The Host's own argv (broker-supervisor): the bound project is prepared by this Broker.
 const broker=start([entry('broker'),'--society',society,'--state-root',root,'--run-root',runRoot,'--config',join(root,'config.json'),'--project-dir',project],project,env);running.push(broker);
 await until(()=>/broker ready/.test(broker.stderr())||/broker (startup|initialization) failed/.test(broker.stderr())||broker.child.exitCode!==null,300000,()=>'Broker readiness '+evidence(base,broker));
 assert.match(broker.stderr(),/broker ready/,broker.stderr());
 assert.deepEqual(await stop(broker,90000),{code:0,signal:null},broker.stderr());
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

test('003. The Host runs a fresh Society in a real terminal: its Broker child opens the Store and Ctrl-D ends everything',{timeout:540000},async t=>{
 if(!darwin(t))return;
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-host-'))),project=join(base,'project'),data=join(base,'data','oma');mkdirSync(project);
 t.after(()=>{spawnSync('/bin/chmod',['-R','u+w',base]);rmSync(base,{recursive:true,force:true});});
 const hex=text=>Buffer.from(text).toString('hex'),harness=join(import.meta.dirname,'fixtures','pty-harness.py');
 // The Host's own Broker child must get through runtime generation, tools and Store before Ctrl-D.
 const spec={argv:[process.execPath,entry('oma')],ready:hex('Your ideas, in motion'),readyTimeout:240,
  steps:[{wait:150},{write:hex('\x04'),wait:20}]};
 const session=spawn('python3',[harness,JSON.stringify(spec)],{cwd:project,stdio:['ignore','pipe','pipe'],
  env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(base,'home'),XDG_DATA_HOME:join(base,'data'),XDG_RUNTIME_DIR:join(base,'run'),PI_OFFLINE:'1',TERM:'xterm-256color'}});
 let out='',err='';session.stdout.on('data',b=>{out+=b;});session.stderr.on('data',b=>{err+=b;});
 const ended=new Promise(resolve=>session.once('exit',(code,signal)=>resolve({code,signal})));
 let store=null;
 const watch=(async()=>{while(session.exitCode===null&&session.signalCode===null){
  try{for(const name of readdirSync(data))if(!name.startsWith('.')&&existsSync(join(data,name,'runtime.sqlite'))){store=join(data,name);return;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,200));}})();
 const status=await ended;await watch;
 const terminal=JSON.parse(out||'{}'),screen=Buffer.from(terminal.output??'','hex').toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').slice(-3000);
 assert.deepEqual(status,{code:0,signal:null},err+screen);
 assert.equal(terminal.ready,true,screen);
 assert.doesNotMatch(screen,/no credential was granted|could not be attested|rejected the Principal session/,screen);
 assert.notEqual(store,null,'the Host-supervised Broker opened the Society Store: '+screen);
 assert.equal(readSessionBirth(store).surface,'collaboration-v1');
 assert.equal(terminal.exited,true,screen);assert.equal(terminal.code,0,screen);
 await until(()=>owned(base).length===0,30000,()=>'no Host, Broker or engine process remains: '+owned(base).join('\n'));
});

test('004. A Darwin Society is archived with the pinned Restic and its Broker restores the verified workspace',{timeout:900000},async t=>{
 if(!darwin(t))return;
 const restic=process.env.OMA_RESTIC_COMMAND??managedResticPath();
 if(!restic||!existsSync(restic)){t.diagnostic('NOT_RUN: the pinned Restic is not installed (npm run setup:storage)');return;}
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-archive-'))),project=join(base,'project'),data=join(base,'data','oma');mkdirSync(project);
 const env={...process.env,HOME:join(base,'home'),XDG_DATA_HOME:join(base,'data'),XDG_RUNTIME_DIR:join(base,'run'),NODE_DISABLE_COMPILE_CACHE:'1',OMA_RESTIC_COMMAND:restic};
 const running=[];
 t.after(async()=>{for(const owner of running)if(owner.child.exitCode===null&&owner.child.signalCode===null){owner.child.kill('SIGKILL');await Promise.race([owner.exited,new Promise(resolve=>setTimeout(resolve,5000))]);}
  spawnSync('/bin/chmod',['-R','u+w',base]);rmSync(base,{recursive:true,force:true});});
 const host=start([entry('oma')],project,env);running.push(host);
 const root=await until(()=>{try{return readdirSync(data).filter(name=>!name.startsWith('.')).map(name=>join(data,name))
  .find(path=>{try{return readSessionBirth(path)!==null&&existsSync(join(path,'config.json'));}catch{return false;}});}catch{return undefined;}},120000,()=>'fresh Society '+evidence(base,host));
 assert.notEqual(await stop(host),null,host.stderr());
 const society=readSessionBirth(root).id,argv=[entry('broker'),'--society',society,'--state-root',root,'--run-root',join(base,'run','oma',society),'--config',join(root,'config.json'),'--project-dir',project];
 const boot=async what=>{const broker=start(argv,project,env);running.push(broker);
  await until(()=>/broker ready/.test(broker.stderr())||/broker (startup|initialization) failed/.test(broker.stderr())||broker.child.exitCode!==null,300000,()=>what+' '+evidence(base,broker));
  assert.match(broker.stderr(),/broker ready/,broker.stderr());
  assert.deepEqual(await stop(broker,90000),{code:0,signal:null},broker.stderr());return broker.stderr();};
 await boot('first Broker readiness');
 await until(()=>owned(base).length===0,30000,()=>'first Broker residue: '+owned(base).join('\n'));
 const archived=spawnSync(process.execPath,[entry('oma'),'archive','--society',society],{cwd:project,env,encoding:'utf8',timeout:300000});
 if(process.arch==='x64'){
  // The pinned x64 Restic is unsigned: its image cannot be bound, so archive refuses and keeps the workspace.
  assert.notEqual(archived.status,0,archived.stderr);assert.match(archived.stderr,/no supported bounded Mach-O code signature/,archived.stderr);
  assert.doesNotMatch(archived.stderr,/Session workspace archived/,archived.stderr);
  const kept=await boot('Broker after refused archive');assert.doesNotMatch(kept,/Restoring archived/,kept);
  await until(()=>owned(base).length===0,30000,()=>'Broker residue: '+owned(base).join('\n'));return;
 }
 assert.equal(archived.status,0,archived.stderr);assert.match(archived.stderr,/Session workspace archived/,archived.stderr);
 const again=spawnSync(process.execPath,[entry('oma'),'archive','--society',society],{cwd:project,env,encoding:'utf8',timeout:120000});
 assert.equal(again.status,0,again.stderr);assert.match(again.stderr,/already archived/,again.stderr);
 const restored=await boot('restoring Broker readiness');
 assert.match(restored,/Archived session workspace restored and verified/,restored);
 await until(()=>owned(base).length===0,30000,()=>'restoring Broker residue: '+owned(base).join('\n'));
});

test('005. A scripted Principal in the real Host reaches its Broker over Mach and gets the Broker answer to a Society call',{timeout:600000},async t=>{
 if(!darwin(t))return;
 const {scriptedProvider,tools,call,text,toolResults}=await import('../dist/test/fixtures/scripted-provider.js');
 const provider=await scriptedProvider([tools(call('oma_send',{to:['nobody'],subject:'no such Worker',content:{kind:'text',value:'x'}})),text('No such Worker.')]);
 const base=realpathSync(mkdtempSync(join(tmpdir(),'oma-principal-'))),project=join(base,'project'),data=join(base,'data','oma');mkdirSync(project);
 t.after(async()=>{await provider.close();spawnSync('/bin/chmod',['-R','u+w',base]);rmSync(base,{recursive:true,force:true});});
 // The product's default Principal model is the engine's own default: point it at the script.
 const agentDir=join(data,'engine');provider.configure(agentDir);
 writeFileSync(join(agentDir,'settings.json'),JSON.stringify({...JSON.parse(readFileSync(join(agentDir,'settings.json'),'utf8')),defaultProvider:'fake',defaultModel:'scripted'}));
 const hex=value=>Buffer.from(value).toString('hex'),harness=join(import.meta.dirname,'fixtures','pty-harness.py');
 const spec={argv:[process.execPath,entry('oma')],ready:hex('Your ideas, in motion'),readyTimeout:240,
  steps:[{wait:5},{write:hex('send it to nobody'),wait:1},{write:hex('\r'),wait:240},{write:hex('\x04'),wait:20}]};
 const session=spawnSync('python3',[harness,JSON.stringify(spec)],{cwd:project,encoding:'utf8',timeout:560000,maxBuffer:16*1024*1024,
  env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:join(base,'home'),XDG_DATA_HOME:join(base,'data'),XDG_RUNTIME_DIR:join(base,'run'),TERM:'xterm-256color'}});
 const terminal=JSON.parse(session.stdout||'{}');
 // Notices only: control sequences, hyperlinks and spinner frames carry no evidence.
 const screen=[...new Set(Buffer.from(terminal.output??'','hex').toString().replace(/\x1b\][^\x07]*\x07/g,'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'')
  .split(/\r?\n/).map(line=>line.replace(/[│╭╮╰╯─]+/g,' ').trim()).filter(line=>line.length>0&&!/Working|^[░▓\s]*$/.test(line)))].join('\n').slice(-6000);
 const roots=existsSync(data)?readdirSync(data).filter(name=>!name.startsWith('.')).map(name=>({name,store:existsSync(join(data,name,'runtime.sqlite'))})):[];
 assert.equal(session.status,0,session.stderr+screen);assert.equal(terminal.ready,true,screen);
 assert.ok(provider.seen.length>=2,`the Principal made ${provider.seen.length} model request(s); societies ${JSON.stringify(roots)}:\n`+screen);
 const result=toolResults(provider.seen[1].body).at(-1)?.text??'';
 // The routing owner answered: the engine reached and authenticated to this Host's Broker.
 assert.match(result,/ADDRESS_NOT_FOUND/,result+'\n'+screen);
 assert.doesNotMatch(result,/BROKER_UNAVAILABLE|AUTH_FAILED/,result);
 assert.equal(terminal.code,0,screen);
 await until(()=>owned(base).length===0,30000,()=>'no Host, Broker or engine process remains: '+owned(base).join('\n'));
});
