import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { freezeMessageFacts, messagePlanFrom } from "@oma/mail/facts";
import { renderFrozenMessage } from "@oma/mail/serialize";

const root = fileURLToPath(new URL("../../", import.meta.url));
const id = "m-11111111-1111-4111-8111-111111111111-0";

test("pure header runtime closure excludes mail coordinator SQLite transport and effects", () => {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every(element => element.isTypeOnly)) continue;
        specifier = node.moduleSpecifier;
      } else if (ts.isExportDeclaration(node)) {
        if (node.isTypeOnly) continue;
        if (node.exportClause && ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.every(element => element.isTypeOnly)) continue;
        specifier = node.moduleSpecifier;
      }
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const target = specifier.text;
      assert.ok(target.startsWith(".") || target.startsWith("@oma/domain/"), `pure header closure imports external runtime ${target}`);
      const next = target.startsWith("@oma/") ? fileURLToPath(import.meta.resolve(target)) : resolve(dirname(path), target);
      assert.notEqual(next, fileURLToPath(import.meta.resolve("@oma/mail")));
      assert.notEqual(next, fileURLToPath(import.meta.resolve("@oma/storage")));
      assert.notEqual(next, fileURLToPath(import.meta.resolve("@oma/mail/serialize")));
      visit(next);
    }
  };
  visit(fileURLToPath(import.meta.resolve("@oma/mail/headers")));
  assert.ok(seen.size >= 3);
});

test("an accepted original always unfolds back to its frozen OMA metadata", async () => {
  // Regression: buildEml folds long header values at RFC 5322 boundaries, so a
  // 64-hex context OID arrives as a continuation line. Every validated value
  // must be unfolded before the grammar check, or OMA cannot read its own mail.
  const candidate = "a3".repeat(32);
  const facts = freezeMessageFacts({ id, society: "demo", sender: "alice", to: ["residents"],
    kind: "context", contextRevision: candidate,
    replyHeaders: { replyTo: [], inReplyTo: null, references: [] } });
  const rendered = await renderFrozenMessage(facts, { subject: "context", body: "GOAL\n" });
  assert.equal(rendered.headerFacts.omaContext, candidate);
  const folded = rendered.text.split(/\r?\n/).filter(line => line.startsWith(" ") || line.startsWith("\t"));
  assert.ok(folded.length > 0, "fixture must exercise a folded header value");
  const plan = messagePlanFrom(rendered, ["alice"]);
  assert.equal(plan.contextRevision, candidate);
});

test("facts freeze one clock value; emission and plan never select another date", async t => {
  let reads = 0;
  t.mock.method(Date, "now", () => { reads++; return 946684800987; });
  const facts = freezeMessageFacts({ id, society: "demo", sender: "alice", to: ["bob"],
    kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } });
  assert.equal(reads, 1);
  assert.equal(facts.dateMs, 946684800000);
  t.mock.restoreAll();
  const rendered = await renderFrozenMessage(facts, { subject: "s", body: "body\n" });
  const plan = messagePlanFrom(rendered, ["bob"]);
  assert.equal(rendered.dateMs, facts.dateMs);
  assert.equal(rendered.headerFacts.dateMs, facts.dateMs);
  assert.equal(plan.dateMs, facts.dateMs);
  assert.deepEqual(plan.to, ["bob"]);
  assert.deepEqual(plan.replyHeaders.replyTo, ["alice"]);
  await assert.rejects(renderFrozenMessage(facts, { subject: "bad\r\nX-OMA-Kind: critical", body: "b" }), /CR\/LF/);
});
