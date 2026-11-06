/** Exact pinned-entry reopen on the actual kernel: access can be gained only for the same inode. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,constants,mkdtempSync,openSync,readFileSync,readSync,realpathSync,renameSync,rmSync,writeFileSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pinBeneath,reopenPinned} from '@oma/native/files';

test('001. A pinned entry reopens for append and an independent read as the same inode, and follows that inode to a new name',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-reopen-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'journal'),'first\n',{mode:0o600});
 const parent=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY);t.after(()=>closeSync(parent));
 const pin=pinBeneath(parent,'journal');t.after(()=>closeSync(pin));
 const append=reopenPinned(pin,constants.O_RDWR|constants.O_APPEND|constants.O_NONBLOCK);
 writeSync(append,'second\n');closeSync(append);
 assert.equal(readFileSync(join(root,'journal'),'utf8'),'first\nsecond\n');
 const read=reopenPinned(pin,constants.O_RDONLY|constants.O_NONBLOCK);
 const bytes=Buffer.alloc(64),length=require_read(read,bytes);closeSync(read);
 assert.equal(bytes.subarray(0,length).toString(),'first\nsecond\n','an independent read cursor starts at the beginning');
 if(process.platform!=='darwin')return;
 // The pinned inode's name now belongs to another inode: Darwin reopen must refuse it.
 renameSync(join(root,'journal'),join(root,'moved'));writeFileSync(join(root,'journal'),'other\n');
 const moved=reopenPinned(pin,constants.O_RDONLY);closeSync(moved);
 assert.equal(readFileSync(join(root,'moved'),'utf8'),'first\nsecond\n','the pinned inode is followed to its new name');
});
function require_read(fd,buffer){let total=0;for(;;){const n=readSync(fd,buffer,total,buffer.length-total,null);if(n===0)return total;total+=n;}}
