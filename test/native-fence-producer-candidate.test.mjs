/** Creator/instance provenance experiment, not a product lease backend.
 * Namespace discovery, hostile keeper replacement and recovery remain open. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,readFileSync,rmSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {load,errno} from 'koffi';
import {controlSocketPair} from '@oma/native/control-socket';
import {createMachEndpoint,createMachFilePort,openMachFilePort} from '@oma/native/mach-message';
import {peerFromMachReceiver} from '@oma/native/darwin-job-peer';
import {pinDarwinProcess} from '@oma/native/audit-session';
import {observeDarwinAuditOrigin} from '@oma/native/audit-origin';
import {machoImageCdHashes} from '@oma/native/darwin-macho-image';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';

async function packet(receiver,terminal=()=>undefined){const end=performance.now()+15000;for(;;){const m=receiver.receive();if(m.kind==='data')return m;const ended=terminal();if(ended!==undefined)throw new Error('producer returned before publication: '+JSON.stringify(ended));assert.ok(performance.now()<end,'producer publication');await delay(10);}}
async function origin(message,hashes){const operation=observeDarwinAuditOrigin(message.sender.token,hashes);try{return await operation.result;}finally{await operation.returned;}}

test('001. Actual fixed producer binds a new socket, authenticates its instance and retains no last-close reference',{timeout:90000},async t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin fixed fence producer candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-fence-producer-'))),executable=join(root,'producer');
 const run=(program,args)=>{const r=spawnSync(program,args,{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;};
 const handles=new Set(),pairs=[],rights=[];let runtime,completed;
 t.after(async()=>{for(const p of pairs){for(const fd of[p.parent,p.child])if(handles.delete(fd))closeSync(fd);}if(completed)await completed.catch(()=>{});if(runtime)await runtime.close();for(const r of rights)r.close();for(const fd of handles)closeSync(fd);rmSync(root,{recursive:true});});
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-fence-producer-candidate.c',import.meta.url)),'-o',executable]);
 // No entitlements grants no debugging or loader exception.
 run('/usr/bin/codesign',['--force','--sign','-','--options','runtime',executable]);run('/usr/bin/codesign',['--verify','--strict',executable]);
 const hashes=machoImageCdHashes(readFileSync(executable),process.arch==='arm64'?'arm64':'x64'),endpoint=createMachEndpoint();rights.push(endpoint.send,endpoint.receive);
 const peer=peerFromMachReceiver(endpoint.receive);rights.push(peer);
 const control=controlSocketPair();pairs.push(control);handles.add(control.parent);handles.add(control.child);
 ExecutionJournal.initialize(root);runtime=new ExecutionRuntime(root,launchDarwinJobScope);await runtime.recover();
 const identity=randomBytes(32),command={executable,argv:[identity.toString('hex'),'0'],env:{PATH:'/usr/bin:/bin'},timeoutMs:30000,stdoutBytes:8192,stderrBytes:8192};
 let terminal;completed=runtime.run('preparation',command,t.signal,()=>{},[],undefined,undefined,(source,options)=>launchDarwinJobScope(source,{...options,files:[{target:3,fd:control.child}],peer}));void completed.then(result=>{terminal={kind:result.kind,exitCode:result.exitCode,stderr:result.stderr.toString()};},error=>{terminal={error:String(error)};});
 const message=await packet(endpoint.receive,()=>terminal);if(message.reply)rights.push(message.reply);assert.equal(message.id,0x4f4d4170);assert.equal(message.sender.uid,process.getuid());assert.equal(message.bytes.length,64);assert.ok(message.reply);
 const selectedOrigin=await origin(message,hashes);
 t.diagnostic(JSON.stringify({phase:'fence-producer-origin',selectedOrigin,unconstrainedOrigin:await origin(message),expectedCdHashes:hashes,sender:message.sender,terminal:terminal??null}));
 const producer=pinDarwinProcess(message.sender.pid);rights.push(producer);assert.deepEqual(producer.token,message.sender.token);assert.equal(producer.state(),'live');
 t.diagnostic(JSON.stringify({phase:'fence-producer-live',producerState:producer.state()}));
 assert.equal(selectedOrigin.kind,'matched',JSON.stringify(selectedOrigin));assert.equal((await origin(message,['0'.repeat(40)])).kind,'unavailable');
 assert.deepEqual(message.bytes.subarray(0,32),identity);
 const fd=openMachFilePort(message.reply);handles.add(fd);message.reply.close();
 const native=load(null),inspect=load("/usr/lib/libproc.dylib").func('int proc_pidfdinfo(int pid, int fd, int flavor, void *result, int size)'),socket=native.func('int socket(int domain, int type, int protocol)'),bind=native.func('int bind(int fd, const void *address, unsigned int length)'),option=native.func('int setsockopt(int fd, int level, int option, const void *value, unsigned int length)'),connect=native.func('int connect(int fd, const void *address, unsigned int length)'),shutdown=native.func('int shutdown(int fd, int how)'),disconnect=native.func('int disconnectx(int fd, unsigned int association, unsigned int connection)'),dup=native.func('int dup(int fd)');
 const size=message.bytes.readUInt32LE(52),socketOffset=message.bytes.readUInt32LE(56),generationOffset=message.bytes.readUInt32LE(60);assert.ok(size>0&&size<=4096&&socketOffset+8<=size&&generationOffset+8<=size);
 const observed=held=>{const bytes=Buffer.alloc(size);assert.equal(inspect(process.pid,held,3,bytes,size),size);return{socket:bytes.readBigUInt64LE(socketOffset),generation:bytes.readBigUInt64LE(generationOffset)};};
 const created={socket:message.bytes.readBigUInt64LE(32),generation:message.bytes.readBigUInt64LE(40)};assert.deepEqual(observed(fd),created);
 const port=message.bytes.readUInt32LE(48),address=Buffer.alloc(28);address[0]=28;address[1]=30;address.writeUInt16BE(port,2);
 const number=value=>{const b=Buffer.alloc(4);b.writeInt32LE(value);return b;};
 const make=()=>{const s=socket(30,2,0);assert.ok(s>=0);handles.add(s);assert.equal(option(s,41,27,number(1),4),0);return s;};
 const free=fd=>{handles.delete(fd);closeSync(fd);};
 const occupied=()=>{const s=make();const status=bind(s,address,28),error=errno();free(s);assert.equal(status,-1);assert.equal(error,48);};
 occupied();
 const duplicate=dup(fd);assert.ok(duplicate>=0);handles.add(duplicate);free(fd);assert.deepEqual(observed(duplicate),created);occupied();
 // A separate specific bind can reach the same frozen wildcard state. Its
 // socket instance remains different; a body replay also has the wrong image.
 const alias=make();for(const key of[4,0x200])assert.equal(option(alias,0xffff,key,number(1),4),0);
 const loopback=Buffer.from(address);loopback[23]=1;assert.equal(bind(alias,loopback,28),0);assert.equal(connect(alias,loopback,28),0);
 for(const key of[4,0x200])assert.equal(option(alias,0xffff,key,number(0),4),0);
 assert.equal(option(alias,0xffff,0x1081,number(2),4),0);assert.equal(shutdown(alias,2),0);assert.equal(disconnect(alias,0,0),0);
 assert.notDeepEqual(observed(alias),created);
 const forged=createMachFilePort(alias);try{assert.equal(endpoint.send.send(message.id,message.bytes,forged),'sent');}finally{forged.close();}
 const replay=await packet(endpoint.receive);try{assert.equal((await origin(replay,hashes)).kind,'unavailable');}finally{replay.reply?.close();}
 free(alias);free(duplicate);
 // The genuine producer is still waiting on FD3, but no longer holds the
 // socket: the original no-reuse wildcard binding is available after last FD.
 assert.equal(producer.state(),'live');const next=make();assert.equal(bind(next,address,28),0);free(next);assert.equal(producer.state(),'live');
 free(control.parent);const result=await completed;assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());
 assert.deepEqual(JSON.parse(result.stdout.toString()),{created:true,producerRetainsSocket:false});assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 t.diagnostic(JSON.stringify({productionAdopted:false,port,created:Object.fromEntries(Object.entries(created).map(([k,v])=>[k,String(v)])),authenticatedCreator:true,independentAliasRejected:true,nodeBodyReplayRejected:true,producerAliveAcrossLastClose:true}));
});
