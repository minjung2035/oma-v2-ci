import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { declarationSurface, mergeSurfaces, resolveExportDeclaration } from "../scripts/contract-surface.mjs";
import { analyzeProgram } from "../scripts/architecture-check.mjs";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const files = readdirSync(new URL("implementation/contracts/", root)).filter(file => file.endsWith(".ts")).map(file => `implementation/contracts/${file}`);
const golden = JSON.parse(read("test/fixtures/contracts-v1-surface.json"));
const digest = surface => createHash("sha256").update(JSON.stringify(surface)).digest("hex");
const surfaces = () => mergeSurfaces(files.map(file => declarationSurface(read(file), file)));

test("P2 contracts: every public and private v1 declaration retains its exact normalized syntax", () => {
  assert.equal(digest(surfaces()), golden.declarationsSha256);
  assert.equal(Object.keys(surfaces()).length, golden.declarationCount);
});
test("P2 contracts: optionality, field values, and private envelope changes are detected", () => {
  for (const [file, before, after] of [
    ["implementation/contracts/values.ts", "profile?: never", "profile?: string"],
    ["implementation/contracts/public-wire.ts", "v: 1; id: string", "v: 2; id: string"],
    ["implementation/contracts/durable.ts", "stagingPath: string", "stagingPath?: string"],
  ]) {
    assert.ok(read(file).includes(before));
    const changed = mergeSurfaces(files.map(current => declarationSurface(current === file ? read(current).replace(before, after) : read(current), current)));
    assert.notEqual(digest(changed), golden.declarationsSha256, file);
  }
});
test("P2 contracts: facade exports exactly the existing public names with no executable statements", () => {
  const source = ts.createSourceFile("facade.ts", read("implementation/contracts.ts"), ts.ScriptTarget.Latest, true);
  const names = [];
  for (const statement of source.statements) {
    assert.ok(ts.isExportDeclaration(statement) && statement.isTypeOnly);
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause));
    for (const item of statement.exportClause.elements) names.push(item.name.text);
  }
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), golden.exportedNames);
});
test("P2 contracts: leaf definitions have an acyclic owner graph and cannot import the facade or module ports", () => {
  const leaves = files.filter(file => !file.endsWith("/module-contracts.ts"));
  const graph = new Map(leaves.map(file => [file, []]));
  for (const file of leaves) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const visit = node => {
      let literal;
      if (ts.isImportDeclaration(node)) {
        assert.ok(node.importClause?.isTypeOnly, `${file}: runtime import`);
        literal = node.moduleSpecifier;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
      if (literal && ts.isStringLiteral(literal)) {
        const target = posix.normalize(posix.join(posix.dirname(file), literal.text)).replace(/\.js$/, ".ts");
        assert.notEqual(target, "implementation/contracts.ts");
        assert.notEqual(target, "src/module-ports.ts");
        if (graph.has(target)) graph.get(file).push(target);
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  const active = new Set(), done = new Set();
  const visit = file => {
    assert.ok(!active.has(file), `type dependency cycle at ${file}`);
    if (done.has(file)) return;
    active.add(file); for (const target of graph.get(file)) visit(target);
    active.delete(file); done.add(file);
  };
  for (const file of graph.keys()) visit(file);
});
test("P2 contracts: architecture exhaustiveness follows type re-exports instead of declaration location", () => {
  const directory = mkdtempSync(join(tmpdir(), "oma-contract-export-"));
  try {
    const fixture = {
      "implementation/contracts.ts": 'export type { PublicMethods, InternalMethods, OperationPlan } from "./owners.js";',
      "implementation/owners.ts": 'export interface PublicMethods { sample: unknown }; export interface InternalMethods {}; export type OperationPlan = { kind: "a" } | { kind: "b" };',
      "src/protocol/methods.ts": 'export const PUBLIC_METHODS = { sample: {} }; export const INTERNAL_METHODS = {};',
      "src/registry.ts": 'const codec = { planCheck() {}, resultCheck() {}, relationsCheck() {} }; export const OPERATION_CODECS = { a: codec, b: codec };',
    };
    const names = Object.entries(fixture).map(([file, text]) => { const target = join(directory, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); return target; });
    const make = () => ts.createProgram(names, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noLib: true, noEmit: true });
    let program = make();
    const relevant = () => analyzeProgram(program, { rootDir: directory }).filter(item => ["operation-exhaustiveness", "method-exhaustiveness"].includes(item.rule));
    assert.deepEqual(relevant(), []);
    assert.equal(resolveExportDeclaration(program.getTypeChecker(), program.getSourceFile(names[0]), "OperationPlan")?.name.text, "OperationPlan");
    writeFileSync(names[3], fixture["src/registry.ts"].replace("a: codec, b: codec", "a: codec"));
    program = make();
    assert.ok(relevant().some(item => item.rule === "operation-exhaustiveness"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
