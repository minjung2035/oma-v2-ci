import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestIdentity, requestParamsEqual } from "@oma/domain/request-identity";
import { LineageSnapshot } from "@oma/domain/lineage";

test("request identity preserves text bytes and normalizes only declared set fields", () => {
  const original = { to: ["bob", "alice"], subject: "subject", body: "e\u0301\n", kind: "message" };
  const identity = buildRequestIdentity("mail.send", original);
  assert.equal(identity.hash, buildRequestIdentity("mail.send", { ...original, to: ["alice", "bob", "alice"] }).hash);
  assert.equal(requestParamsEqual("mail.send", original, { ...original, body: "é\n" }), false);
  const bytes = Buffer.from(identity.canonicalBytes);
  original.body = "changed after freeze";
  original.to.push("carol");
  assert.deepEqual(Buffer.from(identity.canonicalBytes), bytes);
  assert.equal(identity.canonicalParams.body, "e\u0301\n");
});
test("lineage retains retired actors as facts and refuses cyclic ownership", () => {
  const graph = new LineageSnapshot([{ name: "principal", createdBy: null },
    { name: "alice", createdBy: "principal", desired: "retired" }, { name: "bob", createdBy: "alice" }]);
  assert.deepEqual(graph.ancestors("bob").map(node => node.name), ["bob", "alice", "principal"]);
  assert.throws(() => new LineageSnapshot([{ name: "alice", createdBy: "bob" }, { name: "bob", createdBy: "alice" }]), { code: "STORE_CORRUPT" });
});
