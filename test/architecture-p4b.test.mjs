import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,renameSync,symlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {searchWorkspace} from "@oma/tool-runtime/contained-search";
import {withSearchSnapshot,readResult} from "@oma/tool-files";

test("001. Ignored 32MiB payload is never copied; nested rules, hidden, negation, glob and explicit file retain rg semantics",async t=>{
  const root=mkdtempSync(join(tmpdir(),"oma-select-")),workspace=join(root,"workspace"),results=join(root,"results");
  t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(workspace);mkdirSync(results);mkdirSync(join(workspace,"nested"));
  const ignored=Buffer.alloc(32*1024*1024,120);writeFileSync(join(workspace,"large.bin"),ignored);
  writeFileSync(join(workspace,".gitignore"),"large.bin\nnested/*.txt\n!nested/keep.txt\n");
  writeFileSync(join(workspace,"nested/keep.txt"),"needle kept\n");writeFileSync(join(workspace,"nested/drop.txt"),"needle dropped\n");
  writeFileSync(join(workspace,"nested/.ignore"),"other.txt\n");writeFileSync(join(workspace,"nested/other.txt"),"needle other\n");
  writeFileSync(join(workspace,".한글"),"needle hidden\n");writeFileSync(join(workspace,"binary"),Buffer.from("\0needle binary\0"));
  const run=async params=>{const answer=await searchWorkspace("grep",workspace,params,undefined,undefined,{root:results});const meta=answer.details.result;assert.equal(meta.complete,true,JSON.stringify(meta));return {meta,text:readResult(results,meta.reference).text};};
  const normal=await run({pattern:"needle"});
  assert.match(normal.text,/needle kept/);assert.match(normal.text,/needle hidden/);assert.doesNotMatch(normal.text,/needle dropped|needle other/);
  assert.ok(normal.meta.selection.readBytes<1024,JSON.stringify(normal.meta.selection));
  console.log(JSON.stringify({event:"search.selection.measurement",ignoredBytes:ignored.length,...normal.meta.selection}));
  assert.match((await run({pattern:"needle",glob:"nested/*.txt"})).text,/needle dropped/);
  assert.equal((await run({pattern:"needle",path:"nested/drop.txt"})).text,"drop.txt:1: needle dropped\n");
  const find=await searchWorkspace("find",workspace,{pattern:"*.txt"},undefined,undefined,{root:results});
  assert.equal(find.details.result.complete,true,JSON.stringify(find.details));
  assert.match(readResult(results,find.details.result.reference).text,/keep.txt/);assert.doesNotMatch(readResult(results,find.details.result.reference).text,/drop.txt/);
});

for(const mutation of ["rename","symlink","ignore"])test(`002. Copy mutation: ${mutation} between selection and payload copy refuses`,async t=>{
  const root=mkdtempSync(join(tmpdir(),"oma-select-race-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,"file"),"allowed\n");writeFileSync(join(root,".ignore"),"other\n");
  const outside=join(tmpdir(),`oma-outside-${process.pid}-${mutation}`);writeFileSync(outside,"outside secret\n");t.after(()=>rmSync(outside,{force:true}));
  await assert.rejects(withSearchSnapshot(root,".",undefined,async()=>assert.fail("changed input used"),undefined,undefined,{
    select:async function*(){
      if(mutation==="rename"){renameSync(join(root,"file"),join(root,"old"));writeFileSync(join(root,"file"),"replacement\n");}
      if(mutation==="symlink"){rmSync(join(root,"file"));symlinkSync(outside,join(root,"file"));}
      if(mutation==="ignore")writeFileSync(join(root,".ignore"),"file\n");
      yield "file";
    }
  }),/changed|link|ELOOP/);
});
