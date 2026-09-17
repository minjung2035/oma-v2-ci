import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const slash = value => value.split(path.sep).join("/");
export const absolute = (root, relative) => path.resolve(root, relative);
export const exists = (root, relative) => fs.existsSync(absolute(root, relative));
export const readJson = (root, relative) => JSON.parse(fs.readFileSync(absolute(root, relative), "utf8"));
export const readText = (root, relative) => fs.readFileSync(absolute(root, relative), "utf8");
export const finding = (rule, file, reason) => ({ rule, file, reason });

export function filesUnder(root, relative, extension = ".ts") {
  const base = absolute(root, relative);
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && entry.name.endsWith(extension)) out.push(slash(path.relative(root, next)));
    }
  };
  walk(base);
  return out.sort();
}

export function sourceOf(root, relative) {
  const file = absolute(root, relative);
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

export function eachNode(node, visit) {
  visit(node);
  ts.forEachChild(node, child => eachNode(child, visit));
}

export function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;
}

export function strip(node) {
  while (node && (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )) node = node.expression;
  return node;
}

export function importSpecifiers(source) {
  const values = [];
  eachNode(source, node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
      values.push({ specifier: node.moduleSpecifier.text, node });
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal))
      values.push({ specifier: node.argument.literal.text, node });
  });
  return values;
}

function publicMethodsObject(source) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "PUBLIC_METHODS" || !declaration.initializer) continue;
      const value = strip(declaration.initializer);
      if (ts.isObjectLiteralExpression(value)) return value;
    }
  }
  return null;
}

export function mutationMethods(root) {
  const source = sourceOf(root, "src/protocol/methods.ts");
  const table = publicMethodsObject(source);
  if (!table) throw new Error("PUBLIC_METHODS object not found");
  const mutations = [];
  for (const property of table.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const method = propertyName(property.name);
    const descriptor = strip(property.initializer);
    if (!method || !ts.isObjectLiteralExpression(descriptor)) continue;
    const mode = descriptor.properties.find(value => ts.isPropertyAssignment(value) && propertyName(value.name) === "mode");
    if (!mode || !ts.isPropertyAssignment(mode)) continue;
    const value = strip(mode.initializer);
    if (ts.isStringLiteralLike(value) && value.text === "mutation") mutations.push(method);
  }
  return mutations.sort();
}

export function normalizeRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const raw = slash(path.normalize(path.join(path.dirname(fromFile), specifier)));
  return raw.endsWith(".js") ? `${raw.slice(0, -3)}.ts` : raw;
}
