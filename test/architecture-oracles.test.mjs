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

function fixture(files, run, include = ["src/**/*.ts"]) {
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
      "src/ids.ts":
        'import type {Leaf} from "../implementation/contracts/leaf.js"; export type Root = Leaf;',
      "implementation/contracts/leaf.ts":
        "export interface Leaf { value: string }",
      "test/only.ts":
        'import type {Unused} from "../implementation/contracts/test-only.js";',
      "implementation/contracts/test-only.ts": "export type Unused = number;",
    },
    (root, program) => {
      const graph = graphFromProgram(program, { rootDir: root });
      const expected = ["implementation/contracts/leaf.ts", "src/ids.ts"];
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
            programGraph: { ...graph, files: ["src/ids.ts"] },
          }),
        /source identity mismatch/,
      );
      const closure = runtimeImportClosure({
        rootDir: root,
        roots: ["src/ids.ts"],
        manifest: ["src/ids.ts"],
        compilerOptions: program.getCompilerOptions(),
      });
      assert.deepEqual([...closure.reachable], ["src/ids.ts"]);
      assert.deepEqual(closure.findings, []);
    },
    ["src/ids.ts", "test/**/*.ts"],
  );
});

test("P15 evidence and analyzer both report runtime self loops", () => {
  fixture({ "src/ids.ts": 'import "./ids.js";' }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(summarize(graph).runtimeCycles, [["src/ids.ts"]]);
    assert.deepEqual(dependencyEvidence(graph).runtimeCycles, [["src/ids.ts"]]);
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
      { "src/entry/example.ts": `${store}\n${effect}` },
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
      "src/entry/example.ts": `${store} const pure = () => 1; const alias = pure; store.transaction(() => alias());`,
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
        "src/entry/root.ts": source,
        "src/entry/leaf.ts":
          "export const value = 1; export type Value = number;",
      },
      (root, program) => {
        const graph = graphFromProgram(program, { rootDir: root });
        assert.equal(graph.edges.length, 1, source);
        assert.equal(graph.edges[0].kind, kind, source);
        const closure = runtimeImportClosure({
          rootDir: root,
          roots: ["src/entry/root.ts"],
          manifest: graph.files,
          compilerOptions: program.getCompilerOptions(),
        });
        assert.equal(
          closure.reachable.has("src/entry/leaf.ts"),
          kind === "runtime",
          source,
        );
        assert.deepEqual(closure.findings, []);
      },
    );
  fixture(
    { "src/entry/root.ts": 'const target = "./leaf.js"; void import(target);' },
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

test("P13 every semantic zone direction, exact membership and pure external capability are gated", () => {
  const representatives = [
    "src/domain/identifiers.ts",
    "src/protocol/methods.ts",
    "src/process/async.ts",
    "src/store.ts",
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
  assert.equal(kernelZoneOf("src/domain/new.ts"), null);
  assert.equal(
    kernelFindings({ files: ["src/domain/new.ts"], edges: [] })[0].rule,
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
    'import {value} from "../storage/durable-fs.js";',
    'export {value} from "../storage/durable-fs.js";',
    'void import("../storage/durable-fs.js");',
  ])
    fixture(
      {
        "src/protocol/methods.ts": source,
        "src/storage/durable-fs.ts": "export const value = 1;",
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
    fixture({ "src/domain/canonical-json.ts": source }, (root, program) => {
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "kernel-external-effect",
        ),
      );
    });
  fixture(
    {
      "src/domain/canonical-json.ts":
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
  const port = ports.find(source => source.fileName.endsWith("/src/ports/ledger.ts"));
  const conformance = program
    .getSourceFiles()
    .find((source) =>
      source.fileName.endsWith("/src/entry/module-conformance.ts"),
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
          "src/store.ts",
          "src/units.ts",
          "src/views.ts",
          "src/reconcile.ts",
          "src/runner.ts",
          "src/sandbox.ts",
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
      : read(file, version, ...rest);
  const mutated = ts.createProgram({
    rootNames: [conformance.fileName],
    options: program.getCompilerOptions(),
    host,
  });
  assert.ok(
    ts
      .getPreEmitDiagnostics(mutated)
      .some(
        (d) => d.code === 2344 && d.file?.fileName === conformance.fileName,
      ),
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
          paths: { "@effect": ["src/process/run.ts"] },
          types: [],
        },
        include: ["src/domain/identifiers.ts"],
      }),
      "src/domain/identifiers.ts":
        'import {run} from "@effect"; export const value = run;',
      "src/process/run.ts": "export const run = 1;",
    },
    (root, program) => {
      const graph = graphFromProgram(program, { rootDir: root });
      assert.equal(graph.edges[0].to, "src/process/run.ts");
      assert.equal(graph.edges[0].included, true);
      assert.equal(Object.hasOwn(graph.external, "@effect"), false);
      assert.ok(
        analyzeProgram(program, { rootDir: root, checkContracts: false }).some(
          (f) => f.rule === "kernel-dependency",
        ),
      );
      const closure = runtimeImportClosure({
        rootDir: root,
        roots: ["src/domain/identifiers.ts"],
        manifest: ["src/domain/identifiers.ts"],
        compilerOptions: program.getCompilerOptions(),
      });
      assert.ok(closure.reachable.has("src/process/run.ts"));
      assert.deepEqual(closure.findings, [
        "Runtime import outside production manifest: src/process/run.ts",
      ]);
    },
  );
});

test("P15 persisted evidence identity fails before rule evaluation and exact baselines stay source-bound", () => {
  fixture(
    {
      "src/entry/example.ts":
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
        () => applyExactBaseline(findings, [{ ...baseline, file: "src/**" }]),
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
      "src/entry/example.ts": "export const value = 1;",
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
      "src/entry/example.ts": `
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
    ['import type { Fact } from "../storage/operation-codec.js"; export interface Port { read(): Fact; }', false],
    ['export type { Fact as Alias } from "../storage/operation-codec.js";', false],
    ['declare const brand: unique symbol; export interface Port { readonly [brand]: true; }', false],
    ['export const leaked = 1;', true],
    ['import { make as alias } from "../storage/operation-codec.js"; export const leaked = alias();', true],
    ['import * as owner from "../storage/operation-codec.js"; export { owner };', true],
    ['export { make as leak } from "../storage/operation-codec.js";', true],
    ['import "../storage/operation-codec.js"; export interface Port {}', true],
    ['export enum RuntimeValue { Leaked }', true],
    ['export const load = (name: string) => import(name);', true],
  ];
  // Exercise both the directory-owned contracts and the exact-file facade.
  for (const file of ["src/ports/runtime.ts", "src/module-ports.ts"]) for (const [text, rejected] of cases) fixture({
    [file]: file === "src/module-ports.ts" ? text.replaceAll("../storage/", "./storage/") : text,
    "src/storage/operation-codec.ts": "export interface Fact { value: number; } export function make() { return 1; }",
    "src/domain/identifiers.ts": "export const legitimateRuntimeValue = 1;",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false }).filter(f => f.rule === "internal-port-runtime");
    assert.deepEqual(findings.map(f => f.file), rejected ? [file] : [], text);
    assert.equal(kernelZoneOf(file), null);
    assert.equal(isInternalPort("src/ports-extra/fake.ts"), false);
  });
});
test("P23 contract ownership forbids runtime, type, inline-import and re-export edges out of exact L0 contracts", () => {
  const target = "src/storage/value.ts";
  const negative = [
    ["src/ports/runtime.ts", 'import type { Value } from "../storage/value.js"; export interface Port { value: Value; }', "type"],
    ["src/ports/runtime.ts", 'export type { Value } from "../storage/value.js";', "type"],
    ["src/ports/runtime.ts", 'export interface Port { value: import("../storage/value.js").Value; }', "type"],
    ["src/ports/runtime.ts", 'import { value } from "../storage/value.js"; export const leaked = value;', "runtime"],
    ["src/module-ports.ts", 'export type { Value } from "./storage/value.js";', "type"],
  ];
  for (const [file, text, kind] of negative) fixture({ [file]: text, [target]: "export interface Value { value: string; }" }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graph });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === file && finding.reason.includes(target) && finding.reason.includes(`${kind} edge`)), `${file} ${kind} edge`);
  });
  fixture({
    "implementation/contracts.ts": 'import type { Value } from "../src/storage/value.js"; export interface Root { value: Value; }',
    [target]: "export interface Value { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graph });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "implementation/contracts.ts" && finding.reason.includes(target)), "implementation contracts must not reference storage implementation");
  }, ["src/**/*.ts", "implementation/contracts.ts"]);
  fixture({
    "implementation/contracts.ts": 'export interface Root { leaf: import("./contracts/leaf.js").Leaf; }',
    "implementation/contracts/leaf.ts": "export interface Leaf { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(contractOwnershipFindings(graph.edges), [], "contract-to-contract references remain valid");
  }, ["src/**/*.ts", "implementation/contracts.ts", "implementation/contracts/**/*.ts"]);
  fixture({
    "implementation/helper.ts": 'import type { Value } from "../src/storage/value.js"; export type Helper = Value;',
    [target]: "export interface Value { value: string; }",
  }, (root, program) => {
    const graph = graphFromProgram(program, { rootDir: root });
    assert.deepEqual(contractOwnershipFindings(graph.edges), [], "non-contract implementation files are not broad-prefix exemptions");
  }, ["src/**/*.ts", "implementation/**/*.ts"]);
});

test("P23 contract ownership exempts no contract -> implementation reference", () => {
  // The four frozen v1 aliases were migrated to contract-owned declarations, so
  // the allowlist is gone. Each former alias must now be reported, including
  // when it hides behind a rename or the public facade.
  for (const [file, target, name] of [
    ["implementation/contracts/module-contracts.ts", "src/store.ts", "Transaction"],
    ["implementation/contracts/host.ts", "src/domain/resources.ts", "ResourceLimits"],
    ["implementation/contracts/host.ts", "src/domain/limits.ts", "ProtocolLimits"],
    ["implementation/contracts/identity.ts", "src/domain/capabilities.ts", "Capability"],
  ]) {
    const specifier = `../../${target.replace(/\.ts$/, ".js")}`;
    const declaration = `export interface ${name} { value: string; }`;
    for (const reference of [
      `export type ${name} = import("${specifier}").${name};`,
      `export type Renamed = import("${specifier}").${name};`,
      `import type { ${name} } from "${specifier}"; export type Held = ${name};`,
    ]) fixture({ [file]: reference, [target]: declaration }, (root, program) => {
      const findings = analyzeProgram(program, { rootDir: root, checkContracts: false })
        .filter(finding => finding.rule === "contract-ownership");
      assert.deepEqual(findings.map(finding => finding.file), [file], `${file}: ${name}`);
    }, ["src/**/*.ts", "implementation/contracts/**/*.ts"]);
    // An internal port may not launder the same reference either.
    fixture({
      [target]: declaration,
      "src/ports/runtime.ts": `export type Leaked = import("${specifier}").${name};`,
    }, (root, program) => {
      const findings = analyzeProgram(program, { rootDir: root, checkContracts: false });
      assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "src/ports/runtime.ts"));
    }, ["src/**/*.ts", "implementation/contracts/**/*.ts"]);
  }
});

test("P23 the migrated vocabulary owners keep a two-way compile-time binding", () => {
  // The contract now declares the closed set and the runtime descriptor must
  // satisfy it. Dropping either side has to fail the build, not the gate.
  const read = file => readFileSync(new URL(file, root), "utf8");
  // A reference is an import specifier, not a mention in prose.
  const referencesImplementation = source =>
    /(?:import\s*\(\s*|from\s*)['"][^'"]*\.\.\/\.\.\/src\/[^'"]*['"]/.test(source);
  assert.match(read("implementation/contracts/identity.ts"), /export type Capability =\s*\n?\s*\| 'mail\.send'/);
  const withoutComments = file => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const file of ["implementation/contracts/identity.ts", "implementation/contracts/host.ts"])
    assert.ok(!referencesImplementation(withoutComments(file)), `${file} must not reference implementation`);
  // module-contracts.ts may still name the erased internal port owners, which
  // are contracts themselves, but never a concrete storage implementation.
  const ports = withoutComments("implementation/contracts/module-contracts.ts")
    .match(/['"][^'"]*\.\.\/\.\.\/src\/[^'"]*['"]/g) ?? [];
  for (const reference of ports)
    assert.match(reference, /src\/(module-ports|ports\/)/, `unexpected implementation reference ${reference}`);
  for (const [file, contractType] of [
    ["src/domain/capabilities.ts", "Capability"],
    ["src/domain/resources.ts", "ResourceLimits"],
    ["src/domain/limits.ts", "ProtocolLimits"],
  ]) {
    const source = read(file);
    assert.match(source, /implementation\/contracts\//, `${file} must bind to the contract owner`);
    assert.match(source, /\[Missing\w+\] extends \[never\]/, `${file} must assert exhaustiveness`);
    assert.ok(source.includes(contractType), `${file} must name ${contractType}`);
  }
});

test("P23 contract ports cannot hide the concrete Transaction alias behind the public contracts facade", () => {
  fixture({
    "src/ports/runtime.ts": "import type { Transaction } from \"../../implementation/contracts.js\"; export interface Port { transaction: Transaction; }",
    "implementation/contracts.ts": "export type { Transaction } from \"./contracts/module-contracts.js\";",
    "implementation/contracts/module-contracts.ts": "export type Transaction = import(\"../../src/store.js\").Transaction;",
    "src/store.ts": "export interface Transaction { commit(): void; }",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graphFromProgram(program, { rootDir: root }) });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "src/ports/runtime.ts"), "facade-imported Transaction must remain rejected");
  }, ["src/**/*.ts", "implementation/contracts.ts", "implementation/contracts/**/*.ts"]);
});
test("P23 hidden compatibility aliases cannot cross the canonical port boundary", () => {
  fixture({
    "src/ports/runtime.ts": "import type { HiddenTx } from \"../../implementation/contracts.js\"; export interface Port { transaction: HiddenTx; }",
    "implementation/contracts.ts": "export type { HiddenTx } from \"./contracts/module-contracts.js\";",
    "implementation/contracts/module-contracts.ts": "export type Transaction = import(\"../../src/store.js\").Transaction; export type HiddenTx = Transaction;",
    "src/store.ts": "export interface Transaction { commit(): void; }",
  }, (root, program) => {
    const findings = analyzeProgram(program, { rootDir: root, checkContracts: false, programGraph: graphFromProgram(program, { rootDir: root }) });
    assert.ok(findings.some(finding => finding.rule === "contract-ownership" && finding.file === "src/ports/runtime.ts"), "hidden aliases must not bypass the compatibility exception");
  }, ["src/**/*.ts", "implementation/contracts.ts", "implementation/contracts/**/*.ts"]);
});



test("P19 type coupling evidence reports structural reasons without approving or forbidding upward types", () => {
  const graph = graphFromProgram(createArchitectureProgram());
  const evidence = dependencyEvidence(graph).kernel;
  assert.equal(evidence.typeOnlyReview.mode, "report-only");
  assert.equal(evidence.typeOnlyReview.classificationsAreApproval, false);
  for (const port of ["src/module-ports.ts", "src/ports/ledger.ts", "src/ports/runtime.ts"])
    assert.ok(evidence.internalPortContracts.includes(port));
  const upward = evidence.typeOnlyReview.edges.filter(edge => edge.kernelUpward);
  assert.ok(upward.some(edge => edge.from === "src/protocol/operation-results.ts" && edge.to === "src/storage/operation-codec.ts" && edge.classification === "representation-relation"));
  for (const classification of ["compatibility-facade", "port-conformance", "internal-port-contract"])
    assert.ok(evidence.typeOnlyReview.edges.some(edge => edge.classification === classification), classification);
  assert.deepEqual(kernelFindings(graph), []);
  fixture({
    "src/protocol/receipt-codec.ts": 'import type { Row } from "../storage/rows.js"; export type View = Row;',
    "src/storage/rows.ts": 'export interface Row { value: string; }',
  }, (root, program) => {
    const extra = graphFromProgram(program, { rootDir: root });
    assert.ok(dependencyEvidence(extra).kernel.typeOnlyReview.edges.some(edge => edge.kernelUpward));
    assert.deepEqual(kernelFindings(extra), []); // No hidden type-direction gate.
  });
});
