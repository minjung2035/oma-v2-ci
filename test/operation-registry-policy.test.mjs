import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import ts from "typescript";
import { analyzeProgram } from "../scripts/architecture-check.mjs";

/** Exercise the real checker, not a second implementation of its set comparison. */
function analyze({ count = 2, plan, entries, omitPlan = false, omitRegistry = false, typed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-operation-registry-"));
  const names = Array.from({ length: count }, (_, index) => `fixture.operation${index}`);
  const methods = names.map(name => `${JSON.stringify(name)}: unknown`).join("; ");
  const files = {
    "packages/contracts/src/index.ts": [
      `export interface PublicMethods { ${methods} }`,
      "export interface InternalMethods {}",
      "export type MutationMethod = keyof PublicMethods;",
      ...(omitPlan ? [] : [`export type OperationPlan = ${plan ?? names.map(name => `{ kind: ${JSON.stringify(name)} }`).join(" | ")};`]),
    ].join("\n"),
    "packages/protocol/src/methods.ts": `export const PUBLIC_METHODS = { ${names.map(name => `${JSON.stringify(name)}: {}`).join(", ")} };\nexport const INTERNAL_METHODS = {};`,
    "packages/protocol/src/operation-codec.ts": omitRegistry ? "export {};" : [
      'import type { MutationMethod } from "../../contracts/src/index.js";',
      "type OperationCodec = { planCheck: () => void; resultCheck: () => void; relationsCheck: () => void };",
      `export const OPERATION_CODECS = { ${entries ?? names.map(name => `${JSON.stringify(name)}: { planCheck() {}, resultCheck() {}, relationsCheck() {} }`).join(", ")} }${typed ? " satisfies Record<MutationMethod, OperationCodec>" : ""};`,
    ].join("\n"),
  };
  try {
    const paths = Object.entries(files).map(([file, content]) => {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      return path;
    });
    const program = ts.createProgram(paths, { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    return {
      findings: analyzeProgram(program, { rootDir: root }).filter(finding => finding.rule === "operation-exhaustiveness"),
      diagnostics: ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
        .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const count of [1, 2, 11, 12]) {
  test(`P1 operation registry: a matching closed set of ${count} kinds is independent of count`, () => {
    const result = analyze({ count, typed: true });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.findings, []);
  });
}

test("P1 operation registry: missing and extra keys fail closed", () => {
  for (const count of [1, 2, 12]) {
    const entries = Array.from({ length: count - 1 }, (_, index) =>
      `"fixture.operation${index}": { planCheck() {}, resultCheck() {}, relationsCheck() {} }`).join(", ");
    assert.ok(analyze({ count, entries }).findings.length > 0, `missing key at count=${count}`);
  }
  const extra = '"fixture.operation0": { planCheck() {}, resultCheck() {}, relationsCheck() {} }, "fixture.extra": { planCheck() {}, resultCheck() {}, relationsCheck() {} }';
  assert.ok(analyze({ count: 1, entries: extra }).findings.length > 0);
});

test("P1 operation registry: each codec field must remain callable", () => {
  const fields = ["planCheck", "resultCheck", "relationsCheck"];
  for (const field of fields) {
    for (const missing of [true, false]) {
      const body = fields.flatMap(name => name !== field ? [`${name}() {}`] : missing ? [] : [`${name}: true`]).join(", ");
      const result = analyze({ count: 1, entries: `"fixture.operation0": { ${body} }` });
      assert.ok(result.findings.some(finding => finding.reason.includes(`lacks callable ${field}`)), `${field}, missing=${missing}`);
    }
  }
});

test("P1 operation registry: missing, empty and nonliteral plan domains are not closed sets", () => {
  for (const fixture of [
    { omitPlan: true }, { omitRegistry: true }, { plan: "never", entries: "" },
    { plan: "{ kind: string }" },
    { plan: '{ kind: "fixture.operation0" } | { kind: string }', count: 1 },
    { plan: '{ kind: "fixture.operation0" } | { other: true }', count: 1 },
    { plan: '{ kind?: "fixture.operation0" }', count: 1 },
  ]) assert.ok(analyze(fixture).findings.length > 0, JSON.stringify(fixture));
});

test("P1 operation registry: compiler rejects a new kind without its codec and accepts complete coverage", () => {
  const missing = analyze({ count: 12, entries: '"fixture.operation0": { planCheck() {}, resultCheck() {}, relationsCheck() {} }', typed: true });
  assert.ok(missing.diagnostics.some(message => message.includes("missing") || message.includes("does not satisfy")));
  assert.deepEqual(analyze({ count: 12, typed: true }).diagnostics, []);
});
