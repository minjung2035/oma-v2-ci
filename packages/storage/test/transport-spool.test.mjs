import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransportSpool } from '@oma/storage/transport-spool';
const descriptor=body=>({bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
test('DR46-F06: transport short writes retain every byte and hand off the actual sealed file',async()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'oma-short-transport-')),body=Buffer.from('complete bytes');
 const spool=new TransportSpool(root,descriptor(body)),target=spool.fd,realWrite=fs.writeSync;let execution;
 try{
  fs.writeSync=(fd,...args)=>fd===target?realWrite(fd,args[0],args[1],Math.min(args[2],1),args[3]):realWrite(fd,...args);
  syncBuiltinESMExports();spool.append(body);
  fs.writeSync=realWrite;syncBuiltinESMExports();spool.seal();execution=spool.handoff();
  const chunks=[];for await(const chunk of execution.chunks)chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks),body);execution.release();
  assert.deepEqual(fs.readdirSync(root),[]);
 }finally{fs.writeSync=realWrite;syncBuiltinESMExports();execution?.release();spool.releaseConnection();fs.rmSync(root,{recursive:true,force:true});}
});
test('DR46-F06: transport zero write refuses once and releases its real file and directory descriptors',()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'oma-zero-transport-'));
 try{
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
   import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';
   import{TransportSpool}from ${JSON.stringify(import.meta.resolve('@oma/storage/transport-spool'))};
   const root=${JSON.stringify(root)},spool=new TransportSpool(root,${JSON.stringify(descriptor(Buffer.from('x')))});
   const file=spool.fd,directory=spool.directory,realWrite=fs.writeSync;let calls=0,code=null;
   try{
    fs.writeSync=(fd,...args)=>{if(fd===file){calls++;return 0;}return realWrite(fd,...args);};syncBuiltinESMExports();
    spool.append(Buffer.from('x'));
   }catch(error){code=error.code;}finally{fs.writeSync=realWrite;syncBuiltinESMExports();spool.releaseConnection();}
   const closed=fd=>{try{fs.fstatSync(fd);return false;}catch(error){return error.code==='EBADF';}};
   console.log(JSON.stringify({code,calls,fileClosed:closed(file),directoryClosed:closed(directory),entries:fs.readdirSync(root)}));
  `],{encoding:'utf8',timeout:10000,killSignal:'SIGKILL'});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),{code:'INTERNAL_ERROR',calls:1,fileClosed:true,directoryClosed:true,entries:[]});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
