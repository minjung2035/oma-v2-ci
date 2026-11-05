/** Dedicated setup cwd mutation is tested in a child; the application host's
 * cwd must remain unchanged through both a replaced name and a refusal. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {closeSync,mkdirSync,mkdtempSync,openSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('001. Dedicated setup enters its held directory after replacement and refreshes Node cwd without changing its host',{timeout:10000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'oma-setup-directory-'))),original=join(root,'original'),replacement=join(root,'replacement'),moved=join(root,'moved');
 for(const path of[original,replacement])mkdirSync(path);
 writeFileSync(join(original,'canary'),'original');writeFileSync(join(replacement,'canary'),'replacement');
 const fd=openSync(original,'r'),before=process.cwd();let child;
 t.after(()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');closeSync(fd);rmSync(root,{recursive:true});});
 const script=`import{enterDirectory}from ${JSON.stringify(import.meta.resolve('@oma/native/files'))};
import{readFileSync,closeSync}from'node:fs';process.cwd();process.stdout.write('ready\\n');readFileSync(0);enterDirectory(3);closeSync(3);
console.log(JSON.stringify({cwd:process.cwd(),canary:readFileSync('canary','utf8')}));`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['pipe','pipe','pipe',fd]});
 let stdout='',stderr='';const complete=once(child,'close');child.stdout.on('data',b=>{stdout+=b;if(stdout==='ready\n'){
  renameSync(original,moved);renameSync(replacement,original);child.stdin.end('release');}});child.stderr.on('data',b=>stderr+=b);
 const[code,signal]=await complete;assert.equal(signal,null,stderr);assert.equal(code,0,stderr);
 assert.deepEqual(JSON.parse(stdout.slice(stdout.indexOf('\n')+1)),{cwd:moved,canary:'original'});
 assert.equal(readFileSync(join(original,'canary'),'utf8'),'replacement');assert.equal(process.cwd(),before);
});
