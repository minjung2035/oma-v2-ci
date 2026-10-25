import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { resolveExportDeclaration } from "../scripts/contract-surface.mjs";
import { analyzeProgram } from "../scripts/architecture-check.mjs";

test("P2 contracts: architecture exhaustiveness follows type re-exports instead of declaration location", () => {
  const directory = mkdtempSync(join(tmpdir(), "oma-contract-export-"));
  try {
    const fixture = {
      "packages/contracts/src/index.ts": "export type { PublicMethods, InternalMethods, OperationPlan } from \"./owners.js\";",
      "packages/contracts/src/owners.ts": 'export interface PublicMethods { sample: unknown }; export interface InternalMethods {}; export type OperationPlan = { kind: "a" } | { kind: "b" };',
      "packages/protocol/src/methods.ts": 'export const PUBLIC_METHODS = { sample: {} }; export const INTERNAL_METHODS = {};',
      "apps/oma/src/registry.ts": 'const codec = { planCheck() {}, resultCheck() {}, relationsCheck() {} }; export const OPERATION_CODECS = { a: codec, b: codec };',
    };
    const names = Object.entries(fixture).map(([file, text]) => { const target = join(directory, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); return target; });
    const make = () => ts.createProgram(names, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noLib: true, noEmit: true });
    let program = make();
    const relevant = () => analyzeProgram(program, { rootDir: directory }).filter(item => ["operation-exhaustiveness", "method-exhaustiveness"].includes(item.rule));
    assert.deepEqual(relevant(), []);
    assert.equal(resolveExportDeclaration(program.getTypeChecker(), program.getSourceFile(names[0]), "OperationPlan")?.name.text, "OperationPlan");
    writeFileSync(names[3], fixture["apps/oma/src/registry.ts"].replace("a: codec, b: codec", "a: codec"));
    program = make();
    assert.ok(relevant().some(item => item.rule === "operation-exhaustiveness"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
