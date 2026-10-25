/** P5 measurement tooling, not production runtime.
 *
 * One extractor produces the evidence graph and the architecture gate's
 * dependency lattice input, so the documented lattice and the enforced lattice
 * cannot drift apart. Nothing here executes production source.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { appTestSource } from "./check-modules.mjs";
import { LATTICE, layerOf } from "./dependency-lattice.mjs";
import { kernelEvidence } from "./kernel-zones.mjs";

const slash = (value) => value.split(path.sep).join("/");

/** A type-only specifier does not create a runtime dependency. Mixed
 * `import { type X, Y }` clauses stay runtime edges. */
export function referenceKind(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return "type";
    const bindings = clause?.namedBindings;
    if (
      !clause?.name &&
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((item) => item.isTypeOnly)
    )
      return "type";
    return "runtime";
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return "type";
    if (
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((item) => item.isTypeOnly)
    )
      return "type";
    return "runtime";
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  )
    return node.isTypeOnly ? "type" : "runtime";
  if (ts.isImportTypeNode(node)) return "type";
  return null;
}
export function moduleSpecifier(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    return node.moduleSpecifier ?? null;
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference)
  )
    return node.moduleReference.expression ?? null;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  return null;
}
function dynamicSpecifier(node) {
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))
  ) {
    const first = node.arguments[0];
    if (!first) return { text: null, literal: false };
    return ts.isStringLiteralLike(first)
      ? { text: first.text, literal: true }
      : { text: null, literal: false };
  }
  return null;
}
/** Runtime packaging deliberately ignores erased type imports but shares syntax classification. */
export function runtimeModuleReference(node) {
  if (referenceKind(node) === "runtime") return moduleSpecifier(node);
  if (dynamicSpecifier(node)) return node.arguments[0] ?? node;
  return null;
}

/** Analysis binds public workspace APIs to their one source definition. The
 * runtime and package builds still use ordinary package exports and artifacts;
 * no compiler paths or runtime aliases are installed. */
export function installWorkspaceSourceResolution(host, options, rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  host.resolveModuleNames = (names, from) => names.map(specifier => {
    if (specifier.startsWith("#oma-test/")) {
      const source = appTestSource(root, specifier, from);
      return source ? { resolvedFileName: path.resolve(root, source), extension: ts.Extension.Ts, isExternalLibraryImport: false } : undefined;
    }
    const workspace = /^@oma\/([a-z-]+)(?:\/(.+))?$/.exec(specifier);
    if (workspace) {
      const directory = path.join(root, ...(workspace[1] === "app" ? ["apps", "oma"] : ["packages", workspace[1]]));
      const manifestPath = path.join(directory, "package.json");
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const entry = manifest.exports?.[workspace[2] ? `./${workspace[2]}` : "."];
        if (!entry || typeof entry.types !== "string" || !/^\.\/dist\/.+\.d\.ts$/.test(entry.types)) return undefined;
        const source = path.resolve(directory, "src", entry.types.slice("./dist/".length).replace(/\.d\.ts$/, ".ts"));
        if (!source.startsWith(path.join(directory, "src") + path.sep) || !fs.existsSync(source)) return undefined;
        return { resolvedFileName: source, extension: ts.Extension.Ts, isExternalLibraryImport: false };
      }
    }
    return ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
  });
  return host;
}

/** Canonical production Program. Tests are checked by tsc, never evidence roots. */
export function createArchitectureProgram(
  rootDir = process.cwd(),
  configName,
) {
  const root = path.resolve(rootDir);
  const configPath = path.resolve(root, configName ?? (fs.existsSync(path.join(root, "tsconfig.architecture.json")) ? "tsconfig.architecture.json" : "tsconfig.json"));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
  );
  if (parsed.errors.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => root,
        getNewLine: () => "\n",
      }),
    );
  const options = { ...parsed.options, noEmit: true };
  return ts.createProgram({
    rootNames: parsed.fileNames.filter((file) =>
      isArchitectureSource(root, file),
    ),
    options,
    host: installWorkspaceSourceResolution(ts.createCompilerHost(options), options, root),
  });
}

function isArchitectureSource(root, file) {
  const name = slash(path.relative(root, file));
  return (
    name !== ".." &&
    !name.startsWith("../") &&
    !path.isAbsolute(name) &&
    !/(^|\/)(?:test|tests|node_modules)\//.test(name)
  );
}

export function architectureSources(program, rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  return program
    .getSourceFiles()
    .filter(
      (source) =>
        !source.isDeclarationFile &&
        isArchitectureSource(root, source.fileName),
    )
    .sort((a, b) =>
      a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
    );
}

/** Resolve local aliases as well as relative imports; packages remain external. */
export function resolveInternalModule(
  specifier,
  from,
  compilerOptions,
  rootDir,
) {
  const resolved = ts.resolveModuleName(
    specifier,
    from,
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  if (!resolved) return null;
  let target = slash(
    path.relative(path.resolve(rootDir), resolved.resolvedFileName),
  );
  if (/^(?:packages\/[^/]+|apps\/oma)\/dist\/.+\.d\.ts$/.test(target)) {
    const source = target.replace("/dist/", "/src/").replace(/\.d\.ts$/, ".ts");
    if (fs.existsSync(path.join(rootDir, source))) target = source;
  }
  return target === ".." ||
    target.startsWith("../") ||
    path.isAbsolute(target) ||
    /(^|\/)node_modules\//.test(target)
    ? null
    : target;
}

/** Static edges of one source file. `resolve` maps a specifier to a
 * repository-relative target or null when it leaves the repository. */
export function extractEdges({ source, resolve }) {
  const edges = [];
  const external = [];
  const unresolved = [];
  const visit = (node) => {
    const kind = referenceKind(node);
    const dynamic = dynamicSpecifier(node);
    const specifierNode = kind ? moduleSpecifier(node) : null;
    const record = (specifier, edgeKind, literal) => {
      if (!literal) {
        unresolved.push({ specifier, reason: "nonliteral" });
        return;
      }
      const target = resolve(specifier);
      if (!target) {
        if (specifier.startsWith("."))
          unresolved.push({ specifier, reason: "unresolved" });
        else external.push(specifier);
        return;
      }
      edges.push({
        to: target,
        kind: edgeKind,
        specifier,
        dynamic: dynamic !== null,
      });
    };
    if (kind && specifierNode && ts.isStringLiteralLike(specifierNode))
      record(specifierNode.text, kind, true);
    if (kind && specifierNode && !ts.isStringLiteralLike(specifierNode))
      record("", kind, false);
    if (dynamic && kind === null)
      record(dynamic.text ?? "", "runtime", dynamic.literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { edges, external, unresolved };
}

/** The same edges over an existing TypeScript program, so the gate and the
 * evidence file cannot use different extractors. */
export function graphFromProgram(program, { rootDir = process.cwd() } = {}) {
  const root = path.resolve(rootDir);
  const files = architectureSources(program, root).map((source) =>
    slash(path.relative(root, source.fileName)),
  );
  const included = new Set(files);
  const edges = [];
  const external = new Map();
  const unresolved = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const source =
      program.getSourceFile(absolute) ??
      ts.createSourceFile(
        absolute,
        fs.readFileSync(absolute, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
    const extracted = extractEdges({
      source,
      resolve: (specifier) =>
        resolveInternalModule(
          specifier,
          absolute,
          program.getCompilerOptions(),
          root,
        ),
    });
    for (const specifier of extracted.external)
      external.set(specifier, (external.get(specifier) ?? 0) + 1);
    for (const item of extracted.unresolved)
      unresolved.push({ from: file, ...item });
    for (const edge of extracted.edges)
      edges.push({ from: file, ...edge, included: included.has(edge.to) });
  }
  edges.sort((a, b) =>
    a.from + a.kind + a.to + a.specifier < b.from + b.kind + b.to + b.specifier
      ? -1
      : 1,
  );
  return {
    root: ".",
    files,
    edges,
    external: Object.fromEntries([...external].sort()),
    unresolved: unresolved.sort((a, b) =>
      a.from + a.specifier < b.from + b.specifier ? -1 : 1,
    ),
  };
}

/** Evidence and enforcement use the full Program closure, not tsconfig roots. */
export function collectDependencyGraph({
  rootDir = process.cwd(),
  program = createArchitectureProgram(rootDir),
} = {}) {
  return graphFromProgram(program, { rootDir });
}

/** Tarjan SCC over one edge kind ("runtime" excludes type-only edges). */
export function stronglyConnected(nodes, adjacency) {
  const index = new Map(),
    low = new Map(),
    onStack = new Set(),
    stack = [],
    groups = [];
  let counter = 0;
  const visit = (start) => {
    const work = [[start, [...(adjacency.get(start) ?? [])], 0]];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, children] = frame;
      if (frame[2] < children.length) {
        const child = children[frame[2]++];
        if (!index.has(child)) {
          index.set(child, counter);
          low.set(child, counter);
          counter++;
          stack.push(child);
          onStack.add(child);
          work.push([child, [...(adjacency.get(child) ?? [])], 0]);
        } else if (onStack.has(child))
          low.set(node, Math.min(low.get(node), index.get(child)));
        continue;
      }
      work.pop();
      if (low.get(node) === index.get(node)) {
        const group = [];
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          group.push(member);
          if (member === node) break;
        }
        groups.push(group.sort());
      }
      const parent = work[work.length - 1];
      if (parent)
        low.set(parent[0], Math.min(low.get(parent[0]), low.get(node)));
    }
  };
  for (const node of [...nodes].sort()) if (!index.has(node)) visit(node);
  return groups.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}
/** Include self-imports: a singleton with an edge to itself is still a cycle. */
export function cyclicComponents(nodes, adjacency) {
  return stronglyConnected(nodes, adjacency).filter(
    (group) => group.length > 1 || adjacency.get(group[0])?.has(group[0]),
  );
}

export function adjacencyOf(graph, kind) {
  const adjacency = new Map(graph.files.map((file) => [file, new Set()]));
  for (const edge of graph.edges) {
    if (kind !== "all" && edge.kind !== kind) continue;
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) continue;
    adjacency.get(edge.from).add(edge.to);
  }
  return adjacency;
}
export function summarize(graph) {
  const runtime = adjacencyOf(graph, "runtime");
  const all = adjacencyOf(graph, "all");
  const fanOut = {},
    fanIn = {};
  for (const file of graph.files) {
    fanOut[file] = runtime.get(file).size;
    fanIn[file] = 0;
  }
  for (const [, targets] of runtime)
    for (const target of targets) if (target in fanIn) fanIn[target]++;
  const cycles = cyclicComponents(graph.files, runtime);
  const typeCycles = cyclicComponents(graph.files, all);
  return {
    files: graph.files.length,
    runtimeEdges: graph.edges.filter(
      (edge) => edge.kind === "runtime" && edge.included,
    ).length,
    typeOnlyEdges: graph.edges.filter(
      (edge) => edge.kind === "type" && edge.included,
    ).length,
    unresolved: graph.unresolved,
    external: graph.external,
    runtimeCycles: cycles,
    typeCycles,
    fanIn: Object.fromEntries(
      Object.entries(fanIn)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    ),
    fanOut: Object.fromEntries(
      Object.entries(fanOut)
        .filter(([, value]) => value > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
    ),
  };
}

/** Deterministic evidence summary. The gate compares this exact object, so a
 * documentation claim about the lattice cannot survive a source change. */
export function dependencyEvidence(graph, layers = LATTICE) {
  const adjacency = (kind) => adjacencyOf(graph, kind);
  const runtimeCycles = cyclicComponents(graph.files, adjacency("runtime"));
  const unionCycles = cyclicComponents(graph.files, adjacency("all"));
  const matrix = {};
  const upwardTypeEdges = [];
  const fanIn = {},
    fanOut = {};
  for (const file of graph.files) {
    fanIn[file] = 0;
    fanOut[file] = 0;
  }
  for (const edge of graph.edges) {
    if (!edge.included) continue;
    const from = layerOf(edge.from, layers),
      to = layerOf(edge.to, layers);
    if (from && to) {
      if (edge.kind === "runtime") {
        const key = `${from.name} -> ${to.name}`;
        matrix[key] = (matrix[key] ?? 0) + 1;
        fanOut[edge.from]++;
        fanIn[edge.to]++;
      } else if (from.index < to.index)
        upwardTypeEdges.push({ from: edge.from, to: edge.to });
    }
  }
  const top = (table) =>
    Object.entries(table)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 15);
  return {
    sourceFiles: [...graph.files],
    kernel: kernelEvidence(graph, {
      runtime: runtimeCycles,
      union: unionCycles,
    }),
    layers: layers.map((layer, index) => ({
      index,
      name: layer.name,
      prefixes: [...layer.prefixes],
      files: graph.files.filter(
        (file) => layerOf(file, layers)?.index === index,
      ).length,
    })),
    files: graph.files.length,
    runtimeEdges: graph.edges.filter(
      (edge) => edge.kind === "runtime" && edge.included,
    ).length,
    typeOnlyEdges: graph.edges.filter(
      (edge) => edge.kind === "type" && edge.included,
    ).length,
    runtimeEdgeMatrix: Object.fromEntries(
      Object.entries(matrix).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    upwardTypeOnlyEdges: upwardTypeEdges.sort((a, b) =>
      a.from + a.to < b.from + b.to ? -1 : 1,
    ),
    runtimeCycles: runtimeCycles.map((group) => [...group].sort()),
    unionCycles: unionCycles.map((group) => [...group].sort()),
    fanIn: Object.fromEntries(top(fanIn).map(([file, count]) => [file, count])),
    fanOut: Object.fromEntries(
      top(fanOut).map(([file, count]) => [file, count]),
    ),
    external: graph.external,
    unresolved: graph.unresolved,
  };
}
export const EVIDENCE_PATH =
  "implementation/evidence/dependency-graph.json";
export function evidenceFor(rootDir = process.cwd()) {
  return dependencyEvidence(collectDependencyGraph({ rootDir }));
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href
) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const rootDir =
    rootIndex < 0 ? process.cwd() : path.resolve(args[rootIndex + 1]);
  if (args.includes("--write-evidence")) {
    const target = path.join(rootDir, EVIDENCE_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      JSON.stringify(evidenceFor(rootDir), null, 1) + "\n",
    );
    console.log(`wrote ${EVIDENCE_PATH}`);
    process.exit(0);
  }
  const graph = collectDependencyGraph({ rootDir });
  if (args.includes("--edges"))
    console.log(JSON.stringify(graph.edges, null, 1));
  else if (args.includes("--summary"))
    console.log(JSON.stringify(summarize(graph), null, 1));
  else if (args.includes("--evidence"))
    console.log(JSON.stringify(dependencyEvidence(graph), null, 1));
  else console.log(JSON.stringify(graph, null, 1));
}
