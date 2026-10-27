import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listOwnedDirectory } from "@oma/storage/directory";
function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'oma-owned-inbox-')),inbox=join(root,'mail/inboxes/principal/new');return{root,inbox,read:()=>listOwnedDirectory(inbox,{required:true}).map(entry=>entry.name),close(){if(fs.existsSync(inbox))fs.chmodSync(inbox,0o700);fs.rmSync(root,{recursive:true,force:true});}};}
test('NATIVE-FILES-PRINCIPAL-01: owned inbox listing repairs its leaf and preserves every entry name',()=>{
 const f=fixture();try{fs.mkdirSync(f.inbox,{recursive:true});fs.writeFileSync(join(f.inbox,'message'),'mail');fs.writeFileSync(join(f.inbox,'.temporary'),'held');fs.chmodSync(f.inbox,0);
 assert.deepEqual([...f.read()].sort(),['.temporary','message']);assert.equal(fs.statSync(f.inbox).mode&0o700,0o700);
 }finally{f.close();}
});
test('NATIVE-FILES-PRINCIPAL-02: missing or failed owned inbox listing refuses and never returns an empty success',()=>{
 const f=fixture();const realRead=fs.fstatSync;try{
 assert.throws(f.read);assert.equal(fs.existsSync(f.inbox),false,'a read does not create an absent mailbox');
 fs.mkdirSync(f.inbox,{recursive:true});const failure=Object.assign(new Error('injected listing failure'),{code:'EIO'});let descriptor;
 fs.fstatSync=(fd,...args)=>{if(fs.readlinkSync(`/proc/self/fd/${fd}`)===f.inbox){descriptor=fd;throw failure;}return realRead(fd,...args);};syncBuiltinESMExports();
 assert.throws(f.read,error=>error===failure);assert.equal(typeof descriptor,'number');
 fs.fstatSync=realRead;syncBuiltinESMExports();assert.throws(()=>fs.fstatSync(descriptor),{code:'EBADF'});
 }finally{fs.fstatSync=realRead;syncBuiltinESMExports();f.close();}
});
