/** Transient installation grammar only; no OS observation or scope is supplied. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMacDeveloperTools,decodeMacDeveloperTools,encodeMacDeveloperTools,decodeMacDeveloperToolsHex} from '@oma/protocol/mac-developer-tools';
const developer='/Applications/한 글자 "Xcode".app/Contents/Developer';
const tools=()=>describeMacDeveloperTools(developer,`${developer}/usr/bin/git`,`${developer}/usr/libexec/git-core`);
const unsupported={code:'UNSUPPORTED_PROFILE'};
test('Mac developer launch data roundtrips exact UTF8 paths and both supported developer layouts',()=>{
  for(const root of [developer,'/Library/Developer/CommandLineTools']){
    const original=describeMacDeveloperTools(root,`${root}/usr/bin/git`,`${root}/usr/libexec/git-core`);
    const decoded=decodeMacDeveloperToolsHex(encodeMacDeveloperTools(original));
    assert.deepEqual(decoded,original);assert.ok(Object.isFrozen(decoded));
    assert.equal(decoded.contents,root.endsWith('/Developer')?root.slice(0,-'/Developer'.length):root);
  }
});
test('Mac developer launch data rejects extra fields, replaced Contents and escaped tool roots',()=>{
  const original=tools();
  for(const value of [null,[],{}, {...original,scope:'trusted'}, {...original,contents:'/Applications'},
    {...original,developer:'/Applications'}, {...original,git:'/usr/bin/git'},
    {...original,git:`${developer}/../git`}, {...original,execPath:'/human/helpers'},
    {...original,developer:developer+'\n'}, {...original,git:original.git+'\ud800'}])
    assert.throws(()=>decodeMacDeveloperTools(value),unsupported);
});
test('Mac developer launch data refuses malformed transport without replacing bytes',()=>{
  const valid=encodeMacDeveloperTools(tools());
  for(const value of [undefined,'',valid.toUpperCase(),valid+'0','zz','ff','7b',
    Buffer.from(JSON.stringify({...tools(),authority:true})).toString('hex'),'00'.repeat(32769)])
    assert.throws(()=>decodeMacDeveloperToolsHex(value),unsupported);
});
test('Mac developer launch data snapshots each field once before serialization',()=>{
  const original=tools(),reads=new Map(),changing={};
  for(const [key,value] of Object.entries(original))Object.defineProperty(changing,key,{enumerable:true,get(){
    reads.set(key,(reads.get(key)??0)+1);return reads.get(key)===1?value:'/changed';
  }});
  assert.deepEqual(decodeMacDeveloperToolsHex(encodeMacDeveloperTools(changing)),original);
  assert.deepEqual([...reads.values()],[1,1,1,1]);
});
