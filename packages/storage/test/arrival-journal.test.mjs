import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,chmodSync,statSync,symlinkSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openOwnedDirectoryPath} from '@oma/storage/directory';
import {appendMailArrival} from '@oma/storage/arrival-journal';
import {messageIdForOperation} from '@oma/domain/derived';
const id=messageIdForOperation('op-12345678-1234-4123-8123-123456789abc',0);
function inbox(t){
 const root=mkdtempSync(join(tmpdir(),'oma-arrival-owner-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}
test('arrival append repairs its owned regular inode and preserves complete earlier records',t=>{
 const root=inbox(t),path=join(root,'arrival');
 writeFileSync(path,`123 ${id}\n456 `);chmodSync(path,0);
 const directory=openOwnedDirectoryPath(root);
 try{appendMailArrival(directory,root,id);}finally{closeSync(directory);}
 assert.match(readFileSync(path,'utf8'),new RegExp(`^123 ${id}\\n456 \\n\\d+ ${id}\\n$`));
 assert.equal(statSync(path).mode&0o600,0o600);
});
for(const kind of ['symlink','fifo','directory'])test(`arrival append refuses an owned ${kind} before I/O`,t=>{
 const root=inbox(t),path=join(root,'arrival'),outside=join(root,'outside');
 writeFileSync(outside,'unchanged');
 if(kind==='symlink')symlinkSync(outside,path);
 else if(kind==='fifo')execFileSync('mkfifo',[path]);
 else execFileSync('mkdir',[path]);
 const directory=openOwnedDirectoryPath(root);
 try{assert.throws(()=>appendMailArrival(directory,root,id),{code:'STORE_CORRUPT'});}finally{closeSync(directory);}
 assert.equal(readFileSync(outside,'utf8'),'unchanged');
});
