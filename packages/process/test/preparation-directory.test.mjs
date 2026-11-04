/** Real cwd/file observations; Darwin uses its actual transient scope. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,renameSync,openSync,closeSync,writeSync,existsSync,rmSync,constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreparationExecutor } from '../dist/preparation.js';
import { controlPipe } from '@oma/native/control-socket';
const command=(root,script)=>({executable:realpathSync(process.execPath),argv:['-e',script],env:{HOME:root,TMPDIR:root},timeoutMs:10000,stdoutBytes:4096,stderrBytes:4096});
test('001. Preparation cwd stays with its held directory through rename and pathname replacement',{timeout:30000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-preparation-directory-'))),original=join(root,'original'),moved=join(root,'moved');
 mkdirSync(original);writeFileSync(join(original,'accepted'),'held original');
 const directoryFd=openSync(original,constants.O_RDONLY|constants.O_DIRECTORY),gate=controlPipe();let writer=true;
 t.after(()=>{if(writer)closeSync(gate.write);closeSync(gate.read);closeSync(directoryFd);rmSync(root,{recursive:true});});
 const executor=new PreparationExecutor(),controls={directoryFd};
 const run=executor.run({...command(root,"const fs=require('node:fs');fs.readFileSync(0);const accepted=fs.readFileSync('accepted','utf8');fs.writeFileSync('effect','inside held directory');process.stdout.write(JSON.stringify({accepted,cwd:process.cwd()}))"),stdinFd:gate.read},undefined,[],{},controls);
 controls.directoryFd=-1;renameSync(original,moved);mkdirSync(original);writeFileSync(join(original,'accepted'),'replacement');
 writeSync(gate.write,Buffer.from('go'));closeSync(gate.write);writer=false;
 const result=await run;assert.equal(result.kind,'exited');assert.equal(result.exitCode,0,result.stderr.toString());
 assert.deepEqual(JSON.parse(result.stdout),{accepted:'held original',cwd:moved});
 assert.equal(readFileSync(join(moved,'effect'),'utf8'),'inside held directory');assert.equal(existsSync(join(original,'effect')),false);
 assert.equal(readFileSync(join(original,'accepted'),'utf8'),'replacement');assert.equal(executor.quiescence,'quiescent');
});
test('002. A non-directory or conflicting pathname cwd refuses before a preparation becomes active',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-preparation-directory-input-')));writeFileSync(join(root,'ordinary'),'bytes');
 const file=openSync(join(root,'ordinary'),'r'),directory=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);
 t.after(()=>{closeSync(file);closeSync(directory);rmSync(root,{recursive:true});});
 const executor=new PreparationExecutor(),source=command(root,"throw Error('must not execute')");
 await assert.rejects(executor.run(source,undefined,[],{},{directoryFd:file}),TypeError);
 await assert.rejects(executor.run({...source,cwd:root},undefined,[],{},{directoryFd:directory}),TypeError);
 assert.equal(executor.quiescence,'quiescent');
});
