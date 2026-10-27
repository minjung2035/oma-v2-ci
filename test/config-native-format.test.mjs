/** Current configuration format only. Historical host config bytes are refused
 * without rewriting their file/history; accepted workflow formats stay separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,lstatSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {defaultHostConfig} from '@oma/config/defaults';
import {validateConfig,loadConfig} from '@oma/config';
import {readSettingsForEditing,projectBundle} from '#oma-test/app/application/settings';
import {HOST_CONFIGURATION_VERSION} from '@oma/domain/config-format';
const fresh=()=>defaultHostConfig({society:'demo',node:process.execPath,libdir:process.cwd(),deploymentDigest:'a'.repeat(64)});
test('native config version4 has no Linux rootfs, bind list or caller-selected backend',()=>{
  assert.equal(HOST_CONFIGURATION_VERSION,4);const current=fresh();assert.equal(current.schemaVersion,4);
  assert.deepEqual(Object.keys(current.installation).sort(),['deploymentDigest','libdir','node']);
  assert.equal(validateConfig(current).schemaVersion,4);
  for(const fields of [{rootfs:'/legacy/rootfs'},{systemBinds:['/usr']},{backend:'darwin'}])
    assert.throws(()=>validateConfig({...current,installation:{...current.installation,...fields}}));
});
test('native config refuses previous or unknown versions even after Linux fields are removed',()=>{
  const current=fresh();for(const schemaVersion of [0,1,2,3,5,'4',null])
    assert.throws(()=>validateConfig({...current,schemaVersion}),{code:"INVALID_REQUEST",message:/unsupported development configuration schema; expected 4/});
});
test('native config refuses version3 and preserves actual file, history sidecars and primary bytes',()=>{
  const root=mkdtempSync(join(tmpdir(),'oma-old-config-preserved-'));
  try{
    const path=join(root,'config.json'),history=join(root,'.oma-config');mkdirSync(history);
    const old={...fresh(),schemaVersion:3};old.installation={...old.installation,rootfs:'/preserved/vm/rootfs'};
    const bytes=JSON.stringify(old,null,2)+'\n',sidecar='historical configuration journal bytes\n';
    writeFileSync(path,bytes);writeFileSync(join(history,'committed-v2'),sidecar);writeFileSync(join(root,'primary'),'accepted primary bytes');
    const before=lstatSync(path,{bigint:true});for(const reader of [loadConfig,readSettingsForEditing,projectBundle])
      assert.throws(()=>reader(path),{code:"INVALID_REQUEST",message:/unsupported development configuration schema; expected 4/});const after=lstatSync(path,{bigint:true});
    assert.equal(readFileSync(path,'utf8'),bytes);assert.equal(readFileSync(join(history,'committed-v2'),'utf8'),sidecar);
    assert.equal(readFileSync(join(root,'primary'),'utf8'),'accepted primary bytes');
    for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],key);
    assert.deepEqual(readdirSync(history),['committed-v2']);assert.deepEqual(readdirSync(root).sort(),['.oma-config','config.json','primary']);
  }finally{rmSync(root,{recursive:true,force:true});}
});
