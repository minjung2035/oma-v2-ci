/** Trusted protocol driver source. This is neither product entry nor Pi.
 * Imports outside the small private fixture are not immutable-library proof. */
import {fileURLToPath} from 'node:url';
const library=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,'');

export function actorProgram(){
 return `import assert from 'node:assert/strict';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {BrokerChannel} from ${JSON.stringify(import.meta.resolve('@oma/client/channel'))};
import {dialMachChannel} from ${JSON.stringify(import.meta.resolve('@oma/platform-mac/mach-transport'))};
import {pinInheritedDarwinPeer} from ${JSON.stringify(import.meta.resolve('@oma/native/audit-session'))};
import {FrameParser} from ${JSON.stringify(import.meta.resolve('@oma/protocol/frame'))};
const input=JSON.parse(process.argv[1]),peer=pinInheritedDarwinPeer();
const channel=new BrokerChannel(input.limits,path=>dialMachChannel(path,input.limits.idleStreamSeconds));
try{
 if(input.foreign){
  const {socket,ready}=dialMachChannel(input.path,input.limits.idleStreamSeconds),parser=new FrameParser(input.limits.frameBytes);
  const closed=new Promise(resolve=>socket.once('close',resolve));
  const reply=new Promise((resolve,reject)=>{socket.on('error',reject);socket.on('data',bytes=>{try{for(const frame of parser.feed(bytes))resolve(frame.raw);}catch(e){reject(e);}});
   socket.once('end',()=>{try{parser.finish();}catch(e){reject(e);}});});void reply.catch(()=>{});
  await ready;const refused=await reply;assert.equal(refused.ok,false);assert.equal(refused.error.code,'AUTH_FAILED');
  socket.destroy();await closed;assert.equal(socket.resourcesReturned,true);console.log(JSON.stringify({foreign:true,refused:true,pid:process.pid}));
 }
 else{
  await channel.connect(input.path);const first=await channel.call('operation.get',{key:'missing-fixture-key'});
  assert.equal(first.ok,true,JSON.stringify(first));
  assert.throws(()=>readFileSync(input.stateRoot+'/runtime.sqlite'),e=>['EPERM','EACCES'].includes(e.code));
  writeFileSync(input.home+'/positive.json',JSON.stringify({pid:process.pid,peer:peer.token,first}));
  const deadline=performance.now()+20000;
  while(!existsSync(input.home+'/revoke')){assert.ok(performance.now()<deadline);await delay(10);}
  const stale=await channel.call('operation.get',{key:'missing-fixture-key'});
  assert.equal(stale.ok,false);assert.equal(stale.error.code,'STALE_RUN');
  writeFileSync(input.home+'/stale.json',JSON.stringify({pid:process.pid,stale}));
  while(!existsSync(input.home+'/finish')){assert.ok(performance.now()<deadline);await delay(10);}
 }
}finally{channel.close();peer.close();}
`;
}

export function runnerProgram(worker){
 return `import assert from 'node:assert/strict';
import {Socket} from 'node:net';import {writeFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {BrokerChannel} from ${JSON.stringify(import.meta.resolve('@oma/client/channel'))};
import {prepareSeatbelt} from ${JSON.stringify(import.meta.resolve('@oma/platform-mac/seatbelt'))};
import {spawnWithPrivateInputs} from ${JSON.stringify(import.meta.resolve('@oma/process/async'))};
import {pinInheritedDarwinPeer} from ${JSON.stringify(import.meta.resolve('@oma/native/audit-session'))};
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1],root=value('--state-root'),actor=value('--agent'),execution=value('--execution');
const home=root+'/actor-home',limits={frameBytes:262144,idleStreamSeconds:30,receiptWaitSeconds:30};
const socket=new Socket({fd:6,readable:true,writable:true}),channel=new BrokerChannel(limits),peer=pinInheritedDarwinPeer();
socket.on('error',()=>{});await channel.attach(socket);
try{
 for(const params of [{agent:'bob',invocationId:execution.replaceAll('-','')},{agent:actor,invocationId:'a'.repeat(32)}]){
  const refused=await channel.call('runner.open',params);assert.equal(refused.ok,false);assert.equal(refused.error.code,'AUTH_FAILED');
 }
 const opened=await channel.call('runner.open',{agent:actor,invocationId:execution.replaceAll('-','')});assert.equal(opened.ok,true,JSON.stringify(opened));
 const input={path:opened.result.socketHostPath,home,stateRoot:root,limits};
 const recipe=prepareSeatbelt({executable:process.execPath,argv:['--no-global-search-paths','--input-type=module','-e',${JSON.stringify(worker)},JSON.stringify(input)],
  cwd:home,env:{HOME:home,TMPDIR:home},timeoutMs:25000,stdoutBytes:8192,stderrBytes:16384},{
  readable:[{path:${JSON.stringify(library)},kind:'directory'}],
  mapped:[{path:${JSON.stringify(library)},kind:'directory'}],
  writable:[{path:home,kind:'directory'}],denied:[],executable:[{path:process.execPath,kind:'file'}],
  unixSockets:[],machServices:[],environmentKeys:['HOME','TMPDIR']});
 const child=spawnWithPrivateInputs(recipe.command.executable,recipe.command.argv,home,recipe.command.env,recipe.privateInputs),errors=[];
 child.stderr.on('data',bytes=>errors.push(bytes));child.stdout.resume();child.stdin.end();
 const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 void closed.catch(()=>{});
 writeFileSync(home+'/runner.json',JSON.stringify({pid:process.pid,peer:peer.token,lease:opened.result,wrongActorRefused:true,wrongInvocationRefused:true}));
 const status=await closed;assert.deepEqual(status,{code:0,signal:null},Buffer.concat(errors).toString());
 const deadline=performance.now()+20000;while(!existsSync(home+'/runner-finish')){assert.ok(performance.now()<deadline);await delay(10);}
}finally{channel.close();peer.close();}
`;
}
