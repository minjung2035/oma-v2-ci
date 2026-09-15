import assert from "node:assert/strict";

/** A pending/unknown accepted request may need recovery; it may not acquire a new identity or plan. */
export async function requireSubmitConvergence<
  T extends { id: string; state: string; planJson: string },
>(
  id: string,
  read: () => T | null,
  reconcile: (id: string) => Promise<void>,
): Promise<T> {
  const accepted = read();
  assert.ok(
    accepted && accepted.id === id,
    "original accepted operation is missing",
  );
  assert.ok(
    ["pending", "unknown", "succeeded"].includes(accepted.state),
    "unexpected accepted state",
  );
  const plan = accepted.planJson;
  await reconcile(id);
  const settled = read();
  assert.ok(
    settled && settled.id === id,
    "recovery changed operation identity",
  );
  assert.equal(settled.planJson, plan, "recovery rewrote the frozen plan");
  assert.equal(settled.state, "succeeded", "accepted submit did not converge");
  return settled;
}
export interface RejectionObservation {
  timeout?: boolean;
  fatal?: string;
  replies?: Array<{ id?: string; ok?: boolean; error?: { code: string } }>;
}
/** No acceptance and responsive rejection are independent requirements. */
export function requireBoundedRejection(
  observed: RejectionObservation | undefined,
  code: string,
  id?: string,
): void {
  assert.ok(observed, "scenario returned no observation");
  assert.notEqual(
    observed.timeout,
    true,
    "timeout is not a protocol rejection",
  );
  assert.equal(
    observed.fatal,
    undefined,
    "driver failure is not a protocol rejection",
  );
  assert.ok(Array.isArray(observed.replies), "driver returned no reply array");
  assert.ok(
    observed.replies.every((reply) => reply.ok === false),
    "invalid scenario included a successful reply",
  );
  const replies = observed.replies.filter(
    (reply) => id === undefined || reply.id === id,
  );
  assert.equal(replies.length, 1, "expected exactly one correlated rejection");
  assert.equal(replies[0]?.ok, false, "invalid request received success");
  assert.equal(replies[0]?.error?.code, code);
}
