import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isolatedDeclarationDiagnostics } from "../scripts/isolated-declarations.mjs";

test("foreign declaration errors never exempt broken authored declarations or missing imports", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-declarations-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const owned = join(root, "owned"), entry = join(root, "types.mts"), api = join(owned, "api.d.ts");
  mkdirSync(owned);
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "foreign.d.ts"), "export type UpstreamBroken = MissingForeignType;\nexport interface Good { value: string }\n");
  writeFileSync(entry, 'export type API = typeof import("./owned/api.js");');
  const valid = 'import type { Good } from "../foreign.js";\nexport declare function use(input: Good): string;\n';
  writeFileSync(api, valid);
  const inspect = () => isolatedDeclarationDiagnostics(entry, [owned], { types: [] });
  const first = inspect();
  assert.deepEqual(first.diagnostics, []);
  assert.ok(first.externalDiagnostics > 0);
  assert.equal(first.checkedDeclarations, 1);
  assert.deepEqual(first.checkedDeclarationFiles, [api]);
  writeFileSync(api, valid + "export type BrokenOwn = MissingAuthoredType;\n");
  assert.ok(inspect().diagnostics.some(diagnostic => diagnostic.code === 2304 && diagnostic.file.fileName === api));
  writeFileSync(api, valid + 'export * from "./missing.js";\n');
  assert.ok(inspect().diagnostics.some(diagnostic => diagnostic.code === 2307 && diagnostic.file.fileName === api));
  writeFileSync(api, valid);
  assert.ok(isolatedDeclarationDiagnostics(entry, [owned]).diagnostics.some(diagnostic => diagnostic.code === 2688),
    "Node types absent from the isolated install must not resolve from the tool's root cwd");
});
