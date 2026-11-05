/** Broker status and mail metadata use the same borrowed root as its Store. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,fchmodSync,fstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '@oma/storage';
import {removeOwnedTree} from '@oma/storage/directory';
import {publishedMailEntries} from '@oma/storage/published-mail';
import {ViewsModule} from '#oma-test/app/views';
import {decodeStatusView,statusViewPath} from '@oma/protocol/status-view';
import {mailNoticeViewPath} from '@oma/storage/mail-notices';

test('001. Status and mail metadata stay on the Store root after replacement, mode000 and unsafe mail traversal',t=>{
 const top=realpathSync(mkdtempSync(join(tmpdir(),'oma-state-view-'))),root=join(top,'state');mkdirSync(root);
 const fd=openSync(root,'r'),store=new Store(join(root,'runtime.sqlite'),undefined,{society:'demo'},undefined,process.platform==='darwin'?{directoryFd:fd}:{});
 t.after(()=>{store.close();closeSync(fd);removeOwnedTree(top);});
 const id='m-00000000-0000-4000-8000-000000000001-0',other='m-00000000-0000-4000-8000-000000000002-0';
 mkdirSync(join(root,'mail/archive/cur'),{recursive:true});writeFileSync(join(root,'mail/archive/cur',id+':2,'),'original');
 renameSync(root,root+'-moved');mkdirSync(root);writeFileSync(statusViewPath(root),'status replacement');writeFileSync(mailNoticeViewPath(root),'notice replacement');
 fchmodSync(fd,0);let resolutions=0;
 const views=new ViewsModule(store,root,'demo','p',undefined,'legacy',{stateDirectory:()=>{resolutions++;return fd;}}),snapshot={observedAtMs:Date.now(),units:new Map(),failure:'unavailable'};
 views.publishStatus(snapshot,[]);
 assert.equal(fstatSync(fd).mode&0o700,0o700);assert.equal(decodeStatusView(readFileSync(statusViewPath(root+'-moved'),'utf8'),'demo').kind,'view');
 const notice=readFileSync(mailNoticeViewPath(root+'-moved'),'utf8');assert.deepEqual(JSON.parse(notice),{schema:1,messages:[{id,requester:null}]});
 for(const path of [statusViewPath(root+'-moved'),mailNoticeViewPath(root+'-moved')])assert.equal(statSync(path).mode&0o777,0o600);
 assert.equal(readFileSync(statusViewPath(root),'utf8'),'status replacement');assert.equal(readFileSync(mailNoticeViewPath(root),'utf8'),'notice replacement');
 assert.deepEqual(readdirSync(root).sort(),['mail-notices.json','status.json']);assert.equal(resolutions,1);
 const outside=join(top,'outside');mkdirSync(outside);writeFileSync(join(outside,other+':2,'),'outside');
 const cur=join(root+'-moved','mail/archive/cur');renameSync(cur,cur+'-original');symlinkSync(outside,cur);
 const observed=publishedMailEntries(root,{directoryFd:fd});assert.notEqual(observed.unreadable,null);assert.deepEqual(observed.entries,[]);
 views.publishStatus({...snapshot,observedAtMs:snapshot.observedAtMs+1},[]);
 assert.equal(readFileSync(mailNoticeViewPath(root+'-moved'),'utf8'),notice,'unavailable publication evidence never becomes an empty successful projection');
 assert.equal(readFileSync(join(outside,other+':2,'),'utf8'),'outside');assert.equal(fstatSync(fd).isDirectory(),true);
});

test('002. Invalid state capability refuses status and notice publication before touching replacement bytes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-state-view-invalid-'))),file=join(root,'file');writeFileSync(file,'original');const fd=openSync(file,'r');
 t.after(()=>{closeSync(fd);removeOwnedTree(root);});writeFileSync(statusViewPath(root),'status');writeFileSync(mailNoticeViewPath(root),'notice');
 const views=new ViewsModule({},root,'demo','p',undefined,'legacy',{stateDirectory:()=>fd});
 assert.throws(()=>views.publishStatus({observedAtMs:Date.now(),units:new Map(),failure:'unavailable'},[]),{code:'STORE_CORRUPT'});
 assert.equal(readFileSync(statusViewPath(root),'utf8'),'status');assert.equal(readFileSync(mailNoticeViewPath(root),'utf8'),'notice');assert.equal(readFileSync(file,'utf8'),'original');
});
