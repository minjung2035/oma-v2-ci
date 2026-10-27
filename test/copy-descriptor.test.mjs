/** Real POSIX file/cursor observations, independent of Darwin scope proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,openSync,closeSync,readSync,renameSync,rmSync,statSync,symlinkSync,constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {openDirectory} from '@oma/native/files';
import {copyDescriptorToEntry} from '@oma/storage/file-digest';
test('disposable copy preserves a held source after path replacement and does not advance its accepted cursor',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-copy-fd-'))),source=join(root,'accepted'),name='한 글자 "\\line\ncopy';
  const bytes=Buffer.alloc(2*1024*1024+17);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  writeFileSync(source,bytes);const fd=openSync(source,constants.O_RDONLY),parent=openDirectory(root);
  t.after(()=>{closeSync(parent);closeSync(fd);rmSync(root,{recursive:true,force:true});});
  const first=Buffer.alloc(7);assert.equal(readSync(fd,first),7);
  renameSync(source,join(root,'original-inode'));writeFileSync(source,'replacement must never be read');
  const result=copyDescriptorToEntry(fd,parent,name);
  assert.deepEqual(result,{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  assert.deepEqual(readFileSync(join(root,name)),bytes);assert.equal(statSync(join(root,name)).mode&0o777,0o444);
  const next=Buffer.alloc(11);assert.equal(readSync(fd,next),11);assert.deepEqual(next,bytes.subarray(7,18));
  assert.equal(readFileSync(source,'utf8'),'replacement must never be read');
  assert.throws(()=>copyDescriptorToEntry(fd,parent,name),{code:'EEXIST'});assert.deepEqual(readFileSync(join(root,name)),bytes);
  symlinkSync(source,join(root,'alias'));assert.throws(()=>copyDescriptorToEntry(fd,parent,'alias'),{code:'EEXIST'});
  assert.equal(readFileSync(source,'utf8'),'replacement must never be read');
  for(const name of ['../outside','a/b','','.','..','nul\0name'])assert.throws(()=>copyDescriptorToEntry(fd,parent,name),TypeError);
});
test('disposable copy refuses a real device before creating an output',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-copy-device-'))),parent=openDirectory(root),fd=openSync('/dev/null',constants.O_RDONLY);
  t.after(()=>{closeSync(fd);closeSync(parent);rmSync(root,{recursive:true,force:true});});
  assert.throws(()=>copyDescriptorToEntry(fd,parent,'must-not-exist'),/regular file/);
  assert.throws(()=>statSync(join(root,'must-not-exist')),{code:'ENOENT'});
});
