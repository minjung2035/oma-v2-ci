import test from "node:test";
import assert from "node:assert/strict";
import { inventoryClauses, indexTrace, applyOwnerLinks, inventoryAcceptance } from "../scripts/traceability.mjs";

const entries = () => inventoryClauses([{ source: "spec.md", text: "**MUST [RULE-001]** Keep the accepted identity.\n" }]);
function reviewed() {
  return { ...entries()[0], applicability: "runtime", status: "proven", rationale: "synthetic structural-test fixture only",
    owner: "src/owner.ts#effect", entrypoint: "src/entry.ts#main",
    callPath: ["src/entry.ts#main", "src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"],
    evidence: { synthetic: true, description: "not production execution evidence" } };
}
const link = () => ({ source: "spec.md", requirements: ["RULE-001"], owner: "src/owner.ts#effect", entrypoint: "src/entry.ts#main",
  callPath: ["src/entry.ts#main", "src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"] });

test("R39: same fingerprint and same links preserve the reviewed record exactly", () => {
  const row = reviewed();
  assert.equal(applyOwnerLinks(entries(), [row], [link()])[0], row);
  assert.deepEqual(applyOwnerLinks(entries(), [row], []), [row]);
});
test("R39: moving an owner invalidates proof without rewriting a normative fingerprint", () => {
  const row = reviewed(); const moved = link();
  moved.owner = "src/new-owner.ts#effect"; moved.callPath = [moved.entrypoint, moved.owner];
  const after = applyOwnerLinks(entries(), [row], [moved])[0];
  assert.equal(after.owner, moved.owner); assert.equal(after.digest, row.digest);
  assert.equal(after.status, "unverified"); assert.equal(after.evidence, null);
  assert.equal(after.verification, "NOT_RUN"); assert.equal(row.status, "proven");
});
test("R39: changing a clause never reuses the old clause's proof", () => {
  const changed = inventoryClauses([{ source: "spec.md", text: "**MUST [RULE-001]** Keep a different contract.\n" }]);
  const after = applyOwnerLinks(changed, [reviewed()], [link()])[0];
  assert.equal(after.status, "unverified"); assert.equal(after.evidence, null);
  assert.notEqual(after.digest, reviewed().digest);
});
test("R39: unreviewed rules stay unlinked rather than receiving a guessed owner", () => {
  const unlinked = applyOwnerLinks(entries(), [], [])[0];
  assert.equal(unlinked.owner, null); assert.equal(unlinked.status, "unverified");
});
test("R39: duplicate, extra and malformed owner records are rejected", () => {
  assert.throws(() => indexTrace([reviewed(), reviewed()]), /duplicate/);
  assert.throws(() => applyOwnerLinks(entries(), [reviewed()], [link(), link()]), /duplicate/);
  assert.throws(() => applyOwnerLinks(entries(), [reviewed()], [{ ...link(), requirements: ["UNKNOWN"] }]), /absent/);
  assert.throws(() => applyOwnerLinks(entries(), [reviewed()], [{ ...link(), negativeTests: [] }]), /invalid/);
  assert.throws(() => applyOwnerLinks(entries(), [reviewed()], [{ ...link(), callPath: ["src/unrelated.ts#helper"] }]), /invalid/);
});
const matrix = (first, last) => Array.from({ length: last - first + 1 }, (_, index) =>
  `| T${String(index + first).padStart(2, "0")} / synthetic | given -> when -> reject the invalid effect |`).join("\n");
test("R39: complete core and tiered matrices are separate scopes, not a replacement total", () => {
  const result = inventoryAcceptance([{ source: "core.md", text: matrix(1, 77) }, { source: "target.md", text: matrix(78, 90) }]);
  assert.equal(result.core.rows.length, 77); assert.equal(result.tiered.rows.length, 13); assert.equal(result.complete, true);
});
test("R39: core success cannot hide missing target oracles or a missing core row", () => {
  const coreOnly = inventoryAcceptance([{ source: "core.md", text: matrix(1, 77) }]);
  assert.equal(coreOnly.core.complete, true); assert.equal(coreOnly.complete, false);
  assert.deepEqual(coreOnly.tiered.missing, Array.from({ length: 13 }, (_, index) => 78 + index));
  const missingCore = inventoryAcceptance([{ source: "matrix.md", text: matrix(2, 90) }]);
  assert.deepEqual(missingCore.core.missing, [1]); assert.equal(missingCore.complete, false);
});
test("R39: duplicates, extra rows and malformed empty oracles cannot satisfy a fixed count", () => {
  const duplicate = inventoryAcceptance([{ source: "matrix.md", text: matrix(1, 90) + "\n" + matrix(78, 78) }]);
  assert.deepEqual(duplicate.tiered.duplicate, [78]); assert.equal(duplicate.complete, false);
  // TEST-008: T91 onward is the product band, not an extra row; a gap in it is.
  const product = inventoryAcceptance([{ source: "matrix.md", text: matrix(1, 91) }]);
  assert.deepEqual(product.extra, []); assert.deepEqual(product.product.rows.map(row => row.id), [91]); assert.equal(product.complete, true);
  const gap = inventoryAcceptance([{ source: "matrix.md", text: matrix(1, 90) + "\n" + matrix(92, 92) }]);
  assert.deepEqual(gap.product.missing, [91]); assert.equal(gap.complete, false);
  const extra = inventoryAcceptance([{ source: "matrix.md", text: matrix(1, 90) + "\n" + matrix(0, 0) }]);
  assert.equal(extra.extra[0].id, 0); assert.equal(extra.complete, false);
  const empty = inventoryAcceptance([{ source: "matrix.md", text: "| T01 / synthetic |   |\nT02 mentioned in prose is not a row" }]);
  assert.equal(empty.complete, false); assert.ok(empty.core.empty.includes(1) || empty.core.missing.includes(1));
});
