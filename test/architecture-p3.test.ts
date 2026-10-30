import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures/review-fixture.js";
import { StoreError } from "@oma/domain/errors";
import { applyRequestKeyFor } from "@oma/domain/identifiers";
import { IntegrationPreparation, collectPreparedIntegrations } from "@oma/git/integration-preparation";
import { TreeLease } from "@oma/storage/tree-lease";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("IMP-R29: prepared-ref collection retains active, unknown and accepted ownership", async () => {
  const f = fixture();
  try {
    const a = f.candidateWith({ a: "one" }), b = f.candidateWith({ b: "two" });
    const id = `op-${randomUUID()}`, preparer = new IntegrationPreparation(f.projectGit, "demo");
    const prepared = await preparer.prepare(id, f.base, b, a, () => {});
    assert.ok(prepared.preparedRef);
    const leasePath = join(f.projectGit, "oma-preparations", id), held = TreeLease.take(leasePath);
    try {
      collectPreparedIntegrations(f.projectGit, () => null);
      assert.equal(f.git(["rev-parse", prepared.preparedRef]), prepared.candidate);
    } finally { held.release(); }
    assert.throws(() => collectPreparedIntegrations(f.projectGit, () => { throw new StoreError("BROKER_UNAVAILABLE", "ledger observation unknown"); }));
    assert.equal(f.git(["rev-parse", prepared.preparedRef]), prepared.candidate);
    collectPreparedIntegrations(f.projectGit, () => null);
    assert.equal(f.git(["for-each-ref", "--format=%(refname)", prepared.preparedRef]), "");
    assert.equal(existsSync(`${leasePath}.lease`), false);
    // An actually accepted prepared result remains reachable after startup GC.
    await f.submit("alice", a, "a"); await f.submit("bob", b, "b");
    await f.open("alice", { tier: "LOW", candidate: a }, "oa");
    await f.open("bob", { tier: "LOW", candidate: b }, "ob");
    const fact = f.stateOf(f.requestName("ob", "bob")).preparation!;
    assert.ok(fact.fact.preparedRef);
    const bytes = f.store.getOperationById(fact.operation)!.planJson;
    collectPreparedIntegrations(f.projectGit, id => f.store.getOperationById(id));
    assert.equal(f.git(["rev-parse", fact.fact.preparedRef]), fact.fact.identity.candidate);
    assert.equal(f.store.getOperationById(fact.operation)!.planJson, bytes);
  } finally { f.close(); }
});

test("IMP-R16: reviewed disjoint proposals from one base integrate in order without resubmission; challenge only actual delta", async () => {
  const checked: string[] = [];
  const f = fixture({checks:[{id:"test",argv:["/bin/true"],env:{}}],runCheck:c => {checked.push(c);}});
  try {
    const a = f.candidateWith({"a":"one"}), b = f.candidateWith({"b":"two"});
    await f.submit("alice",a,"a"); await f.submit("bob",b,"b");
    await f.open("alice",{tier:"MEDIUM",candidate:a},"oa"); await f.open("bob",{tier:"MEDIUM",candidate:b},"ob");
    const an=f.requestName("oa"),bn=f.requestName("ob","bob");
    await f.vote("carol",an,"approve","checked a","va");
    await f.vote("carol",bn,"approve","checked b","vb");
    const state=f.stateOf(bn), i=state.integration?.identity?.candidate;
    assert.equal(state.display,"applied"); assert.ok(i); assert.notEqual(i,b);
    assert.equal(f.git(["show",`${i}:a`]),"one"); assert.equal(f.git(["show",`${i}:b`]),"two");
    assert.deepEqual(f.git(["show","-s","--format=%P",i]).split(" "),[a,b]);
    assert.deepEqual(checked,[a,i]); assert.equal(state.preparation?.fact.context,false);
    f.reopen(); assert.equal(f.stateOf(bn).display,"applied");
    await f.challenge("dave",{merge:bn,tier:"LOW"},"undo");
    const undo=f.requestName("undo","dave");
    await f.vote("alice",undo,"approve","only b","u1"); await f.vote("carol",undo,"approve","only b","u2");
    assert.equal(f.stateOf(undo).display,"applied");
    assert.equal(f.git(["ls-tree","--name-only","main"]),"a");
  } finally {f.close();}
});

test("IMP-R17: individual changes pass but combined invariant fails on prepared I", async () => {
  let f: ReturnType<typeof fixture>;
  f=fixture({checks:[{id:"invariant",argv:["/bin/true"],env:{}}],runCheck:c => {
    if (f.git(["ls-tree","--name-only",c]).split("\n").length > 1) throw new StoreError("CHECK_FAILED","a and b cannot coexist");
  }});
  try {
    const a=f.candidateWith({a:"one"}),b=f.candidateWith({b:"two"});
    await f.submit("alice",a,"a");await f.submit("bob",b,"b");
    await f.open("alice",{tier:"LOW",candidate:a},"oa");
    await f.open("bob",{tier:"LOW",candidate:b},"ob");
    const state=f.stateOf(f.requestName("ob","bob"));
    assert.equal(state.integration?.state,"failed");assert.equal(state.integration?.errorCode,"CHECK_FAILED");
    assert.equal(f.git(["rev-parse","main"]),a);assert.notEqual(state.integration?.identity?.candidate,b);
    const count=f.store.attestations.all().length;await f.reviews.advanceAll();assert.equal(f.store.attestations.all().length,count);
  } finally {f.close();}
});

test("IMP-R18: clean overlapping LOW changes require exact MEDIUM integration-context vote", async () => {
  const f=fixture();
  try {
    const lines=Array.from({length:30},(_,i)=>`line ${i}`);
    const base=f.candidateWith({file:lines.join("\n")+"\n"}); f.git(["update-ref","refs/heads/main",base]);
    const left=[...lines],right=[...lines];left[1]="left";right[28]="right";
    const a=f.candidateWith({file:left.join("\n")+"\n"},base),b=f.candidateWith({file:right.join("\n")+"\n"},base);
    await f.submit("alice",a,"a");await f.submit("bob",b,"b");
    await f.open("alice",{tier:"LOW",candidate:a,base},"oa");await f.open("bob",{tier:"LOW",candidate:b,base},"ob");
    const name=f.requestName("ob","bob"), waiting=f.stateOf(name);
    assert.equal(waiting.tier,"MEDIUM");assert.equal(waiting.scope,waiting.preparation?.operation);assert.equal(waiting.integration,null);
    assert.equal(f.git(["rev-parse","main"]),a);assert.equal(waiting.proposalReady,true);
    await f.vote("carol",name,"approve","checked exact M/I","context");
    assert.equal(f.stateOf(name).display,"applied");
    const vote=f.store.getOperation("carol","context");assert.equal(vote?.kind,"attest.record");
    if(vote?.kind === "attest.record" && vote.plan.fact.kind === "vote") {assert.equal(vote.plan.fact.version,3);if(vote.plan.fact.version===3) assert.equal(vote.plan.fact.scope,waiting.scope);}
  } finally {f.close();}
});

test("IMP-R19: revision preserves old failure bytes, resets code approval and races expectedRevision", async () => {
  let fail=true;
  const f=fixture({checks:[{id:"test",argv:["/bin/true"],env:{}}],runCheck:()=>{if(fail)throw new StoreError("CHECK_FAILED","first");}});
  try {
    const a=f.candidateWith({a:"one"});await f.submit("alice",a,"a");await f.open("alice",{tier:"MEDIUM",candidate:a},"oa");
    const name=f.requestName("oa");await f.vote("bob",name,"approve","old approval","vote");
    const old=f.applyOp("alice","oa")!;const bytes=old.planJson;
    const b=f.candidateWith({a:"fixed"});await f.submit("alice",b,"b");fail=false;
    const input={kind:"review.revise" as const,name,expectedRevision:0,base:f.base,candidate:b,reason:"fix check"};
    await f.reviews.record(f.auth(),"revise",input);
    assert.equal(f.stateOf(name).revision,1);assert.equal(f.stateOf(name).ready,false);assert.equal(f.stateOf(name).approvers.length,0);
    await assert.rejects(f.reviews.record(f.auth(),"race",input),/expectedRevision/);
    await f.vote("bob",name,"approve","new approval","vote2");assert.equal(f.stateOf(name).display,"applied");
    assert.equal(f.store.getOperationById(old.id)?.planJson,bytes);assert.equal(f.store.getOperationById(old.id)?.state,"failed");
  } finally {f.close();}
});

test("IMP-R20: known main movement before CAS supersedes only the attempt and automatically prepares again", async () => {
  let move=true;let f:ReturnType<typeof fixture>;let other="";
  f=fixture({checks:[{id:"test",argv:["/bin/true"],env:{}}],runCheck:()=>{if(move){move=false;f.git(["update-ref","refs/heads/main",other]);}}});
  try {
    other=f.candidateWith({other:"one"});const c=f.candidateWith({mine:"two"});await f.submit("alice",c,"c");
    await f.open("alice",{tier:"LOW",candidate:c},"open");const name=f.requestName("open"),first=f.stateOf(name);
    assert.equal(first.integration?.state,"failed");assert.equal(first.integration?.errorCode,"STALE_BASE");
    await f.reviews.advanceAll();const next=f.stateOf(name);assert.equal(next.attemptNumber,1);
    const op=f.store.getOperation("alice",applyRequestKeyFor(next.request,1));assert.ok(op);
    await f.module.reconcile(op.id);assert.equal(f.stateOf(name).display,"applied");
    assert.deepEqual(f.git(["ls-tree","--name-only","main"]).split("\n"),["mine","other"]);
  } finally {f.close();}
});

test("IMP-R21: already-included is a separate fact with no integration receipt",async()=>{
  const f=fixture();try{
    const c=f.candidateWith({a:"one"});await f.submit("alice",c,"c");f.git(["update-ref","refs/heads/main",c]);
    await f.open("alice",{tier:"LOW",candidate:c},"open");const state=f.stateOf(f.requestName("open"));
    assert.equal(state.display,"already-included");assert.equal(state.integration,null);assert.equal(state.included?.main,c);
    f.reopen();assert.equal(f.stateOf(state.name).display,"already-included");
  }finally{f.close();}
});

test("IMP-R19: policy adoption preserves qualified code votes but creates current policy authority; host retry is explicit",async()=>{
  let fail=true,revision="p1";
  const f=fixture({reader:p=>({...p,policyRevision:revision}),checks:[{id:"test",argv:["/bin/true"],env:{}}],runCheck:()=>{if(fail)throw new StoreError("CHECK_FAILED","fail");}});
  try{
    const c=f.candidateWith({a:"one"});await f.submit("alice",c,"c");await f.open("alice",{tier:"MEDIUM",candidate:c},"open");
    const name=f.requestName("open");await f.vote("bob",name,"approve","code checked","vote");
    revision="p2";
    await f.reviews.record(f.auth(),"adopt",{kind:"review.adopt",name,reason:"use p2"});
    assert.equal(f.stateOf(name).sourceIdentity.policyRevision,"p2");assert.deepEqual(f.stateOf(name).approvers,["bob"]);
    await f.reviews.advanceAll();let state=f.stateOf(name);assert.ok(state.integration);
    await f.module.reconcile(state.integration.operation).catch(()=>{});state=f.stateOf(name);assert.equal(state.integration?.state,"failed");
    fail=false;
    await f.reviews.record({...f.auth("principal"),channel:"host"},"host-retry",{kind:"review.retry",name,expectedRevision:0,expectedAttempt:state.integration!.operation,reason:"retry repaired environment"});
    assert.equal(f.stateOf(name).display,"applied");
    await assert.rejects(f.reviews.record(f.auth("principal"),"actor-retry",{kind:"review.retry",name,expectedRevision:0,expectedAttempt:null,reason:"not host"}),/requester|authority|terminal|settled/);
  }finally{f.close();}
});

test("IMP-R18: conflict stays blocked without repeated preparation and explicit revision resolves it",async()=>{
  const f=fixture();try{
    const a=f.candidateWith({same:"left"}),b=f.candidateWith({same:"right"});await f.submit("alice",a,"a");await f.submit("bob",b,"b");
    await f.open("alice",{tier:"LOW",candidate:a},"oa");await f.open("bob",{tier:"LOW",candidate:b},"ob");
    const name=f.requestName("ob","bob"), blocked=f.stateOf(name);assert.equal(blocked.display,"blocked");assert.match(blocked.preparationFailure!.reason,/conflict.*same/);
    const count=f.store.attestations.all().length;await f.reviews.advanceAll();await f.reviews.advanceAll();assert.equal(f.store.attestations.all().length,count);
    const fixed=f.candidateWith({same:"both"},a);await f.submit("bob",fixed,"fixed");
    await f.reviews.record(f.auth("bob"),"revise",{kind:"review.revise",name,expectedRevision:0,base:a,candidate:fixed,reason:"resolve conflict"});
    assert.equal(f.stateOf(name).display,"applied");assert.equal(f.git(["show","main:same"]),"both");
  }finally{f.close();}
});


test("IMP-R26: only completed approved CAS links prove a later main, arbitrary ancestry does not", async()=>{
  const {IntegrationPublicationObserver}=await import("@oma/git/integration-publication");
  const f=fixture();try{
    const a=f.candidateWith({a:"one"});await f.submit("alice",a,"a");await f.open("alice",{tier:"LOW",candidate:a},"oa");
    const b=f.candidateWith({a:"one",b:"two"},a);await f.submit("alice",b,"b");await f.open("alice",{tier:"LOW",candidate:b,base:a},"ob");
    const earlier=f.applyOp("alice","oa")!; assert.ok(earlier.kind === "git.integrate");
    const observer=new IntegrationPublicationObserver({main:()=>({kind:"present",value:f.git(["rev-parse","main"]),evidence:{status:0,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}}),
      ancestry:(base,candidate)=>({kind:"present",value:f.git(["merge-base",base,candidate])===base,evidence:{status:0,signal:null,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}})},f.store);
    assert.equal(f.store.findSucceededIntegration(b)?.plan.base,a);
    assert.equal(observer.applied(a,b),true);
    assert.ok(observer.integration({...earlier,state:"unknown",result:null,resultJson:null,errorCode:null}));
    const unapproved=f.candidateWith({a:"one",b:"two",outside:"manual"},b);
    f.git(["update-ref","refs/heads/main",unapproved]);
    assert.equal(observer.applied(a,unapproved),false);
    assert.throws(()=>observer.integration({...earlier,state:"unknown",result:null,resultJson:null,errorCode:null}),{code:"REF_STATE_UNKNOWN"});
  }finally{f.close();}
});

test("IMP-R27: an included proposal needs no additional peer vote and creates no success receipt",async()=>{
  const f=fixture();try{
    const candidate=f.candidateWith({included:"already"});await f.submit("alice",candidate,"candidate");
    await f.open("alice",{tier:"HIGH",candidate},"open");const name=f.requestName("open");
    f.git(["update-ref","refs/heads/main",candidate]);await f.reviews.advanceAll();
    assert.equal(f.stateOf(name).included?.candidate,candidate);assert.equal(f.stateOf(name).integration,null);
    assert.equal(f.stateOf(name).display,"already-included");
  }finally{f.close();}
});


test("IMP-R28: HIGH context requires fresh peer and Principal decisions bound to actual M/I",async()=>{
  const f=fixture();try{
    const lines=Array.from({length:30},(_,i)=>`line ${i}`),base=f.candidateWith({file:lines.join("\n")+"\n"});
    f.git(["update-ref","refs/heads/main",base]);const left=[...lines],right=[...lines];left[1]="left";right[28]="right";
    const a=f.candidateWith({file:left.join("\n")+"\n"},base),b=f.candidateWith({file:right.join("\n")+"\n"},base);
    await f.submit("alice",a,"a");await f.submit("bob",b,"b");await f.open("alice",{tier:"LOW",candidate:a,base},"oa");
    await f.open("bob",{tier:"HIGH",candidate:b,base},"ob");const name=f.requestName("ob","bob");
    await f.vote("alice",name,"approve","source","s1");await f.vote("carol",name,"approve","source","s2");
    const sourceApproval=f.stateOf(name).approval!;assert.ok(sourceApproval);
    await f.vote("principal",name,"approve","source decision","sp",sourceApproval.id);
    const context=f.stateOf(name);assert.ok(context.scope);assert.equal(context.integration,null);assert.equal(context.approvers.length,0);
    await f.vote("alice",name,"approve","actual delta","c1");await f.vote("carol",name,"approve","actual delta","c2");
    const approval=f.stateOf(name).approval!;assert.notEqual(approval.id,sourceApproval.id);
    await assert.rejects(f.vote("principal",name,"approve","stale decision","wrong",sourceApproval.id));
    await f.vote("principal",name,"approve","actual integration","cp",approval.id);
    assert.equal(f.stateOf(name).display,"applied");assert.equal(f.stateOf(name).integration?.identity?.expectedBase,a);
  }finally{f.close();}
});

for (const point of ["before", "after"] as const)
  test(`IMP-R30: SIGKILL ${point} prepared-integration CAS preserves exact M/I and accepted bytes`, { timeout: 30_000 }, async () => {
    const f = fixture();
    try {
      const a = f.candidateWith({ a: "one" }), b = f.candidateWith({ b: "two" });
      await f.submit("alice", a, "a"); await f.submit("bob", b, "b");
      await f.open("alice", { tier: "LOW", candidate: a }, "oa");
      await f.open("bob", { tier: "MEDIUM", candidate: b }, "ob");
      const name = f.requestName("ob", "bob");
      const script = `
        import { Store } from '@oma/storage';
        import { createMailModule } from '#oma-test/app/broker/mail-composition';
        import { createGitServices } from '#oma-test/app/broker/git-composition';
        import { ALL_CAPS } from './dist/test/fixtures/spec.js';
        const root = process.argv[1];
        const store = new Store(root + '/runtime.sqlite', 0, {society:'demo'});
        const paths = {stateRoot:root, society:'demo', projectGit:root+'/repos/project.git', contextGit:root+'/context.git', worldDir:root+'/world'};
        const policy = ${JSON.stringify(f.policy)};
        const {git, reviews} = createGitServices(paths, store, createMailModule(paths,store,64),policy,()=>policy,null,
          {mailBodyBytes:262144,subjectBytes:512,bundleBytes:262144});
        const effects = Reflect.get(Reflect.get(git,'integrationCoordinator'),'effects');
        const original = effects.compareAndSwap.bind(effects);
        effects.compareAndSwap = (...args) => {
          if (${JSON.stringify(point)} === 'before') process.kill(process.pid,'SIGKILL');
          const result = original(...args);
          if (result.kind !== 'candidate') throw new Error('CAS not confirmed: '+result.kind);
          process.kill(process.pid,'SIGKILL');
          return result;
        };
        await reviews.record({actor:'carol',role:'resident',incarnation:1,channel:'actor',capabilities:new Set(ALL_CAPS),
          peer:{pid:process.pid,uid:process.getuid(),gid:process.getgid()}},'peer',
          {kind:'vote',name:${JSON.stringify(name)},verdict:'approve',body:'reviewed both exact identities'});
        process.exitCode=99;
      `;
      const killed = spawnSync(process.execPath, ["--input-type=module", "-e", script, f.root], { encoding: "utf8", timeout: 15_000 });
      assert.equal(killed.signal, "SIGKILL", killed.stderr);
      f.reopen();
      const accepted = f.applyOp("bob", "ob");
      assert.ok(accepted?.kind === "git.integrate");
      assert.equal(accepted.state, "pending");
      assert.equal(accepted.plan.merge?.version, 3);
      assert.equal(accepted.plan.base, a);
      assert.notEqual(accepted.plan.candidate, b);
      const bytes = accepted.planJson;
      const effects = Reflect.get(Reflect.get(f.module, "integrationCoordinator"), "effects");
      const original = effects.compareAndSwap.bind(effects); let calls = 0;
      effects.compareAndSwap = (...args: unknown[]) => { calls++; return original(...args); };
      await f.module.reconcile(accepted.id);
      const settled = f.store.getOperationById(accepted.id)!;
      assert.equal(settled.state, "succeeded");
      assert.equal(settled.planJson, bytes);
      assert.equal(f.git(["rev-parse", "refs/heads/main"]), accepted.plan.candidate);
      assert.equal(calls, point === "before" ? 1 : 0);
      const receipt = JSON.stringify(settled.result);
      await f.module.reconcile(accepted.id);
      assert.equal(JSON.stringify(f.store.getOperationById(accepted.id)!.result), receipt);
      assert.equal(calls, point === "before" ? 1 : 0);
    } finally { f.close(); }
  });


test("IMP-R31: normal merge ancestry carries a binary edit across a rename and requires exact-context review", async () => {
  const f = fixture();
  try {
    const original = "old\0" + "payload".repeat(100), changed = "new\0" + "payload".repeat(100);
    const base = f.candidateWith({ "old.bin": original });
    f.git(["update-ref", "refs/heads/main", base, f.base]);
    const a = f.candidateWith({ "old.bin": changed }, base);
    const b = f.candidateWith({ "renamed.bin": original }, base);
    await f.submit("alice", a, "a"); await f.submit("bob", b, "b");
    await f.open("alice", { tier: "LOW", base, candidate: a }, "oa");
    await f.open("bob", { tier: "LOW", base, candidate: b }, "ob");
    const name = f.requestName("ob", "bob"), state = f.stateOf(name);
    assert.equal(state.preparation!.fact.context, true);
    const result = state.preparation!.fact.identity.candidate;
    assert.equal(f.git(["rev-parse", `${result}:renamed.bin`]), f.git(["hash-object", "--stdin"], changed));
    assert.equal(f.git(["rev-parse", `${b}:renamed.bin`]), f.git(["hash-object", "--stdin"], original));
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), a);
    await f.vote("carol", name, "approve", "reviewed binary rename result", "context");
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), result);
  } finally { f.close(); }
});
