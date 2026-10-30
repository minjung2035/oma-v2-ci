import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/review-fixture.js";
import { ProvenanceIndex } from "@oma/git/provenance-index";
import { canonicalPublishedRefs, canonicalCommitGraph, canonicalCommitRange } from "@oma/git/canonical-command";
import type { OperationOf } from "@oma/protocol/operation-codec";

test("IMP-R22/R23: native batch index matches historical oracle at 1/8/32/128 submissions; warm calls stay two",async()=>{
  const f=fixture();try{
    let calls=0;const observations={refs:()=>{calls++;return canonicalPublishedRefs(f.projectGit);},graph:(tips:readonly string[])=>{calls++;return canonicalCommitGraph(f.projectGit,tips);},range:(b:string,c:string)=>{calls++;return canonicalCommitRange(f.projectGit,b,c);}};
    const index=new ProvenanceIndex(observations);let tip=f.base,target="";
    const counts=[];
    for(let n=1;n<=128;n++){
      tip=f.candidateWith({a:String(n)},tip);if(n===1)target=tip;
      await f.submit(["alice","bob","carol","dave"][n%4]!,tip,`s${n}`);
      if(![1,8,32,128].includes(n))continue;
      const rows=f.store.operations.submissions();
      const changed=new Set(f.git(["rev-list",`${f.base}..${target}`]).split("\n"));
      const oracle=[...new Set(rows.filter(row=>row.plan.candidate === target || f.git(["rev-list",`${f.base}..${row.plan.candidate}`]).split("\n").some(c=>changed.has(c))).map(r=>r.actor))].sort();
      assert.deepEqual(index.authors(f.base,target,rows),oracle);
      const cold=calls;assert.deepEqual(index.authors(f.base,target,rows),oracle);assert.equal(calls-cold,2);
      counts.push({submissions:n,warmProcesses:calls-cold,actors:oracle});
      assert.deepEqual(new ProvenanceIndex(observations).authors(f.base,target,rows),oracle,"restart rebuild is exact");
    }
    console.log(JSON.stringify({event:"provenance.batch.measurement",counts,metrics:index.metrics}));
    const row=f.store.operations.submissions()[0]!;
    f.git(["update-ref",row.plan.publishedRef,f.base]);
    assert.throws(()=>index.authors(f.base,target,f.store.operations.submissions()),/changed identity/);
    f.git(["update-ref","-d",row.plan.publishedRef]);
    assert.throws(()=>index.authors(f.base,target,[row]),/changed identity/);
    const pending={...row,state:"pending",result:null,errorCode:null} as OperationOf<"git.submit">;
    assert.deepEqual(index.authors(f.base,target,[pending]),[]);
    const failed={...row,state:"failed",result:null,errorCode:"CHECK_FAILED"} as OperationOf<"git.submit">;
    assert.deepEqual(index.authors(f.base,target,[failed]),[]);
  }finally{f.close();}
});
