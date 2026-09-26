/** PRIORITY-0 "문서와 식별자에도 같은 원칙" / P0-7: the documents' durable
 * boundaries -- requirement IDs, acceptance numbers, links -- hold in this tree,
 * and the checks that say so fail on the violations they exist for. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCEPTANCE_OWNER, acceptanceFindings, brokenLinks, documentIntegrity, duplicateRequirements } from "../scripts/document-integrity.mjs";

test("PRIORITY-0 / P0-7: in this tree every requirement ID has one clause, acceptance rows live in the matrix, and every link resolves", () => {
  assert.deepEqual(documentIntegrity("."), []);
});

test("PRIORITY-0 / P0-1: a requirement ID given to two clauses, or an acceptance number used outside its matrix, is a finding", () => {
  const spec = { source: "implementation-spec.md", text: "**MUST [INF-005]** relay.\n\n**MUST [INF-005]** cost cap.\n\n**MUST [INF-006]** once.\n" };
  assert.deepEqual(duplicateRequirements([spec]), ["INF-005 is defined 2 times (implementation-spec.md, implementation-spec.md)"]);
  const rows = (ids, suffix = "") => ids.map(id => `| T${id} / X${suffix} | oracle |`).join("\n");
  const core = Array.from({ length: 77 }, (_, index) => index + 1);
  const matrix = text => ({ source: ACCEPTANCE_OWNER, text });
  // A clean matrix: Core complete, a product band with one meaning over several rows (T91 twice).
  assert.deepEqual(acceptanceFindings([matrix(`${rows(core)}\n${rows([91, 91, 92])}`)]), []);
  assert.match(acceptanceFindings([matrix(`${rows(core)}\n${rows([36])}`)]).join("\n"), /core: T36 has more than one row/);
  assert.match(acceptanceFindings([matrix(`${rows(core)}\n${rows([91, 93])}`)]).join("\n"), /product: T92 is missing/);
  const outside = { source: "implementation/validation.md", text: "| T36 / WP25.02 | a verdict row |\n| WP25.02 (T36) | fine |" };
  assert.deepEqual(acceptanceFindings([matrix(rows(core)), outside]),
    [`implementation/validation.md:1 looks like an acceptance row; acceptance numbers belong to ${ACCEPTANCE_OWNER}`]);
});

test("PRIORITY-0 / P0-3: a link to a file or a heading that does not exist is a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-doc-links-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/a.md"), "# 제목 하나\n\n[ok](b.md#새-정보를-어디에-적는가) [self](#제목-하나) [web](https://example.invalid/x)\n");
    writeFileSync(join(root, "docs/b.md"), "## 새 정보를 어디에 적는가\n");
    assert.deepEqual(brokenLinks(root, ["docs/a.md"]), []);
    writeFileSync(join(root, "docs/a.md"), "[gone](c.md) [heading](b.md#없는-제목)\n");
    assert.deepEqual(brokenLinks(root, ["docs/a.md"]), [
      "docs/a.md: c.md names a file that does not exist",
      "docs/a.md: b.md#없는-제목 names a heading that does not exist",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
