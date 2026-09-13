/** P2 verification tooling: narrow imports without hiding executable changes. */
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

export function contractOwners(facadeText) {
  const source = ts.createSourceFile("implementation/contracts.ts", facadeText, ts.ScriptTarget.Latest, true);
  const owners = new Map();
  for (const node of source.statements) {
    if (!ts.isExportDeclaration(node) || !node.isTypeOnly || !node.exportClause ||
        !ts.isNamedExports(node.exportClause) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
      throw new Error("contract facade must contain only explicit type re-exports");
    const target = path.posix.normalize(path.posix.join("implementation", node.moduleSpecifier.text));
    for (const item of node.exportClause.elements) {
      if (owners.has(item.name.text)) throw new Error(`duplicate facade export: ${item.name.text}`);
      owners.set(item.name.text, { target, exported: (item.propertyName ?? item.name).text });
    }
  }
  return owners;
}

/** Compare aliases and non-import tokens to a source-pinned pre-migration file.
 * The only permitted change is replacing facade references with their exact
 * concept owner. Runtime imports, wildcard imports and unknown names fail closed.
 */
export function contractImportSnapshot(file, text, owners, { requireNarrow = false } = {}) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`invalid TypeScript: ${file}`);
  const facade = "implementation/contracts.js";
  const targets = new Set([...owners.values()].map(owner => owner.target));
  const resolve = literal => literal.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), literal)) : literal;
  const edits = [], bindings = [], inline = [];
  const check = (module, imported) => {
    const owner = owners.get(imported);
    if (!owner) throw new Error(`unknown contract: ${file}: ${imported}`);
    if (module === facade) {
      if (requireNarrow) throw new Error(`facade dependency remains: ${file}`);
    } else if (module !== owner.target || owner.exported !== imported) {
      throw new Error(`wrong contract owner: ${file}: ${imported}`);
    }
  };
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = resolve(node.moduleSpecifier.text);
      if (module === facade || targets.has(module)) {
        const clause = node.importClause;
        if (!clause?.isTypeOnly || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
          throw new Error(`contract import must be named and type-only: ${file}`);
        for (const item of clause.namedBindings.elements) {
          const imported = (item.propertyName ?? item.name).text;
          check(module, imported);
          bindings.push([item.name.text, imported]);
        }
        edits.push([node.getStart(source), node.end, ""]);
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const literal = node.argument.literal, module = resolve(literal.text);
      if (module === facade || targets.has(module)) {
        let name = node.qualifier;
        while (name && ts.isQualifiedName(name)) name = name.left;
        if (!name || !ts.isIdentifier(name)) throw new Error(`unqualified contract import: ${file}`);
        check(module, name.text);
        inline.push(name.text);
        edits.push([literal.getStart(source), literal.end, '"<contract-owner>"']);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let body = text;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) body = body.slice(0, start) + replacement + body.slice(end);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, body), tokens = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    tokens.push([ts.SyntaxKind[token], token === ts.SyntaxKind.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText()]);
  return { bodySha256: createHash("sha256").update(JSON.stringify(tokens)).digest("hex"),
    bindings: bindings.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0), inline: inline.sort() };
}
