/** Real Git/Store/Mail/Review owners; injected interruption, no provider or sandbox. */
import test from "node:test";
import assert from "node:assert/strict";
import { ReconcileModule } from "@oma/reconcile";
import { StoreError } from "@oma/domain/errors";
import { fixture } from "./fixtures/review-fixture.js";

for (const interruption of ["before-apply", "after-cas"] as const)
  test(`001. Recovery writer progress: ${interruption} settles the accepted integration despite review pulses`, async t => {
    const f = fixture({ workers: ["alice", "bob"] });
    try {
      const publish = f.mail.publishGated.bind(f.mail);
      const stopped = interruption === "before-apply"
        ? t.mock.method(f.module, "applyMerge", async () => {})
        : t.mock.method(f.mail, "publishGated", async (...args: Parameters<typeof publish>) => {
          if (f.store.getOperationById(args[0])?.kind === "git.integrate")
            throw new StoreError("BROKER_UNAVAILABLE", "injected notice publication interruption");
          await publish(...args);
        });
      const candidate = f.candidateWith({ "one.txt": "recover this exact accepted tree\n" });
      await f.submit("alice", candidate);
      await f.open("alice", { tier: "LOW", candidate }, "open");
      stopped.mock.restore();
      const accepted = f.applyOp("alice", "open");
      assert.ok(accepted?.kind === "git.integrate");
      assert.equal(accepted.state, "pending");
      assert.equal(f.git(["rev-parse", "main"]), interruption === "before-apply" ? f.base : accepted.plan.candidate);
      const plan = accepted.planJson;
      let recoveries = 0;
      const recover = f.module.reconcile.bind(f.module);
      t.mock.method(f.module, "reconcile", async (id: string) => { recoveries++; await recover(id); });
      const idle = { activeState: "active", subState: "running", invocationId: "test", result: "success", execMainStatus: 0, scope: "test" };
      const owner = new ReconcileModule(f.store, f.mail, f.module, f.reviews, {
        observeAsync: async () => idle, observe: () => idle, confirmDead: () => false,
        stop: () => { throw new Error("must not stop an unrelated Worker"); },
        start: () => { throw new Error("must not start an unrelated Worker"); }, startLimitStatus: () => null,
      }, {
        reconcileSociety: async () => {}, reconcileCreate: async () => {}, reconcileAction: async () => {},
      }, { stateRoot: f.root, hasGoal: () => true, activationAllowed: () => true }, {
        observeStoreFailure: error => { throw error; }, quiesceResidents: () => {},
        collectUnacceptedArtifacts: () => ({ removed: [], kept: [] }),
        canonicalMain: () => { throw new Error("startup-only observation must not run in a sweep"); },
        assertCanonicalHealthy: async () => {}, pendingWork: () => new Set(),
      });
      try {
        const counts = await owner.sweep();
        assert.deepEqual(counts, { examined: 1, repaired: 1, remaining: 0 }, "review advancement must yield the project writer to accepted recovery");
        for (let i = 0; i < 6; i++) { owner.pulse(); await owner.sweep(); }
        assert.equal(recoveries, 1, "a settled integration must not be physically recovered again");
        assert.equal(f.store.getOperationById(accepted.id)?.state, "succeeded");
        assert.equal(f.store.getOperationById(accepted.id)?.planJson, plan, "recovery must preserve the accepted plan");
        assert.equal(f.git(["rev-parse", "main"]), accepted.plan.candidate);
        assert.equal(f.applyOp("alice", "open")?.id, accepted.id, "no replacement integration or request key");
      } finally { await owner.quiesceForShutdown(); }
    } finally { f.close(); }
  });
