import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const slash = value => value.split(path.sep).join("/");
export const absolute = (root, relative) => path.resolve(root, relative);
export const exists = (root, relative) => fs.existsSync(absolute(root, relative));
export const readJson = (root, relative) => JSON.parse(fs.readFileSync(absolute(root, relative), "utf8"));
export const readText = (root, relative) => fs.readFileSync(absolute(root, relative), "utf8");
export const finding = (rule, file, reason) => ({ rule, file, reason });

/** Vendored bundled-extension payloads are byte-pinned upstream snapshots
 * (packages/tool-NAME/src/vendor/PKG/: upstream sources, generated runtime and the
 * hash-manifest), not authored OMA code. Every authored-code rule -- state
 * tree ownership, fence propagation, product vocabulary, the extension's own
 * closure -- judges files it can review, and a vendored file's review is the
 * recorded digest, so the tree is data to these rules and never enumerated. */
export const VENDORED_EXTENSION_DIRS = Object.freeze(["tool-lsp", "tool-hashline", "tool-web", "tool-mcp"].map(name => `packages/${name}/src/vendor`));
export const isVendoredExtension = file => VENDORED_EXTENSION_DIRS.some(dir => file.startsWith(`${dir}/`));

export function filesUnder(root, relative, extension = ".ts") {
  const base = absolute(root, relative);
  if (!fs.existsSync(base)) return [];
  const vendored = new Set(VENDORED_EXTENSION_DIRS.map(dir => absolute(root, dir)));
  const out = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) { if (!vendored.has(next)) walk(next); }
      else if (entry.isFile() && entry.name.endsWith(extension)) out.push(slash(path.relative(root, next)));
    }
  };
  walk(base);
  return out.sort();
}

/** Authored runtime sources, including independently built workspaces. */
export function authoredFiles(root) {
  const packages = absolute(root, "packages");
  return [...filesUnder(root, "src"), ...filesUnder(root, "apps/oma/src"), ...(fs.existsSync(packages)
    ? fs.readdirSync(packages, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .flatMap(entry => filesUnder(root, `packages/${entry.name}/src`)) : [])].sort();
}

// One rule-check invocation reads one syntax snapshot. Nothing survives the
// invocation: subsequent checks, including mutation controls, read fresh bytes.
let activeSources;
export function withSourceSnapshot(check) {
  const previous = activeSources;
  activeSources = new Map();
  try { return check(); }
  finally { activeSources = previous; }
}
export function sourceOf(root, relative) {
  const file = absolute(root, relative);
  const cached = activeSources?.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  activeSources?.set(file, source);
  return source;
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

/** A registry locator either records independent ownership or follows the
 * actual method's validator. Do not keep a second method -> validator table. */
export function registryOwnerSymbol(root, owner, mutation) {
  if (typeof owner?.symbolTemplate === "string") return owner.symbolTemplate.replaceAll("{mutation}", mutation);
  if (owner?.symbolFromMethod === "paramsCheck" && typeof owner.path === "string") {
    const file = "packages/protocol/src/methods.ts";
    const source = sourceOf(root, file);
    const table = publicMethodsObject(source);
    const method = table?.properties.find(node => ts.isPropertyAssignment(node) && propertyName(node.name) === mutation);
    const descriptor = method && strip(method.initializer);
    if (!descriptor || !ts.isObjectLiteralExpression(descriptor)) return null;
    const check = descriptor.properties.find(node => ts.isPropertyAssignment(node) && propertyName(node.name) === "paramsCheck");
    if (!check || !ts.isPropertyAssignment(check)) return null;
    const imports = new Map();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) ||
          normalizeRelativeImport(file, statement.moduleSpecifier.text) !== owner.path) continue;
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named))
        for (const specifier of named.elements) if (!specifier.isTypeOnly)
          imports.set(specifier.name.text, (specifier.propertyName ?? specifier.name).text);
    }
    const referenced = new Set();
    eachNode(check.initializer, node => {
      if (ts.isIdentifier(node) && imports.has(node.text)) referenced.add(imports.get(node.text));
    });
    return referenced.size === 1 ? [...referenced][0] : null;
  }
  return owner?.symbolByMutation?.[mutation] ?? null;
}

export function mutationMethods(root) {
  const source = sourceOf(root, "packages/protocol/src/methods.ts");
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
  if (/^(?:test\/|implementation\/tests\/)/.test(fromFile) && /^#oma-test\/app\/[a-z][a-z0-9/-]*$/.test(specifier))
    return `apps/oma/src/${specifier.slice("#oma-test/app/".length)}.ts`;
  const workspace = /^@oma\/([a-z-]+)(?:\/(.+))?$/.exec(specifier);
  if (workspace) return `${workspace[1] === "app" ? "apps/oma" : `packages/${workspace[1]}`}/src/${workspace[2] ?? "index"}.ts`;
  if (!specifier.startsWith(".")) return null;
  const raw = slash(path.normalize(path.join(path.dirname(fromFile), specifier)));
  return raw.endsWith(".js") ? `${raw.slice(0, -3)}.ts` : raw;
}
