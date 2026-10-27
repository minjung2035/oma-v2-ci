import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,openSync,closeSync,readSync,fstatSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runProcessSync} from '@oma/process/run';
import {startProcess} from '@oma/process/async';

for (const asynchronous of [false,true]) test(`${asynchronous?'async':'sync'} stdin borrows the pinned file at its current offset and leaves it owned by its caller`,async t=>{
  const root=mkdtempSync(join(tmpdir(),'oma-input-fd-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'input'),bytes=Buffer.from([80,82,69,0,255,10,65]);writeFileSync(path,bytes);
  const fd=openSync(path,'r'),identity=fstatSync(fd);t.after(()=>closeSync(fd));
  readSync(fd,Buffer.alloc(3),0,3,null);
  renameSync(path,join(root,'held'));writeFileSync(path,'replacement must not be read');
  const spec={executable:process.execPath,argv:['-e',"process.stdin.on('data',bytes=>process.stdout.write(bytes))"],env:{},
    stdinFd:fd,timeoutMs:5000,stdoutBytes:1024,stderrBytes:1024};
  let result;
  if(asynchronous){const task=startProcess(spec);result=await task.result;await task.closed;}else result=runProcessSync(spec);
  assert.equal(result.kind,'exited');assert.equal(result.exitCode,0);assert.deepEqual(result.stdout,bytes.subarray(3));
  assert.equal(fstatSync(fd).ino,identity.ino,'the runner must not close a borrowed descriptor');
});

test('a descriptor and byte input cannot describe the same stdin',()=>{
  const spec={executable:process.execPath,argv:[],env:{},stdinFd:0,input:'ambiguous',timeoutMs:5000,stdoutBytes:1024,stderrBytes:1024};
  for(const run of [runProcessSync,startProcess])assert.throws(()=>run(spec),/mutually exclusive/);
  for(const stdinFd of [-1,0.5,NaN,'3'])for(const run of [runProcessSync,startProcess])assert.throws(()=>run({...spec,input:undefined,stdinFd}),/stdin descriptor/);
});
