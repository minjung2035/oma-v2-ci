/** P2 tooling: resolve exports and compare declaration syntax without changing it. */
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

export function resolveExportDeclaration(checker, source, name) {
  if (!source) return undefined;
  const module = checker.getSymbolAtLocation(source);
  const exported = module && checker.getExportsOfModule(module).find(symbol => symbol.name === name);
  if (!exported) return undefined;
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  return symbol.declarations?.find(node => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isVariableDeclaration(node));
}

/** Relocated import-type strings are compared by repository-relative identity.
 * All other tokens, including optional/readonly modifiers and private helper
 * declarations, participate. A formatting change cannot update this golden.
 */
export function declarationSurface(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`invalid contract syntax: ${file}`);
  const surface = {};
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) continue;
    if (!ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node))
      throw new Error(`contract owner has executable or unsupported declaration: ${file}`);
    const start = node.getStart(source), replacements = [];
    const visit = child => {
      if (ts.isImportTypeNode(child) && ts.isLiteralTypeNode(child.argument) && ts.isStringLiteral(child.argument.literal)) {
        const literal = child.argument.literal;
        const target = literal.text.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), literal.text)) : literal.text;
        replacements.push([literal.getStart(source) - start, literal.end - start, JSON.stringify(target)]);
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    let normalized = node.getText(source);
    for (const [from, to, value] of replacements.sort((a, b) => b[0] - a[0]))
      normalized = normalized.slice(0, from) + value + normalized.slice(to);
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, normalized);
    const tokens = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
      tokens.push([ts.SyntaxKind[token], token === ts.SyntaxKind.StringLiteral ? scanner.getTokenValue() : scanner.getTokenText()]);
    if (Object.hasOwn(surface, node.name.text)) throw new Error(`duplicate contract declaration: ${node.name.text}`);
    surface[node.name.text] = {
      exported: node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false,
      sha256: createHash("sha256").update(JSON.stringify(tokens)).digest("hex"),
    };
  }
  return surface;
}

export function mergeSurfaces(surfaces) {
  const result = {};
  for (const surface of surfaces) for (const [name, entry] of Object.entries(surface)) {
    if (Object.hasOwn(result, name)) throw new Error(`multiple contract owners: ${name}`);
    result[name] = entry;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
