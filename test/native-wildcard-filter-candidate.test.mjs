/** Wildcard exclusivity and full-width frozen metadata are separate questions
 * from the rejected multicast-address namespace. No product lease is enabled. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('001. Actual wildcard socket compares frozen full-width metadata, exact contenders, duplicate and last close',t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin wildcard/filter composition');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-wildcard-filter-'))),probe=join(root,'probe');
 t.after(()=>rmSync(root,{recursive:true}));
 const run=(command,args)=>{const r=spawnSync(command,args,{encoding:'utf8',timeout:30000});
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;};
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-wildcard-filter.c',import.meta.url)),'-o',probe]);
 run('/usr/bin/codesign',['--force','--sign','-',probe]);
 const observations=run(probe,[]).stdout.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(observations.at(-1).kind,'complete');
 t.diagnostic(JSON.stringify({productionAdopted:false,observations}));
});
