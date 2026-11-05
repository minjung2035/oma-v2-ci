/** World navigation and context publication share the same borrowed directory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,fchmodSync,fstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '@oma/storage';
import {removeOwnedTree} from '@oma/storage/directory';
import {ViewsModule} from '#oma-test/app/views';
import {PRINCIPAL_MAIL_FILENAME} from '@oma/domain/derived';

for(const mode of ['retained','captured-after-create'])test(`001. World views ${mode} publish through the original directory after replacement and mode000`,t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-world-directory-'))),world=join(root,'world');mkdirSync(world);
 const store=new Store(join(root,'runtime.sqlite'),undefined,{society:'demo'}),fd=openSync(world,'r');
 t.after(()=>{store.close();closeSync(fd);removeOwnedTree(root);});
 const names=['agents.tsv','topics.tsv','START.md',PRINCIPAL_MAIL_FILENAME];
 const baseline=new ViewsModule(store,root,'demo','p');baseline.refreshWorld();
 const expected=names.map(name=>readFileSync(join(world,name),'utf8'));
 renameSync(world,world+'-moved');mkdirSync(world);writeFileSync(join(world,'sentinel'),'replacement');fchmodSync(fd,0);
 let resolutions=0;const views=new ViewsModule(store,root,'demo','p',undefined,'legacy',{worldDirectory:()=>{resolutions++;return mode==='captured-after-create'&&resolutions===1?undefined:fd;}});
 views.refreshWorld();assert.deepEqual(names.map(name=>readFileSync(join(world+'-moved',name),'utf8')),expected);
 assert.equal(fstatSync(fd).mode&0o700,0o700);
 for(const name of names)assert.equal(statSync(join(world+'-moved',name)).mode&0o777,0o444);
 assert.deepEqual(readdirSync(world),['sentinel']);assert.equal(readFileSync(join(world,'sentinel'),'utf8'),'replacement');
 assert.deepEqual(readdirSync(world+'-moved').sort(),names.sort());
 views.refreshWorld();assert.deepEqual(readdirSync(world),['sentinel']);assert.equal(resolutions,mode==='retained'?2:3);
 assert.equal(fstatSync(fd).isDirectory(),true,'borrowed world descriptor remains open');
});

test('002. Invalid borrowed world capability refuses before publishing any world file',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-world-invalid-'))),world=join(root,'world');mkdirSync(world);
 const store=new Store(join(root,'runtime.sqlite'),undefined,{society:'demo'}),file=join(root,'file');writeFileSync(file,'original');const fd=openSync(file,'r');
 t.after(()=>{store.close();closeSync(fd);removeOwnedTree(root);});
 const views=new ViewsModule(store,root,'demo','p',undefined,'legacy',{worldDirectory:()=>fd});
 assert.throws(()=>views.refreshWorld(),{code:'STORE_CORRUPT'});assert.deepEqual(readdirSync(world),[]);assert.equal(readFileSync(file,'utf8'),'original');
});
