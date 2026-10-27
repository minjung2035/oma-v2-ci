import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventoryClauses, indexTrace, applyOwnerLinks, inventoryAcceptance, normativeSources } from "../scripts/traceability.mjs";
import { specInventoryFindings } from "../scripts/spec-inventory.mjs";

const entries = () => inventoryClauses([{ source: "spec.md", text: "**MUST [RULE-001]** Keep the accepted identity.\n" }]);
function reviewed() {
  return { ...entries()[0], applicability: "runtime", status: "proven", rationale: "synthetic structural-test fixture only",
    owner: "apps/oma/src/owner.ts#effect", entrypoint: "apps/oma/src/entry.ts#main",
    callPath: ["apps/oma/src/entry.ts#main", "apps/oma/src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"],
    evidence: { synthetic: true, description: "not production execution evidence" } };
}
const link = () => ({ source: "spec.md", requirements: ["RULE-001"], owner: "apps/oma/src/owner.ts#effect", entrypoint: "apps/oma/src/entry.ts#main",
  callPath: ["apps/oma/src/entry.ts#main", "apps/oma/src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"] });

test("R39: same fingerprint and same links preserve the reviewed record exactly", () => {
  const row = reviewed();
  assert.equal(applyOwnerLinks(entries(), [row], [link()])[0], row);
  assert.deepEqual(applyOwnerLinks(entries(), [row], []), [row]);
});
test("R39: moving an owner invalidates proof without rewriting a normative fingerprint", () => {
  const row = reviewed(); const moved = link();
  moved.owner = "apps/oma/src/new-owner.ts#effect"; moved.callPath = [moved.entrypoint, moved.owner];
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
  assert.throws(() => applyOwnerLinks(entries(), [reviewed()], [{ ...link(), callPath: ["apps/oma/src/unrelated.ts#helper"] }]), /invalid/);
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

test("F-3: a clause edit without a re-fingerprinted row, and a stale row, are drift findings", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-spec-inventory-"));
  try {
    const clause = "**MUST [PAIR-001]** Reject unfingerprinted drift.\n";
    for (const source of normativeSources) {
      mkdirSync(join(root, source, ".."), { recursive: true });
      writeFileSync(join(root, source), source === "docs/implementation-spec.md" ? clause : "");
    }
    mkdirSync(join(root, "implementation"), { recursive: true });
    writeFileSync(join(root, "implementation/traceability.json"), "[]\n");
    // No row at all: the clause is unpaired.
    assert.equal(specInventoryFindings(root).length, 1);
    // A fingerprinted row makes the pairing clean; a stale row beside it is drift.
    writeFileSync(join(root, "implementation/traceability.json"), JSON.stringify(inventoryClauses(
      normativeSources.map(source => ({ source, text: source === "docs/implementation-spec.md" ? clause : "" }))), null, 2) + "\n");
    assert.deepEqual(specInventoryFindings(root), []);
    // A one-line clause edit reopens the finding on both sides of the pairing.
    writeFileSync(join(root, "docs/implementation-spec.md"), "**MUST [PAIR-001]** Reject unfingerprinted drift, twice.\n");
    assert.equal(specInventoryFindings(root).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
