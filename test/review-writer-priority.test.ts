/** Scheduling admission only: controlled ledger, no physical Git or mail effects. */
import test from "node:test";
import assert from "node:assert/strict";
import { ReviewModule, type ReviewEffects } from "@oma/review";
import type { ReviewLedger, ReviewMail } from "@oma/review/ports";

const id = "op-00000000-0000-4000-8000-000000000001";
function owner(kind: string, state: string) {
  let operation: { id: string; kind: string; state: string } | null = { id, kind, state };
  let writers = 0;
  // Only these reads are exercised; the projection is intentionally empty.
  const ledger = {
    recoverableOperations: () => [id], getOperationById: () => operation,
    getOperation: () => null, attestationFacts: () => [], listAgents: () => [],
  } as unknown as ReviewLedger;
  const effects = {
    policy: () => null,
    withWriter: async <T>(work: () => Promise<T>): Promise<T> => { writers++; return work(); },
  } as ReviewEffects;
  const review = new ReviewModule(ledger, {} as ReviewMail, effects,
    { mailBodyBytes: 256 * 1024, subjectBytes: 512, bundleBytes: 256 * 1024 }, "demo");
  return { review, get writers() { return writers; }, settle() { operation = { id, kind, state: "succeeded" }; }, disappear() { operation = null; } };
}

for (const kind of ["git.integrate", "git.submit"])
  for (const state of ["pending", "unknown"])
    test(`001. Review writer priority: ${kind}/${state} yields without acquiring the writer`, async () => {
      const f = owner(kind, state);
      for (let i = 0; i < 6; i++) {
        await assert.rejects(f.review.advanceAll(), { code: "BROKER_UNAVAILABLE" });
        await assert.rejects(f.review.advance(id), { code: "BROKER_UNAVAILABLE" });
      }
      assert.equal(f.writers, 0, "even an empty sweep or direct advance must not compete with accepted project recovery");
      f.settle();
      await f.review.advanceAll(); await f.review.advance(id);
      assert.equal(f.writers, 2, "terminal rows must not leave a stale in-memory fence");
    });

for (const kind of ["context.publish", "mail.send", "agent.start"])
  test(`002. Review writer priority: unrelated ${kind} recovery does not suppress advancement`, async () => {
    const f = owner(kind, "pending");
    await f.review.advanceAll(); await f.review.advance(id);
    assert.equal(f.writers, 2);
  });

test("003. Review writer priority: a missing recoverable row remains corruption, not an idle success", async () => {
  const f = owner("git.integrate", "pending"); f.disappear();
  await assert.rejects(f.review.advanceAll(), { code: "STORE_CORRUPT" });
  await assert.rejects(f.review.advance(id), { code: "STORE_CORRUPT" });
  assert.equal(f.writers, 0);
});
