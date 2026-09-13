/** P2: migrate type dependencies, never declarations, validators or runtime code. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const facade = "implementation/contracts.ts";
const slash = value => value.split(path.sep).join("/");
const targetOf = (file, specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.js$/, ".ts");
const specifierFor = (file, target) => {
  const relative = path.posix.relative(path.posix.dirname(file), target).replace(/\.ts$/, ".js");
  return relative.startsWith(".") ? relative : `./${relative}`;
};

/** The compatibility facade is the index. No second hand-maintained owner list. */
export function contractOwners(text) {
  const source = ts.createSourceFile(facade, text, ts.ScriptTarget.Latest, true);
  const owners = new Map();
  for (const node of source.statements) {
    if (!ts.isExportDeclaration(node) || !node.isTypeOnly || !node.exportClause ||
        !ts.isNamedExports(node.exportClause) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
      throw new Error("contract facade must contain only named type exports");
    for (const item of node.exportClause.elements) {
      if (owners.has(item.name.text)) throw new Error(`duplicate facade export ${item.name.text}`);
      owners.set(item.name.text, { file: targetOf(facade, node.moduleSpecifier.text), name: item.propertyName?.text ?? item.name.text });
    }
  }
  if (owners.size === 0) throw new Error("empty contract facade");
  return owners;
}

export function migrateContractImports(text, file, owners) {
  file = slash(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  const ownerOf = name => {
    const owner = owners.get(name);
    if (!owner) throw new Error(`${file}: unknown contract export ${name}`);
    return owner;
  };
  const referencesFacade = node => ts.isStringLiteral(node) && node.text.startsWith(".") && targetOf(file, node.text) === facade;
  const visit = node => {
    if (ts.isImportDeclaration(node) && referencesFacade(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) ||
          clause.namedBindings.elements.length === 0 || (!clause.isTypeOnly && clause.namedBindings.elements.some(item => !item.isTypeOnly)))
        throw new Error(`${file}: only explicit named type imports may migrate`);
      const groups = new Map();
      for (const item of clause.namedBindings.elements) {
        const owner = ownerOf(item.propertyName?.text ?? item.name.text);
        const names = groups.get(owner.file) ?? [];
        names.push(owner.name === item.name.text ? owner.name : `${owner.name} as ${item.name.text}`);
        groups.set(owner.file, names);
      }
      edits.push({ start: node.getStart(source), end: node.end,
        text: [...groups].map(([target, names]) => `import type { ${names.join(", ")} } from ${JSON.stringify(specifierFor(file, target))};`).join("\n") });
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && referencesFacade(node.moduleSpecifier)) {
      if (!node.isTypeOnly || !node.exportClause || !ts.isNamedExports(node.exportClause))
        throw new Error(`${file}: wildcard/runtime facade re-export is not a narrow type dependency`);
      const groups = new Map();
      for (const item of node.exportClause.elements) {
        const owner = ownerOf(item.propertyName?.text ?? item.name.text);
        const names = groups.get(owner.file) ?? [];
        names.push(owner.name === item.name.text ? owner.name : `${owner.name} as ${item.name.text}`);
        groups.set(owner.file, names);
      }
      edits.push({ start: node.getStart(source), end: node.end,
        text: [...groups].map(([target, names]) => `export type { ${names.join(", ")} } from ${JSON.stringify(specifierFor(file, target))};`).join("\n") });
      return;
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && referencesFacade(node.argument.literal)) {
      let qualifier = node.qualifier;
      while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
      if (!qualifier || !ts.isIdentifier(qualifier)) throw new Error(`${file}: unqualified facade import type`);
      const owner = ownerOf(qualifier.text);
      edits.push({ start: node.argument.literal.getStart(source), end: node.argument.literal.end,
        text: JSON.stringify(specifierFor(file, owner.file)) });
      if (owner.name !== qualifier.text) edits.push({ start: qualifier.getStart(source), end: qualifier.end, text: owner.name });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { text: result, edits: edits.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, ...files] = process.argv.slice(2);
  if (!["--check", "--write"].includes(mode) || files.length === 0) throw new Error("usage: contract-imports.mjs --check|--write <selected-source.ts>...");
  const owners = contractOwners(fs.readFileSync(facade, "utf8"));
  // Prepare all requested edits before writing, so unsupported imports cannot
  // leave a partially migrated selection. Worktree edits still require review.
  const plans = files.map(file => {
    const relative = slash(path.relative(process.cwd(), path.resolve(file)));
    if (!relative.startsWith("src/") || !relative.endsWith(".ts") || fs.lstatSync(relative).isSymbolicLink()) throw new Error("expected a regular src/*.ts source");
    return { file: relative, ...migrateContractImports(fs.readFileSync(relative, "utf8"), relative, owners) };
  });
  for (const plan of plans) {
    if (!plan.edits) continue;
    console.log(`${plan.file}: ${plan.edits} facade references`);
    if (mode === "--write") fs.writeFileSync(plan.file, plan.text);
    else process.exitCode = 1;
  }
}
