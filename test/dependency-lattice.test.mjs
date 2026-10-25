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
    // No lib files: the fixture programs only need their own modules resolved
    // for the lattice/type-cycle graph, so parsing lib.*.d.ts is pure cost.
    const program = ts.createProgram(paths, { noEmit: true, strict: true, types: [], lib: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    return analyzeProgram(program, { rootDir: root, checkContracts: false })
      .filter(finding => LATTICE_RULES.has(finding.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const typeRef = to => `import type { Value } from "${to}";\nexport type Held = Value;\n`;

test("P5 lattice: the measured layer order is kernel < facts < workflow < orchestration < entry", () => {
  assert.deepEqual(["packages/domain/src/identifiers.ts", "packages/platform-linux/src/units.ts", "packages/mail/src/index.ts", "packages/broker/src/index.ts", "apps/oma/src/cli.ts", "packages/contracts/src/index.ts"]
    .map(file => [file, layerOf(file)?.name]), [
    ["packages/domain/src/identifiers.ts", "L1-kernel"],
    ["packages/platform-linux/src/units.ts", "L2-facts"],
    ["packages/mail/src/index.ts", "L3-workflow"],
    ["packages/broker/src/index.ts", "L4-orchestration"],
    ["apps/oma/src/cli.ts", "L5-entry"],
    ["packages/contracts/src/index.ts", "L0-contracts"],
  ]);
  assert.equal(layerOf("packages/domain/src/identifiers.ts").index < layerOf("packages/mail/src/index.ts").index, true);
  assert.equal(layerOf("packages/review/src/index.ts")?.name, "L3-workflow", "current mail review coordinates acceptance and publication");
});

test("P5 lattice: a reverse runtime edge fails and the forward edge does not", () => {
  const upward = analyze({
    "packages/domain/src/low.ts": "import { high } from \"../../../apps/oma/src/broker/high.js\"; export const low = high;",
    "apps/oma/src/broker/high.ts": `export const high = 1;`,
  });
  assert.equal(upward.length, 1, JSON.stringify(upward));
  assert.equal(upward[0].rule, "dependency-lattice");
  assert.equal(upward[0].file, "packages/domain/src/low.ts");
  assert.match(upward[0].reason, /L1-kernel.*L4-orchestration/);

  const downward = analyze({
    "packages/domain/src/low.ts": `export const low = 1;`,
    "apps/oma/src/broker/high.ts": "import { low } from \"../../../../packages/domain/src/low.js\"; export const high = low;",
  });
  assert.deepEqual(downward, []);

  const sameLayer = analyze({
    "packages/storage/src/one.ts": `import { two } from "./two.js"; export const one = two;`,
    "packages/storage/src/two.ts": `export const two = 2;`,
  });
  assert.deepEqual(sameLayer, []);
});

test("P5 lattice: a file outside the measured layers fails instead of escaping the gate", () => {
  const findings = analyze({ "apps/oma/src/unmeasured/thing.ts": `export const thing = 1;` });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.equal(findings[0].rule, "dependency-lattice-unclassified");
});

test("P5 lattice: a type-only reference may not form a cycle across two layers", () => {
  const findings = analyze({
    "packages/domain/src/a.ts": typeRef("../../../apps/oma/src/broker/b.js"),
    "apps/oma/src/broker/b.ts": typeRef("../../../../packages/domain/src/a.js"),
  });
  assert.deepEqual(findings.map(finding => finding.rule), ["type-import-cycle"], JSON.stringify(findings));
  assert.match(findings[0].reason, /L1-kernel, L4-orchestration/);
});

test("DR44: Store capabilities cannot form a type cycle with their composition even within one layer", () => {
  const findings = analyze({
    "packages/storage/src/facets.ts": typeRef("./store.js"),
    "packages/storage/src/store.ts": typeRef("./facets.js"),
  });
  assert.deepEqual(findings.map(finding => finding.rule), ["type-import-cycle"]);
});

test("P5 lattice: the current production graph satisfies the enforced lattice", () => {
  const program = createArchitectureProgram(process.cwd());
  // The lattice, kernel and type-cycle findings are all evaluated from the
  // import graph before the contract-exhaustiveness section runs, so disabling
  // contract checks cannot change any finding this filter keeps.
  const findings = analyzeProgram(program, { rootDir: process.cwd(), checkContracts: false })
    .filter(finding => LATTICE_RULES.has(finding.rule));
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
