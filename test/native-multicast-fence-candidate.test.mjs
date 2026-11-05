/** Raw own-socket observations; passing this test adopts no lease candidate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
test('001. Actual own multicast socket compares kernel name and full filter identity through shutdown and descriptor lifetime',{timeout:90000},t=>{
 if(process.platform!=='darwin'){t.diagnostic('NOT_RUN: Darwin own-socket candidate');return;}
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-multicast-fence-'))),executable=join(root,'probe');
 t.after(()=>rmSync(root,{recursive:true}));
 const run=(program,argv)=>{const r=spawnSync(program,argv,{encoding:'utf8',timeout:30000});assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);return r;};
 run('/usr/bin/clang',['-Wall','-Wextra','-Werror',fileURLToPath(new URL('./fixtures/darwin-multicast-fence.c',import.meta.url)),'-o',executable]);
 run('/usr/bin/codesign',['--force','--sign','-',executable]);
 for(const mode of ['public','restricted']){
  const r=run(executable,[mode]),rows=r.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.at(-1).kind,'complete');t.diagnostic(JSON.stringify({mode,productionAdopted:false,rows,stderr:r.stderr}));
 }
});
