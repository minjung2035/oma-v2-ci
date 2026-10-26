// The product surface's structural boundaries — which closures may reach
// which modules, who writes, who talks to the broker, what the model-facing
// surfaces may say — are architecture rules now
// (scripts/architecture/rules/surface-rules.mjs). What remains here is
// behaviour: the method surface the broker actually dispatches.
import test from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_METHODS, INTERNAL_METHODS } from "@oma/protocol/methods";

test("T95/TUI-001: the product surface adds no wire or internal socket method", () => {
  // The closed method surface is the one the broker already dispatches. A TUI
  // that needed a new method would change these key sets.
  assert.deepEqual(Object.keys(PUBLIC_METHODS).sort(), [
    "agent.continue", "agent.create", "agent.start", "agent.stop", "agent.wait",
    "attest.record", "context.publish", "git.integrate", "git.known", "git.submit",
    "logs.read", "mail.ack", "mail.send", "operation.get", "operation.read", "review.status", "route.follow",
    "route.unfollow", "society.set", "status.get",
  ]);
  assert.deepEqual(Object.keys(INTERNAL_METHODS).sort(), [
    "batch.complete", "batch.prepare", "batch.read",
    "principal.attach", "principal.detach", "runner.observe", "runner.open", "runner.pending",
  ]);
});

