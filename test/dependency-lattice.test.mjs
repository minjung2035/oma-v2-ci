import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import ts from "typescript";
import { analyzeProgram, createArchitectureProgram } from "../scripts/architecture-check.mjs";
import { layerOf } from "../scripts/dependency-lattice.mjs";

const LATTICE_RULES = new Set(["dependency-lattice", "dependency-lattice-unclassified", "type-import-cycle"]);

/** Exercise the real checker with real files, not a second lattice implementation. */
function analyze(files) {
  const root = mkdtempSync(join(tmpdir(), "oma-lattice-"));
  try {
    const paths = Object.entries(files).map(([name, contents]) => {
      const absolute = join(root, name);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
      return absolute;
    });
    const program = ts.createProgram(paths, { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    return analyzeProgram(program, { rootDir: root, checkContracts: false })
      .filter(finding => LATTICE_RULES.has(finding.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const typeRef = to => `import type { Value } from "${to}";\nexport type Held = Value;\n`;

test("P5 lattice: the measured layer order is kernel < facts < workflow < orchestration < entry", () => {
  assert.deepEqual(["src/domain/identifiers.ts", "src/units.ts", "src/mail.ts", "src/broker.ts", "src/cli.ts", "implementation/contracts.ts"]
    .map(file => [file, layerOf(file)?.name]), [
    ["src/domain/identifiers.ts", "L1-kernel"],
    ["src/units.ts", "L2-facts"],
    ["src/mail.ts", "L3-workflow"],
    ["src/broker.ts", "L4-orchestration"],
    ["src/cli.ts", "L5-entry"],
    ["implementation/contracts.ts", "L0-contracts"],
  ]);
  assert.equal(layerOf("src/domain/identifiers.ts").index < layerOf("src/mail.ts").index, true);
});

test("P5 lattice: a reverse runtime edge fails and the forward edge does not", () => {
  const upward = analyze({
    "src/domain/low.ts": `import { high } from "../broker/high.js"; export const low = high;`,
    "src/broker/high.ts": `export const high = 1;`,
  });
  assert.equal(upward.length, 1, JSON.stringify(upward));
  assert.equal(upward[0].rule, "dependency-lattice");
  assert.equal(upward[0].file, "src/domain/low.ts");
  assert.match(upward[0].reason, /L1-kernel.*L4-orchestration/);

  const downward = analyze({
    "src/domain/low.ts": `export const low = 1;`,
    "src/broker/high.ts": `import { low } from "../domain/low.js"; export const high = low;`,
  });
  assert.deepEqual(downward, []);

  const sameLayer = analyze({
    "src/storage/one.ts": `import { two } from "./two.js"; export const one = two;`,
    "src/storage/two.ts": `export const two = 2;`,
  });
  assert.deepEqual(sameLayer, []);
});

test("P5 lattice: a file outside the measured layers fails instead of escaping the gate", () => {
  const findings = analyze({ "src/unmeasured/thing.ts": `export const thing = 1;` });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, "dependency-lattice-unclassified");
});

test("P5 lattice: a type-only reference may not form a cycle across two layers", () => {
  const findings = analyze({
    "src/domain/a.ts": typeRef("../broker/b.js"),
    "src/broker/b.ts": typeRef("../domain/a.js"),
  });
  assert.deepEqual(findings.map(finding => finding.rule), ["type-import-cycle"], JSON.stringify(findings));
  assert.match(findings[0].reason, /L1-kernel, L4-orchestration/);
});

test("P5 lattice: one layer is one mechanism, so an intra-layer type cycle is not a crossing", () => {
  const findings = analyze({
    "src/storage/facets.ts": typeRef("../store.js"),
    "src/store.ts": typeRef("./storage/facets.js"),
  });
  assert.deepEqual(findings, []);
});

test("P5 lattice: the current production graph satisfies the enforced lattice", () => {
  const program = createArchitectureProgram(process.cwd());
  const findings = analyzeProgram(program, { rootDir: process.cwd() }).filter(finding => LATTICE_RULES.has(finding.rule));
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
