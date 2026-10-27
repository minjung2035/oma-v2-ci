import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";

test("public contracts have no executable statements or implementation imports", async () => {
  const directory = new URL("../src/", import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith(".ts"))) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, directory), "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        assert.equal(statement.importClause?.isTypeOnly, true, file);
        assert.match(statement.moduleSpecifier.text, /^\.\/[^/]+\.js$/, file);
      } else if (ts.isExportDeclaration(statement)) {
        assert.equal(statement.isTypeOnly, true, file);
        assert.match(statement.moduleSpecifier.text, /^\.\/[^/]+\.js$/, file);
      } else if (ts.isVariableStatement(statement)) {
        // An ambient unique-symbol brand has no runtime identity or initializer.
        assert.ok(statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword), file);
        assert.ok(statement.declarationList.flags & ts.NodeFlags.Const, file);
        for (const declaration of statement.declarationList.declarations) {
          assert.equal(declaration.initializer, undefined, file);
          assert.equal(declaration.type?.kind, ts.SyntaxKind.TypeOperator, file);
          assert.equal(declaration.type?.operator, ts.SyntaxKind.UniqueKeyword, file);
          assert.equal(declaration.type?.type.kind, ts.SyntaxKind.SymbolKeyword, file);
        }
      } else assert.ok(ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement), file);
    }
  }
  assert.deepEqual(Object.keys(await import("@oma/contracts")), []);
});
