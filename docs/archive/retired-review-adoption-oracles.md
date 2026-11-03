# Retired fresh-review-adoption test contracts

DR72/MCS-S13 removes fresh adoption execution. The original `IMP-R19` and two `AUD-01` adoption-positive test bodies below retain their original meaning: accepting adoption, preserving qualifying votes while changing scope, and retrying that changed scope. They are **not** passing collaboration-v1 no-adopt tests, migration proof, or original-release drain qualification.

Captured from the working source while correcting MCS-AUD-09, after test-only `Reflect.apply` made the now-retired inputs expressible without widening the public type. The preserved execution `review-retirement-current.log` reports those three original positive oracles as FAIL (`INVALID_REQUEST: unknown attestation kind`), not PASS. The current safety regressions use new DR72 test names and supported cancel/fresh-proposal flows; they must independently retain no-stale-CAS, original receipt/vote preservation, healthy admission, prepared-context identity, and explicit host-retry authority. This disposition follows the user's explicit removal decision; it does not relabel the historical requirements.

## Original positive oracles (reference only; not an executable compatibility layer)

```ts
test("AUD-01: a provenance adoption during the completion notice costs one retry, not corruption", { timeout: 60_000 }, async () => {
  const f = fixture();
  const gate = new AdmissionGate();
  bindAdmissionGate(f.store, gate);
  const noticeHeld = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let heldOnce = false;
  const freeze = f.mail.freezeReviewMessage.bind(f.mail);
  f.mail.freezeReviewMessage = async (...args) => {
    if (!heldOnce && args[3]?.review?.role === "notice") { heldOnce = true; noticeHeld.resolve(); await release.promise; }
    return freeze(...args);
  };
  let voting: Promise<Receipt> | undefined;
  try {
    const candidate = f.candidateWith({ "a.txt": "raced change\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    // The vote's record advances the request; its completion notice is frozen
    // while a co-author re-submits the same candidate (provenance changes) and
    // the requester adopts, bumping the attempt and superseding the notice.
    voting = f.vote("bob", name, "approve", "code checked", "bob-vote");
    await noticeHeld.promise;
    await f.submit("carol", candidate, "carol-submit");
    await Reflect.apply(f.reviews.record, f.reviews, [f.auth("alice"), "adopt", { kind: "review.adopt", name, reason: "current provenance" }]);
    release.resolve();
    if (voting === undefined) throw new Error("the vote never started");
    const receipt = await voting;
    assert.equal(receipt.state, "succeeded", "the record's own receipt stays what its transaction committed");
    const open = f.store.getOperation("alice", "open");
    assert.ok(open?.kind === "attest.record");
    // The retry accepted the attempt-1 row and read it back under that key.
    assert.equal(f.store.getOperation("alice", applyRequestKeyFor(open.id, 0)), null);
    const row = f.store.getOperation("alice", applyRequestKeyFor(open.id, 1));
    assert.ok(row?.kind === "git.integrate");
    assert.ok(row.plan.merge !== undefined && row.plan.merge.version !== 1);
    assert.equal(row.plan.merge.attemptNumber, 1);
    assert.equal(row.plan.candidate, candidate);
    assert.equal(row.state, "succeeded");
    const state = f.stateOf(name);
    assert.equal(state.attemptNumber, 1);
    assert.equal(state.display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    // The accepted race closed no fence: the module never judged it corrupt.
    assert.equal(gate.state, "healthy");
    const next = f.candidateWith({ "b.txt": "after the race\n" }, candidate);
    await f.submit("alice", next, "next-submit");
    const opened = await f.open("alice", { tier: "LOW", candidate: next, base: candidate }, "next-open");
    assert.equal(opened.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), next);
  } finally {
    release.resolve();
    await voting?.catch(() => { /* the assertions own the failure */ });
    f.close();
  }
});
test("AUD-01: a policy-revision adoption between preparation and apply needs the prepared context", { timeout: 60_000 }, async () => {
  let revision = "p1";
  const f = fixture({ reader: policy => ({ ...policy, policyRevision: revision }) });
  const gate = new AdmissionGate();
  bindAdmissionGate(f.store, gate);
  const preparationHeld = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let heldOnce = false;
  const materialize = f.mail.materialize.bind(f.mail);
  f.mail.materialize = async id => {
    const operation = f.store.getOperationById(id);
    if (!heldOnce && operation?.kind === "attest.record" && operation.plan.fact.kind === "review.integration") {
      heldOnce = true; preparationHeld.resolve(); await release.promise;
    }
    return materialize(id);
  };
  let voting: Promise<Receipt> | undefined;
  try {
    const candidate = f.candidateWith({ "a.txt": "policy change\n" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    // The vote's record prepares the integration context. While its row is
    // committed and publishing, the host's policy revision moves and the
    // requester adopts it -- the attempt the frozen build belonged to is gone.
    voting = f.vote("bob", name, "approve", "code checked", "bob-vote");
    await preparationHeld.promise;
    revision = "p2";
    await Reflect.apply(f.reviews.record, f.reviews, [f.auth("alice"), "adopt", { kind: "review.adopt", name, reason: "adopt the current policy" }]);
    release.resolve();
    await voting;
    const raced = f.stateOf(name);
    assert.equal(raced.attemptNumber, 1);
    assert.equal(raced.sourceIdentity.policyRevision, "p2");
    // Nothing was minted from the superseded scope and nothing was fenced.
    assert.equal(raced.integration, null);
    assert.equal(gate.state, "healthy");
    // The next sweep builds the adopted identity's prepared context, and the
    // accepted row names that context instead of a stale direct identity.
    await f.reviews.advanceAll();
    const prepared = f.stateOf(name).integration;
    assert.ok(prepared !== null);
    assert.equal(prepared.state, "pending");
    const row = f.store.getOperationById(prepared.operation);
    assert.ok(row?.kind === "git.integrate");
    assert.equal(row.plan.merge?.version, 3);
    assert.equal(row.plan.merge?.attemptNumber, 1);
    assert.equal(row.plan.policyRevision, "p2");
    await f.module.reconcile(row.id);
    assert.equal(f.stateOf(name).display, "applied");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), candidate);
    assert.equal(gate.state, "healthy");
    const next = f.candidateWith({ "b.txt": "after the race\n" }, candidate);
    await f.submit("alice", next, "next-submit");
    const opened = await f.open("alice", { tier: "LOW", candidate: next, base: candidate }, "next-open");
    assert.equal(opened.state, "succeeded");
    assert.equal(f.git(["rev-parse", "refs/heads/main"]), next);
  } finally {
    release.resolve();
    await voting?.catch(() => { /* the assertions own the failure */ });
    f.close();
  }
});
test("IMP-R19: policy adoption preserves qualified code votes but creates current policy authority; host retry is explicit",async()=>{
  let fail=true,revision="p1";
  const f=fixture({reader:p=>({...p,policyRevision:revision}),checks:[{id:"test",argv:["/bin/true"],env:{}}],runCheck:()=>{if(fail)throw new StoreError("CHECK_FAILED","fail");}});
  try{
    const c=f.candidateWith({a:"one"});await f.submit("alice",c,"c");await f.open("alice",{tier:"MEDIUM",candidate:c},"open");
    const name=f.requestName("open");await f.vote("bob",name,"approve","code checked","vote");
    revision="p2";
    // DR72: preserve this historical positive oracle as a visible conflict,
    // not a supported call signature or a PASS of current no-adopt behavior.
    await Reflect.apply(f.reviews.record,f.reviews,[f.auth(),"adopt",{kind:"review.adopt",name,reason:"use p2"}]);
    assert.equal(f.stateOf(name).sourceIdentity.policyRevision,"p2");assert.deepEqual(f.stateOf(name).approvers,["bob"]);
    await f.reviews.advanceAll();let state=f.stateOf(name);assert.ok(state.integration);
    await f.module.reconcile(state.integration.operation).catch(()=>{});state=f.stateOf(name);assert.equal(state.integration?.state,"failed");
    fail=false;
    await f.reviews.record({...f.auth("principal"),channel:"host"},"host-retry",{kind:"review.retry",name,expectedRevision:0,expectedAttempt:state.integration!.operation,reason:"retry repaired environment"});
    assert.equal(f.stateOf(name).display,"applied");
    await assert.rejects(f.reviews.record(f.auth("principal"),"actor-retry",{kind:"review.retry",name,expectedRevision:0,expectedAttempt:null,reason:"not host"}),/requester|authority|terminal|settled/);
  }finally{f.close();}
});
```
