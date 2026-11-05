/** Actual scoped installation observation; the ordinary controller is only a
 * path-selection comparison, never an execution or death fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionJournal} from '@oma/storage/execution-journal';
import {launchDarwinJobScope} from '@oma/platform-mac/job-scope';
import {observeMacDeveloperTools} from '@oma/platform-mac/developer-tools';
import {runProcessSync} from '@oma/process/run';
import {ExecutionRuntime} from '#oma-test/app/runtime/execution-runtime';
import {prepareResidentTools} from '#oma-test/app/runtime/resident-tools';

test('001. Actual Darwin owned scopes select Git inside the observed developer installation and return all staging',{timeout:45000},async t=>{
 if(process.platform!=='darwin')return assert.rejects(observeMacDeveloperTools('/unused',async()=>{throw Error('no fake Mac observation');}),{code:'UNSUPPORTED_PROFILE'});
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-scoped-developer-')));ExecutionJournal.initialize(root);
 const runtime=new ExecutionRuntime(root,launchDarwinJobScope);
 t.after(async()=>{await runtime.close();rmSync(root,{recursive:true});});
 await runtime.recover();let authorized=0;
 const tools=await prepareResidentTools(root,runtime,t.signal,()=>authorized++);assert.ok(authorized>=2);
 const ordinary=runProcessSync({executable:'/usr/bin/xcode-select',argv:['-p'],cwd:root,env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin'},
  timeoutMs:10000,stdoutBytes:8192,stderrBytes:8192});
 assert.equal(ordinary.kind,'exited');assert.equal(ordinary.exitCode,0,ordinary.stderr.toString());
 assert.equal(tools.developer,realpathSync(ordinary.stdout.toString().trim()));
 assert.equal(tools.git,realpathSync(tools.developer+'/usr/bin/git'));
 assert.ok(tools.execPath.startsWith(tools.developer+'/'));assert.equal(runtime.confirmDead('preparation'),true);
 assert.deepEqual(ExecutionJournal.inspect(root),[]);assert.deepEqual(readdirSync(join(root,'staging')),[]);
 // SOURCE57 retained only the closed error, not the xcrun result. This
 // diagnostic answers that missing observation in the same pruned producer;
 // its outcome cannot select a production tool or substitute a host spawn.
 const xcrun=await runtime.run('preparation',{executable:'/usr/bin/xcrun',argv:['--find','git'],cwd:root,
  env:{HOME:root,TMPDIR:root,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},timeoutMs:10000,stdoutBytes:8192,stderrBytes:8192},t.signal,()=>{});
 assert.equal(runtime.confirmDead('preparation'),true);assert.deepEqual(ExecutionJournal.inspect(root),[]);
 t.diagnostic(JSON.stringify({tools,xcrun:{...xcrun,stdout:xcrun.stdout.toString(),stderr:xcrun.stderr.toString()},completeScopeReturned:true}));
});
