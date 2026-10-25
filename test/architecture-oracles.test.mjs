import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import ts from "typescript";
const root = new URL("../", import.meta.url);
import {
  analyzeProgram,
  runtimeImportClosure,
  runArchitectureCheck,
  applyExactBaseline,
} from "../scripts/architecture-check.mjs";
import {
  architectureSources,
  createArchitectureProgram,
  collectDependencyGraph,
  graphFromProgram,
  dependencyEvidence,
  stronglyConnected,
  summarize,
} from "../scripts/dependency-graph.mjs";
import {
  KERNEL_ZONES,
  kernelFindings,
  kernelZoneOf,
} from "../scripts/kernel-zones.mjs";
import { isInternalPort, contractOwnershipFindings } from "../scripts/dependency-lattice.mjs";

function fixture(files, run, include = ["apps/oma/src/**/*.ts", "packages/*/src/**/*.ts"]) {
  const root = mkdtempSync(join(tmpdir(), "oma-oracle-"));
  try {
    for (const [file, text] of Object.entries({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          types: [],
          noEmit: true,
          target: "es2022",
          module: "nodenext",
          moduleResolution: "nodenext",
        },
        include,
      }),
      ...files,
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    return run(root, createArchitectureProgram(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Independent oracle: transitive closure + mutual reachability, not Tarjan/lowlink.
// ponytail: O(n^3) reference limited to tiny test graphs; production stays iterative O(V+E).
function referenceScc(nodes, adjacency) {
  const reach = nodes.map((a, i) =>
    nodes.map((b, j) => i === j || adjacency.get(a).has(b)),
  );
  for (let k = 0; k < nodes.length; k++)
    for (let i = 0; i < nodes.length; i++)
      for (let j = 0; j < nodes.length; j++)
        reach[i][j] ||= reach[i][k] && reach[k][j];
  const remaining = new Set(nodes),
    groups = [];
  for (const [i, node] of nodes.entries()) {
    if (!remaining.has(node)) continue;
    const group = nodes.filter((_, j) => reach[i][j] && reach[j][i]);
    group.forEach((member) => remaining.delete(member));
    groups.push(group);
  }
  return groups;
}
const normalize = (groups) =>
  groups.map((group) => [...group].sort().join(",")).sort();

test("P15 SCC agrees with independent reachability oracle on exhaustive tiny and seeded random graphs", () => {
  let seed = 0x51cc;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let sample = 0; sample < 1512; sample++) {
    const n = sample < 512 ? 3 : Math.floor(random() * 12);
    const nodes = Array.from({ length: n }, (_, i) => String(i));
    const adjacency = new Map(
      nodes.map((node, i) => [
        node,
        new Set(
          nodes.filter((_, j) =>
            sample < 512 ? sample & (1 << (i * n + j)) : random() < 0.22,
          ),
        ),
      ]),
    );
    assert.deepEqual(
      normalize(stronglyConnected(nodes, adjacency)),
      normalize(referenceScc(nodes, adjacency)),
      `sample=${sample}`,
    );
  }
  const nodes = Array.from({ length: 20_000 }, (_, i) => String(i));
  const chain = new Map(
    nodes.map((node, i) => [
      node,
      new Set(i + 1 < nodes.length ? [nodes[i + 1]] : []),
    ]),
  );
  assert.equal(
    stronglyConnected(nodes, chain).length,
    nodes.length,
    "no recursive stack overflow",
  );
});

test("P10 full Program type-only closure is evidence, not runtime package inventory", () => {
  fixture(
    {
      "packages/native/src/identity.ts":
        'import type {Leaf} from "../../contracts/src/leaf.js"; export type Root = Leaf;',
      "packages/contracts/src/leaf.ts":
        "export interface Leaf { value: string }",
      "test/only.ts":
        'import type {Unused} from "../packages/contracts/src/test-only.js";',
      "packages/contracts/src/test-only.ts": "export type Unused = number;",
    },
    (root, program) => {
      const graph = graphFromProgram(program, { rootDir: root });
      const expected = ["packages/contracts/src/leaf.ts", "packages/native/src/identity.ts"];
      assert.deepEqual(graph.files, expected);
      assert.deepEqual(
        architectureSources(program, root).map((source) =>
          relative(root, source.fileName),
        ),
        expected,
      );
      assert.deepEqual(collectDependencyGraph({ rootDir: root }), graph);
      assert.deepEqual(dependencyEvidence(graph).sourceFiles, expected);
      assert.deepEqual(
        analyzeProgram(program, {
          rootDir: root,
          checkContracts: false,
          programGraph: graph,
        }),
        [],
      );
      assert.throws(
        () =>
          analyzeProgram(program, {
            rootDir: root,
            checkContracts: false,
            programGraph: { ...graph, files: ["packages/native/src/identity.ts"] },
          }),
        /source identity mismatch/,
      );
      const closure = runtimeImportClosure({
        rootDir: root,
        roots: ["packages/native/src/identity.ts"],
        manifest: ["packages/native/src/identity.ts"],
        compilerOptions: program.getCompilerOptions(),
      });
      assert.deepEqual([...closure.reachable], ["packages/native/src/identity.ts"]);
      assert.deepEqual(closure.findings, []);
    },
    ["packages/native/src/identity.ts", "test/**/*.ts"],
  );
});

test("P15 evidence and analyzer both report runtime self loops", () => {
  fixture({ "packages/native/src/identity.ts": 'import "./identity.js";' }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(summarize(graph).runtimeCycles, [["packages/native/src/identity.ts"]]);
    assert.deepEqual(dependencyEvidence(graph).runtimeCycles, [["packages/native/src/identity.ts"]]);
    assert.ok(
      analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
        (f) => f.rule === "runtime-import-cycle",
      ),
    );
  });
});

test("P15 transaction effect mutations follow direct/imported/local aliases and helper closures", () => {
  const store =
    "class Store { transaction(f: () => unknown) { return f(); } } const store = new Store();";
  for (const effect of [
    'import {writeFileSync} from "node:fs"; store.transaction(() => writeFileSync("/never", "x"));',
    'import {writeFileSync as write} from "node:fs"; store.transaction(() => write("/never", "x"));',
    'import {writeFileSync} from "node:fs"; function helper() { writeFileSync("/never", "x"); } store.transaction(() => helper());',
    'import {writeFileSync} from "node:fs"; const write = writeFileSync; store.transaction(() => write("/never", "x"));',
    'import * as fs from "node:fs"; const io = fs; const write = io.writeFileSync; store.transaction(() => write("/never", "x"));',
    'import * as fs from "node:fs"; const {writeFileSync: write} = fs; store.transaction(() => write("/never", "x"));',
  ])
    fixture(
      { "apps/oma/src/entry/example.ts": `${store}\n${effect}` },
      (root, program) => {
        const rules = analyzeProgram(program, {
          rootDir: root,
          checkContracts: false,
        }).map((f) => f.rule);
        assert.ok(
          rules.includes("transaction-effect"),
          effect + JSON.stringify(rules),
        );
      },
    );
  fixture(
    {
      "apps/oma/src/entry/example.ts": `${store} const pure = () => 1; const alias = pure; store.transaction(() => alias());`,
    },
    (root, program) => {
      assert.deepEqual(
        analyzeProgram(program, { rootDir: root, checkContracts: false }),
        [],
      );
    },
  );
});

test("P15 import syntax mutations share architecture and runtime closure classification", () => {
  for (const [source, kind] of [
    ['import {value} from "./leaf.js";', "runtime"],
    ['export {value} from "./leaf.js";', "runtime"],
    ['void import("./leaf.js");', "runtime"],
    ['const value = require("./leaf.js");', "runtime"],
    ['import value = require("./leaf.js");', "runtime"],
    ['import type {Value} from "./leaf.js";', "type"],
    ['type Value = import("./leaf.js").Value;', "type"],
    ['import type value = require("./leaf.js");', "type"],
  ])
    fixture(
      {
        "apps/oma/src/entry/root.ts": source,
        "apps/oma/src/entry/leaf.ts":
          "export const value = 1; export type Value = number;",
      },
      (root, program) => {
        const graph = graphFromProgram(program, { rootDir: root });
        assert.equal(graph.edges.length, 1, source);
        assert.equal(graph.edges[0].kind, kind, source);
        const closure = runtimeImportClosure({
          rootDir: root,
          roots: ["apps/oma/src/entry/root.ts"],
          manifest: graph.files,
          compilerOptions: program.getCompilerOptions(),
        });
        assert.equal(
          closure.reachable.has("apps/oma/src/entry/leaf.ts"),
          kind === "runtime",
          source,
        );
        assert.deepEqual(closure.findings, []);
      },
    );
  fixture(
    { "apps/oma/src/entry/root.ts": "const target = \"@oma/native/linux\"; void import(target);" },
    (root, program) => {
      const graph = graphFromProgram(program, { rootDir: root });
      assert.equal(graph.unresolved.length, 1);
      assert.equal(Object.hasOwn(graph.external, ""), false);
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "dynamic-import",
        ),
      );
    },
  );
});

test("DR27/P13: tier facts, retained codecs and snapshot mechanisms have distinct owners", () => {
  const owners = {
    "packages/domain/src/attestation-relations.ts": "K0-values",
    "packages/domain/src/risk-tier.ts": "K0-values",
    "packages/domain/src/attestation.ts": "K1-codecs",
    "packages/domain/src/integration-policy.ts": "K1-codecs",
    "packages/git/src/project-preparation.ts": "K2-mechanisms",
    "packages/native/src/snapshot-reader.ts": "K2-mechanisms",
  };
  for (const [file, zone] of Object.entries(owners)) assert.equal(kernelZoneOf(file)?.name, zone, file);
});

test("P13 every semantic zone direction, exact membership and pure external capability are gated", () => {
  const representatives = [
    "packages/domain/src/identifiers.ts",
    "packages/protocol/src/methods.ts",
    "packages/process/src/async.ts",
    "packages/storage/src/store.ts",
  ];
  for (let from = 0; from < 4; from++)
    for (let to = 0; to < 4; to++) {
      const graph = {
        files: representatives,
        edges: [
          {
            from: representatives[from],
            to: representatives[to],
            kind: "runtime",
            included: true,
          },
        ],
      };
      assert.equal(kernelFindings(graph).length, from < to ? 1 : 0);
      assert.equal(
        kernelFindings({
          ...graph,
          edges: [{ ...graph.edges[0], kind: "type" }],
        }).length,
        0,
      );
    }
  assert.equal(kernelZoneOf("packages/domain/src/new.ts"), null);
  assert.equal(
    kernelFindings({ files: ["packages/domain/src/new.ts"], edges: [] })[0].rule,
    "kernel-zone-unclassified",
  );
  assert.equal(
    kernelZoneOf(representatives[0], [
      ...KERNEL_ZONES,
      { name: "duplicate", files: [representatives[0]] },
    ]),
    null,
  );
  for (const source of [
    "import {value} from \"../../storage/src/durable-fs.js\";",
    "export {value} from \"../../storage/src/durable-fs.js\";",
    "void import(\"../../storage/src/durable-fs.js\");",
  ])
    fixture(
      {
        "packages/protocol/src/methods.ts": source,
        "packages/storage/src/durable-fs.ts": "export const value = 1;",
      },
      (root, program) => {
        assert.ok(
          analyzeProgram(program, {
            rootDir: root,
            checkContracts: false,
          }).some((f) => f.rule === "kernel-dependency"),
        );
      },
    );
  for (const source of [
    'import {readFileSync} from "node:fs";',
    'import {randomUUID} from "node:crypto";',
    'import * as crypto from "node:crypto";',
  ])
    fixture({ "packages/domain/src/canonical-json.ts": source }, (root, program) => {
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "kernel-external-effect",
        ),
      );
    });
  fixture(
    {
      "packages/domain/src/canonical-json.ts":
        'import {createHash as hash} from "node:crypto";',
    },
    (root, program) => {
      assert.deepEqual(
        analyzeProgram(program, { rootDir: root, checkContracts: false }),
        [],
      );
    },
  );
  const graph = collectDependencyGraph();
  assert.deepEqual(kernelFindings(graph), []);
  assert.equal(
    new Set(KERNEL_ZONES.flatMap((zone) => zone.files)).size,
    KERNEL_ZONES.flatMap((zone) => zone.files).length,
  );
});

test("P14 declaration-only ports retain pinned implementation conformance outside their owner", () => {
  assert.equal(ts.version, "5.9.3");
  const program = createArchitectureProgram();
  const ports = program.getSourceFiles().filter(source => isInternalPort(relative(process.cwd(), source.fileName).replaceAll("\\", "/")));
  const port = ports.find(source => source.fileName.endsWith("/apps/oma/src/ports/ledger.ts"));
  const conformance = program
    .getSourceFiles()
    .find((source) =>
      source.fileName.endsWith("/apps/oma/src/entry/module-conformance.ts"),
    );
  assert.ok(
    port && conformance,
    "production Program must check composition conformance",
  );
  for (const declaration of ports) assert.equal(
    ts.transpileModule(declaration.text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, removeComments: true },
    }).outputText.trim(),
    "export {};",
  );
  assert.equal(
    ts
      .transpileModule(conformance.text, {
        compilerOptions: { module: ts.ModuleKind.ESNext, removeComments: true },
      })
      .outputText.trim(),
    "export {};",
  );
  const graph = graphFromProgram(program);
  assert.ok(
    !graph.edges.some(
      (edge) =>
        isInternalPort(edge.from) &&
        [
          "packages/storage/src/store.ts",
          "apps/oma/src/units.ts",
          "apps/oma/src/views.ts",
          "packages/reconcile/src/index.ts",
          "apps/oma/src/runner.ts",
          "apps/oma/src/sandbox.ts",
        ].includes(edge.to),
    ),
  );
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    [],
  );
  const host = ts.createCompilerHost(program.getCompilerOptions());
  const read = host.getSourceFile.bind(host);
  // The mutated program re-reads only the port; every other input is the
  // production program's own SourceFile -- parse and binding are functions of
  // content, so shared syntax is what a reparse would produce.
  const portAst = ts.createSourceFile(port.fileName, port.text, ts.ScriptTarget.Latest, true);
  let returnTypeRange = null;
  const findOperationLookup = (node) => {
    if (returnTypeRange === null && (ts.isMethodSignature(node) || ts.isPropertySignature(node)) && node.name?.getText(portAst) === "getOperation" && node.type)
      returnTypeRange = [node.type.getStart(portAst), node.type.getEnd()];
    ts.forEachChild(node, findOperationLookup);
  };
  findOperationLookup(portAst);
  assert.ok(returnTypeRange, "StorePort getOperation declaration must be present");
  const mutatedPort = port.text.slice(0, returnTypeRange[0]) + "never" + port.text.slice(returnTypeRange[1]);
  host.getSourceFile = (file, version, ...rest) =>
    file === port.fileName
      ? ts.createSourceFile(file, mutatedPort, version, true, ts.ScriptKind.TS)
      : (program.getSourceFile(file) ?? read(file, version, ...rest));
  const mutated = ts.createProgram({
    rootNames: [conformance.fileName],
    options: program.getCompilerOptions(),
    host,
  });
  // The assertion reads one file's diagnostics; a whole-program preEmit pass
  // would recheck every source for the same answer.
  assert.ok(
    [
      ...mutated.getSyntacticDiagnostics(conformance),
      ...mutated.getSemanticDiagnostics(conformance),
    ].some((d) => d.code === 2344),
    "incompatible Store must fail conformance, not just a caller",
  );
});

test("P15 local path aliases cannot masquerade as external packages to escape the lattice or manifest", () => {
  fixture(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@effect": ["packages/process/src/run.ts"] },
          types: [],
        },
        include: ["packages/domain/src/identifiers.ts"],
      }),
      "packages/domain/src/identifiers.ts":
        'import {run} from "@effect"; export const value = run;',
      "packages/process/src/run.ts": "export const run = 1;",
    },
    (root, program) => {
      const graph = graphFromProgram(program, { rootDir: root });
      assert.equal(graph.edges[0].to, "packages/process/src/run.ts");
      assert.equal(graph.edges[0].included, true);
      assert.equal(Object.hasOwn(graph.external, "@effect"), false);
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "kernel-dependency",
        ),
      );
      const closure = runtimeImportClosure({
        rootDir: root,
        roots: ["packages/domain/src/identifiers.ts"],
        manifest: ["packages/domain/src/identifiers.ts"],
        compilerOptions: program.getCompilerOptions(),
      });
      assert.ok(closure.reachable.has("packages/process/src/run.ts"));
      assert.deepEqual(closure.findings, [
        "Runtime import outside production manifest: packages/process/src/run.ts",
      ]);
    },
  );
});

test("P15 persisted evidence identity fails before rule evaluation and exact baselines stay source-bound", () => {
  fixture(
    {
      "apps/oma/src/entry/example.ts":
        "const s = new Set(); if (s.add(1)) throw new Error();",
      "implementation/evidence/dependency-graph.json":
        JSON.stringify({ sourceFiles: [] }),
    },
    (root, program) => {
      // No production manifest exists: identity must fail before package/rule diagnostics.
      assert.throws(
        () => runArchitectureCheck(root),
        /source identity mismatch/,
      );
      const findings = analyzeProgram(program, {
        rootDir: root,
        checkContracts: false,
      });
      assert.deepEqual(
        findings.map((f) => f.rule),
        ["set-add-membership"],
      );
      const baseline = {
        ...findings[0],
        reason: "test-only exact exception",
        removeIn: "R40",
      };
      assert.deepEqual(applyExactBaseline(findings, [baseline]), []);
      for (const field of ["sourceHash", "snippetHash"]) {
        const changed = { ...baseline, [field]: "0".repeat(64) };
        assert.deepEqual(
          applyExactBaseline(findings, [changed]).map((f) => f.rule),
          ["set-add-membership", "stale-baseline"],
        );
      }
      assert.throws(
        () => applyExactBaseline(findings, [{ ...baseline, file: "apps/oma/src/**" }]),
        /Invalid or wildcard/,
      );
      const { sourceHash, ...lineOnly } = baseline;
      assert.throws(
        () => applyExactBaseline(findings, [lineOnly]),
        /Invalid or wildcard/,
      );
    },
  );
});

test("P15 deleting the evidence directory cannot disable the mandatory freshness gate", () => {
  fixture(
    {
      "apps/oma/src/entry/example.ts": "export const value = 1;",
      "production-files.txt": "",
    },
    (root) => {
      const result = runArchitectureCheck(root);
      assert.ok(
        result.findings.some((f) => f.rule === "dependency-evidence-stale"),
      );
    },
  );
});

test("P15 narrowing Store to its declared port does not hide transaction effects", () => {
  fixture(
    {
      "apps/oma/src/entry/example.ts": `
    import {writeFileSync as write} from "node:fs";
    interface StorePort { transaction(f: () => unknown): unknown; }
    declare const store: StorePort;
    store.transaction(() => write("/never", "x"));
  `,
    },
    (root, program) => {
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "transaction-effect",
        ),
      );
    },
  );
});

test("P17 erased contracts reject runtime values, aliases and re-exports without gating type relations", () => {
  const cases = [
    ['import type { Fact } from "@oma/protocol/operation-codec"; export interface Port { read(): Fact; }', false],
    ['export type { Fact as Alias } from "@oma/protocol/operation-codec";', false],
    ['declare const brand: unique symbol; export interface Port { readonly [brand]: true; }', false],
    ['export const leaked = 1;', true],
    ['import { make as alias } from "@oma/protocol/operation-codec"; export const leaked = alias();', true],
    ['import * as owner from "@oma/protocol/operation-codec"; export { owner };', true],
    ['export { make as leak } from "@oma/protocol/operation-codec";', true],
    ['import "@oma/protocol/operation-codec"; export interface Port {}', true],
    ['export enum RuntimeValue { Leaked }', true],
    ['export const load = (name: string) => import(name);', true],
  ];
  // Exercise both the directory-owned contracts and the exact-file facade.
  for (const file of ["apps/oma/src/ports/runtime.ts", "apps/oma/src/ports/ledger.ts"]) for (const [text, rejected] of cases) fixture({
    [file]: text,
    "packages/protocol/src/operation-codec.ts": "export interface Fact { value: number; } export function make() { return 1; }",
    "packages/domain/src/identifiers.ts": "export const legitimateRuntimeValue = 1;",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false }).filter(f => f.rule === "internal-port-runtime");
    assert.deepEqual(findings.map(f => f.file), rejected ? [file] : [], text);
    assert.equal(kernelZoneOf(file), null);
    assert.equal(isInternalPort("apps/oma/src/ports-extra/fake.ts"), false);
  });
});
test("P23 contract ownership forbids runtime, type, inline-import and re-export edges out of exact L0 contracts", () => {
  const target = "apps/oma/src/storage/value.ts";
  const negative = [
    ["apps/oma/src/ports/runtime.ts", 'import type { Value } from "../storage/value.js"; export interface Port { value: Value; }', "type"],
    ["apps/oma/src/ports/runtime.ts", 'export type { Value } from "../storage/value.js";', "type"],
    ["apps/oma/src/ports/runtime.ts", 'export interface Port { value: import("../storage/value.js").Value; }', "type"],
    ["apps/oma/src/ports/runtime.ts", 'import { value } from "../storage/value.js"; export const leaked = value;', "runtime"],
    ["apps/oma/src/ports/ledger.ts", 'export type { Value } from "../storage/value.js";', "type"],
  ];
  for (const [file, text, kind] of negative) fixture({ [file]: text, [target]: "export interface Value { value: string; }" }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graph });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === file && finding.reason.includes(target) && finding.reason.includes(`${kind} edge`)), `${file} ${kind} edge`);
  });
  fixture({
    "packages/contracts/src/index.ts": "import type { Value } from \"../../../apps/oma/src/storage/value.js\"; export interface Root { value: Value; }",
    [target]: "export interface Value { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graph });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "packages/contracts/src/index.ts" && finding.reason.includes(target)), "implementation contracts must not reference storage implementation");
  }, ["apps/oma/src/**/*.ts", "packages/contracts/src/index.ts"]);
  fixture({
    "packages/contracts/src/index.ts": "export interface Root { leaf: import(\"./leaf.js\").Leaf; }",
    "packages/contracts/src/leaf.ts": "export interface Leaf { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(contractOwnershipFindings(graph.edges), [], "contract-to-contract references remain valid");
  }, ["apps/oma/src/**/*.ts", "packages/contracts/src/index.ts", "packages/contracts/src/**/*.ts"]);
  fixture({
    "implementation/helper.ts": "import type { Value } from \"../apps/oma/src/storage/value.js\"; export type Helper = Value;",
    [target]: "export interface Value { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(contractOwnershipFindings(graph.edges), [], "non-contract implementation files are not broad-prefix exemptions");
  }, ["apps/oma/src/**/*.ts", "implementation/**/*.ts"]);
});

test("P23 contract ownership exempts no contract -> implementation reference", () => {
  // The four frozen v1 aliases were migrated to contract-owned declarations, so
  // the allowlist is gone. Each former alias must now be reported, including
  // when it hides behind a rename or the public facade.
  for (const [file, target, name] of [
    ["packages/contracts/src/module-contracts.ts", "packages/storage/src/store.ts", "Transaction"],
    ["packages/contracts/src/host.ts", "packages/domain/src/limits.ts", "ProtocolLimits"],
    ["packages/contracts/src/identity.ts", "packages/domain/src/capabilities.ts", "Capability"],
  ]) {
    const specifier = relative(dirname(file), target).replace(/\.ts$/, ".js");
    const declaration = `export interface ${name} { value: string; }`;
    for (const reference of [
      `export type ${name} = import("${specifier}").${name};`,
      `export type Renamed = import("${specifier}").${name};`,
      `import type { ${name} } from "${specifier}"; export type Held = ${name};`,
    ]) fixture({ [file]: reference, [target]: declaration }, (root, program) => {
      const findings = analyzeProgram(program, { rootDir: root, checkContracts: false })
        .filter(finding => finding.rule === "contract-ownership");
      assert.deepEqual(findings.map(finding => finding.file), [file], `${file}: ${name}`);
    }, ["apps/oma/src/**/*.ts", "packages/contracts/src/**/*.ts"]);
    // An internal port may not launder the same reference either.
    fixture({
      [target]: declaration,
      "apps/oma/src/ports/runtime.ts": `export type Leaked = import("${relative("apps/oma/src/ports", target).replace(/\.ts$/, ".js")}").${name};`,
    }, (root, program) => {
      const findings = analyzeProgram(program, { rootDir: root, checkContracts: false });
      assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "apps/oma/src/ports/runtime.ts"));
    }, ["apps/oma/src/**/*.ts", "packages/contracts/src/**/*.ts"]);
  }
});

test("P23 the migrated vocabulary owners keep a two-way compile-time binding", () => {
  // The contract now declares the closed set and the runtime descriptor must
  // satisfy it. Dropping either side has to fail the build, not the gate.
  const read = file => readFileSync(new URL(file, root), "utf8");
  // A reference is an import specifier, not a mention in prose.
  const referencesImplementation = source =>
    /(?:import\s*\(\s*|from\s*)['"][^'"]*\.\.\/\.\.\/src\/[^'"]*['"]/.test(source);
  assert.match(read("packages/contracts/src/identity.ts"), /export type Capability =\s*\n?\s*\| 'mail\.send'/);
  const withoutComments = file => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const file of ["packages/contracts/src/identity.ts", "packages/contracts/src/host.ts"])
    assert.ok(!referencesImplementation(withoutComments(file)), `${file} must not reference implementation`);
  for (const [file, contractType] of [
    ["packages/domain/src/capabilities.ts", "Capability"],
    ["packages/domain/src/limits.ts", "ProtocolLimits"],
  ]) {
    const source = read(file);
    assert.match(source, /@oma\/contracts\//, `${file} must bind to the contract owner`);
    assert.match(source, /\[Missing\w+\] extends \[never\]/, `${file} must assert exhaustiveness`);
    assert.ok(source.includes(contractType), `${file} must name ${contractType}`);
  }
});

test("P23 contract ports cannot hide the concrete Transaction alias behind the public contracts facade", () => {
  fixture({
    "apps/oma/src/ports/runtime.ts": "import type { Transaction } from \"../../../../packages/contracts/src/index.js\"; export interface Port { transaction: Transaction; }",
    "packages/contracts/src/index.ts": "export type { Transaction } from \"./module-contracts.js\";",
    "packages/contracts/src/module-contracts.ts": "export type Transaction = import(\"../../storage/src/store.js\").Transaction;",
    "packages/storage/src/store.ts": "export interface Transaction { commit(): void; }",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graphFromProgram(program, { rootDir: root }) });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "packages/contracts/src/module-contracts.ts"), "the concrete Transaction import must remain rejected");
  }, ["apps/oma/src/**/*.ts", "packages/contracts/src/index.ts", "packages/contracts/src/**/*.ts"]);
});
test("P23 hidden compatibility aliases cannot cross the canonical port boundary", () => {
  fixture({
    "apps/oma/src/ports/runtime.ts": "import type { HiddenTx } from \"../../../../packages/contracts/src/index.js\"; export interface Port { transaction: HiddenTx; }",
    "packages/contracts/src/index.ts": "export type { HiddenTx } from \"./module-contracts.js\";",
    "packages/contracts/src/module-contracts.ts": "export type Transaction = import(\"../../storage/src/store.js\").Transaction; export type HiddenTx = Transaction;",
    "packages/storage/src/store.ts": "export interface Transaction { commit(): void; }",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graphFromProgram(program, { rootDir: root }) });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "packages/contracts/src/module-contracts.ts"), "an alias cannot hide its concrete implementation import");
  }, ["apps/oma/src/**/*.ts", "packages/contracts/src/index.ts", "packages/contracts/src/**/*.ts"]);
});



test("P19 type coupling evidence reports structural reasons without approving or forbidding upward types", () => {
  const graph = graphFromProgram(createArchitectureProgram());
  const evidence = dependencyEvidence(graph).kernel;
  assert.equal(evidence.typeOnlyReview.mode, "report-only");
  assert.equal(evidence.typeOnlyReview.classificationsAreApproval, false);
  for (const port of ["apps/oma/src/ports/ledger.ts", "apps/oma/src/ports/runtime.ts"])
    assert.ok(evidence.internalPortContracts.includes(port));
  const upward = evidence.typeOnlyReview.edges.filter(edge => edge.kernelUpward);
  assert.ok(upward.some(edge => edge.from === "packages/protocol/src/operation-results.ts" && edge.to === "packages/protocol/src/operation-codec.ts" && edge.classification === "representation-relation"));
  for (const classification of ["port-conformance", "internal-port-contract"])
    assert.ok(evidence.typeOnlyReview.edges.some(edge => edge.classification === classification), classification);
  assert.deepEqual(kernelFindings(graph), []);
  fixture({
    "packages/protocol/src/receipt-codec.ts": "import type { Row } from \"../../storage/src/rows.js\"; export type View = Row;",
    "packages/storage/src/rows.ts": 'export interface Row { value: string; }',
  }, (root, program) => {
    const extra = graphFromProgram(program, { rootDir: root });
    assert.ok(dependencyEvidence(extra).kernel.typeOnlyReview.edges.some(edge => edge.kernelUpward));
    assert.deepEqual(kernelFindings(extra), []); // No hidden type-direction gate.
  });
});
