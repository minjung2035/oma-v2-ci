import assert from "node:assert/strict";
import test from "node:test";
import { approvalBodyText, threadHeadText } from "@oma/domain/review-bounds";
import { collaborationArguments } from "@oma/domain/collaboration-inputs";

test("001. Fresh review mail uses the current exact-target decision interface", () => {
  const fact = { kind: "merge.open", version: 3, name: "merge-example", title: "Change", reason: "Evidence", tier: "HIGH",
    identity: { expectedBase: "a".repeat(40), candidate: "b".repeat(40), policyRevision: "p1" } };
  for (const text of [threadHeadText(fact, "alice", "peer-needed"), approvalBodyText("approval-id", fact, "alice", [], null)]) {
    assert.doesNotMatch(text, /oma_review_(?:status|diff|respond)/);
    assert.match(text, /record_root/);
    const call = /oma_review\((\{[^\n]*\})\)/.exec(text);
    assert.ok(call, "mail contains an actionable current review example");
    const args = JSON.parse(call[1]);
    assert.doesNotThrow(() => collaborationArguments("oma_review", args));
    assert.equal(args.decision, "approve");
    assert.match(args.target, /exact/);
  }
});
