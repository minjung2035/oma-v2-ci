/** Project-specific static gates. Passing is not a proof of runtime/crash safety. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { resolveExportDeclaration } from "./contract-surface.mjs";
import { DEFAULT_POLICY, pureBoundaryViolation } from "./architecture-owners.mjs";
import { EVIDENCE_PATH, collectDependencyGraph, dependencyEvidence, graphFromProgram } from "./dependency-graph.mjs";
import { cycleFindings, latticeFindings } from "./dependency-lattice.mjs";
export { DEFAULT_POLICY } from "./architecture-owners.mjs";

const slash = value => value.split(path.sep).join("/");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const relative = (root, file) => slash(path.relative(root, file));
const isTest = file => /(^|\/)(?:test|tests)\//.test(file);
const EFFECT_MODULES = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises", "node:child_process", "child_process", "node:sqlite", "node:net", "node:process", "process", "koffi"]);
const SPAWN_MODULES = new Set(["node:child_process", "child_process"]);
const SQLITE_MODULES = new Set(["node:sqlite", "sqlite", "better-sqlite3"]);

/** Explicit type-only specifiers do not create runtime dependencies. */
export function runtimeModuleReference(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return null;
    const bindings = clause?.namedBindings;
    if (!clause?.name && bindings && ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)) return null;
    return node.moduleSpecifier;
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return null;
    if (node.exportClause && ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly)) return null;
    return node.moduleSpecifier ?? null;
  }
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require"))) return node.arguments[0] ?? node;
  return null;
}

/** Shared by the release report and this gate; never updates evidence on import. */
export function runtimeImportClosure({ rootDir = process.cwd(), roots, manifest, compilerOptions }) {
  const root = path.resolve(rootDir);
  const listed = new Set(manifest);
  const reachable = new Set();
  const external = new Set();
  const findings = [];
  const graph = new Map();
  const visit = file => {
    file = slash(file);
    if (reachable.has(file)) return;
    reachable.add(file);
    graph.set(file, new Set());
    if (!listed.has(file)) findings.push(`Runtime import outside production manifest: ${file}`);
    if (isTest(file)) findings.push(`Production imports a test: ${file}`);
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute)) { findings.push(`Missing runtime source: ${file}`); return; }
    const source = ts.createSourceFile(absolute, fs.readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true);
    const walk = node => {
      const value = runtimeModuleReference(node);
      if (value) {
        if (!ts.isStringLiteralLike(value)) findings.push(`Nonliteral runtime import: ${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
        else if (!value.text.startsWith(".")) external.add(value.text);
        else {
          const resolved = ts.resolveModuleName(value.text, absolute, compilerOptions, ts.sys).resolvedModule;
          if (!resolved) findings.push(`Unresolved runtime import: ${file} -> ${value.text}`);
          else {
            const target = relative(root, resolved.resolvedFileName);
            graph.get(file).add(target);
            visit(target);
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  roots.forEach(visit);
  return { reachable, external, findings, graph };
}

export function createArchitectureProgram(rootDir, configName = "tsconfig.json") {
  const root = path.resolve(rootDir);
  const configPath = path.resolve(root, configName);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
}

function eachNode(node, visit) { visit(node); ts.forEachChild(node, child => eachNode(child, visit)); }
function propertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : null;
}
function declaredName(node) { return node.name ? propertyName(node.name) : null; }
function strip(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}
function underlyingSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}
function importModule(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isImportDeclaration(current) && ts.isStringLiteralLike(current.moduleSpecifier)) return current.moduleSpecifier.text;
    if (ts.isImportEqualsDeclaration(current) && ts.isExternalModuleReference(current.moduleReference)) {
      const value = current.moduleReference.expression;
      if (value && ts.isStringLiteralLike(value)) return value.text;
    }
  }
  return null;
}
function callModule(checker, expression) {
  const names = [expression];
  if (ts.isPropertyAccessExpression(expression)) names.push(expression.expression, expression.name);
  for (const name of names) {
    const symbol = checker.getSymbolAtLocation(name);
    for (const declaration of symbol?.declarations ?? []) {
      const module = importModule(declaration);
      if (module) return module;
    }
  }
  return null;
}
function booleanUse(node) {
  let current = node;
  while (current.parent && (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isNonNullExpression(current.parent))) current = current.parent;
  const parent = current.parent;
  if (!parent) return false;
  if (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) return true;
  if ((ts.isIfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isConditionalExpression(parent)) && parent.expression === current) return true;
  if (ts.isForStatement(parent) && parent.condition === current) return true;
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) return true;
    const other = parent.left === current ? parent.right : parent.left;
    if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(operator) &&
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(strip(other).kind)) return true;
  }
  return ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "Boolean";
}
function isNativeSetAdd(checker, call) {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  return declaration && declaredName(declaration) === "add" &&
    ts.isInterfaceDeclaration(declaration.parent) && declaration.parent.name.text === "Set" &&
    /[\\/]lib\.[^\\/]*\.d\.ts$/.test(declaration.getSourceFile().fileName);
}
function isThenable(checker, type) {
  return Boolean(type && checker.getPropertyOfType(type, "then"));
}
function callableBody(checker, expression, seen = new Set()) {
  expression = strip(expression);
  if (!expression) return null;
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression;
  const symbol = underlyingSymbol(checker, ts.isPropertyAccessExpression(expression) ? expression.name : expression);
  if (!symbol || seen.has(symbol)) return null;
  seen.add(symbol);
  for (const declaration of symbol.declarations ?? []) {
    if ((ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) && declaration.body) return declaration;
    if ((ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) && declaration.initializer) {
      const result = callableBody(checker, declaration.initializer, seen);
      if (result) return result;
    }
  }
  return null;
}
function comesFromJsonParse(checker, expression, seen = new Set()) {
  expression = strip(expression);
  if (!expression) return false;
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "parse" && ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "JSON") return true;
  const symbol = underlyingSymbol(checker, expression);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  return (symbol.declarations ?? []).some(declaration => ts.isVariableDeclaration(declaration) &&
    declaration.initializer && comesFromJsonParse(checker, declaration.initializer, seen));
}
function containsPlanType(typeNode) {
  let found = false;
  if (typeNode) eachNode(typeNode, node => {
    if (ts.isTypeReferenceNode(node) && propertyName(node.typeName) === "OperationPlan") found = true;
  });
  return found;
}
function stronglyConnected(graph) {
  let next = 0;
  const indices = new Map(), low = new Map(), active = new Set(), stack = [], groups = [];
  const visit = node => {
    indices.set(node, next); low.set(node, next++); stack.push(node); active.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!graph.has(target)) continue;
      if (!indices.has(target)) { visit(target); low.set(node, Math.min(low.get(node), low.get(target))); }
      else if (active.has(target)) low.set(node, Math.min(low.get(node), indices.get(target)));
    }
    if (low.get(node) === indices.get(node)) {
      const group = [];
      let member;
      do { member = stack.pop(); active.delete(member); group.push(member); } while (member !== node);
      if (group.length > 1 || graph.get(node)?.has(node)) groups.push(group.sort());
    }
  };
  for (const node of graph.keys()) if (!indices.has(node)) visit(node);
  return groups;
}

/** Analyze actual syntax and resolved symbols, not comments or identifier-name grep. */
export function analyzeProgram(program, { rootDir = process.cwd(), policy = DEFAULT_POLICY, checkContracts = true } = {}) {
  const root = path.resolve(rootDir), checker = program.getTypeChecker();
  const sources = program.getSourceFiles().filter(source => {
    const file = relative(root, source.fileName);
    return !source.isDeclarationFile && !file.startsWith("../") && !file.includes("node_modules/") && !isTest(file);
  });
  const declarations = new Map(), graph = new Map(), findings = [], reported = new Set();
  const sourceByFile = new Map(sources.map(source => [relative(root, source.fileName), source]));
  const report = (rule, node, reason) => {
    const source = node.getSourceFile();
    const start = node.getStart(source), position = source.getLineAndCharacterOfPosition(start);
    const file = relative(root, source.fileName), key = `${rule}:${file}:${start}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({ rule, file, line: position.line + 1, column: position.character + 1,
      sourceHash: digest(source.text), snippetHash: digest(node.getText(source)), reason });
  };
  for (const source of sources) {
    graph.set(relative(root, source.fileName), new Set());
    eachNode(source, node => {
      if ((ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && declaredName(node)) {
        const list = declarations.get(declaredName(node)) ?? [];
        list.push(node); declarations.set(declaredName(node), list);
      }
    });
  }
  const canonicalDeclaration = (name, owner) =>
    declarations.get(name)?.find(node => !owner || relative(root, node.getSourceFile().fileName) === owner) ??
    (owner ? resolveExportDeclaration(checker, sourceByFile.get(owner), name) : undefined);
  const stringsInOwner = owner => {
    const values = new Set();
    const source = sourceByFile.get(owner);
    if (source) eachNode(source, node => { if (ts.isStringLiteralLike(node) && node.text.includes(".")) values.add(node.text); });
    return values;
  };
  const capabilities = stringsInOwner(policy.capabilityOwner);
  const methods = new Set([...(canonicalDeclaration("PUBLIC_METHODS", policy.methodOwner) ? checker.getPropertiesOfType(checker.getTypeAtLocation(canonicalDeclaration("PUBLIC_METHODS", policy.methodOwner))) : []),
    ...(canonicalDeclaration("INTERNAL_METHODS", policy.methodOwner) ? checker.getPropertiesOfType(checker.getTypeAtLocation(canonicalDeclaration("INTERNAL_METHODS", policy.methodOwner))) : [])].map(symbol => symbol.name));
  const fieldsOf = name => {
    const declaration = canonicalDeclaration(name, "implementation/contracts.ts");
    return new Set(declaration ? checker.getPropertiesOfType(checker.getTypeAtLocation(declaration)).map(symbol => symbol.name) : []);
  };
  const resourceFields = fieldsOf("ResourceLimits"), limitFields = fieldsOf("ProtocolLimits");
  const idPatterns = new Set();
  const idSource = sourceByFile.get(policy.identifierOwner);
  if (idSource) eachNode(idSource, node => { if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) idPatterns.add(node.text); });

  const inspectTransaction = (transaction, callback) => {
    const visited = new Set();
    const rootSource = transaction.getSourceFile();
    const origin = `${relative(root, rootSource.fileName)}:${rootSource.getLineAndCharacterOfPosition(transaction.getStart(rootSource)).line + 1}`;
    const inspectFunction = fn => {
      if (!fn || visited.has(fn) || fn.getSourceFile().isDeclarationFile) return;
      visited.add(fn);
      if (fn.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) report("transaction-await", fn, `Async transaction closure from ${origin}`);
      for (const signature of checker.getTypeAtLocation(fn).getCallSignatures())
        if (isThenable(checker, checker.getReturnTypeOfSignature(signature))) report("transaction-thenable", fn, `Thenable transaction closure from ${origin}`);
      const walk = node => {
        if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node))) return;
        if (ts.isAwaitExpression(node)) report("transaction-await", node, `Await in transaction call closure from ${origin}`);
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          const module = callModule(checker, node.expression);
          if (module && (EFFECT_MODULES.has(module) || SPAWN_MODULES.has(module))) report("transaction-effect", node, `${module} effect in transaction closure from ${origin}`);
          const signature = checker.getResolvedSignature(node);
          if (signature && isThenable(checker, checker.getReturnTypeOfSignature(signature))) report("transaction-thenable", node, `Thenable call in transaction closure from ${origin}`);
          inspectFunction(callableBody(checker, node.expression));
          for (const argument of node.arguments ?? []) inspectFunction(callableBody(checker, argument));
        }
        ts.forEachChild(node, walk);
      };
      if (fn.body) walk(fn.body);
    };
    inspectFunction(callableBody(checker, callback));
  };

  for (const source of sources) {
    const file = relative(root, source.fileName);
    eachNode(source, node => {
      const reference = runtimeModuleReference(node);
      if (reference) {
        if (!ts.isStringLiteralLike(reference)) report("dynamic-import", node, "Nonliteral runtime import cannot be included in the verified closure");
        else {
          const specifier = reference.text;
          const resolved = specifier.startsWith(".") ? ts.resolveModuleName(specifier, source.fileName, program.getCompilerOptions(), ts.sys).resolvedModule : null;
          const target = resolved ? relative(root, resolved.resolvedFileName) : null;
          if (target) graph.get(file).add(target);
          if ((target && isTest(target)) || isTest(specifier)) report("production-test-import", node, `Production depends on test source ${target ?? specifier}`);
          if (pureBoundaryViolation(file, specifier, target, EFFECT_MODULES, policy))
            report("pure-boundary-import", node, `Pure codec/domain imports an effect owner outside its declared transport role: ${specifier}`);
          if (SQLITE_MODULES.has(specifier) && !policy.sqliteOwners.includes(file)) report("sqlite-owner", node, "Raw SQLite is outside its concrete storage owner");
          if (SPAWN_MODULES.has(specifier) && !policy.subprocessOwners.includes(file)) report("subprocess-owner", node, "Raw child_process is outside the process runner owner");
        }
      }
      if (ts.isCallExpression(node) && isNativeSetAdd(checker, node) && booleanUse(node))
        report("set-add-membership", node, "Set.add returns the Set, not a membership/insertion boolean; use has before add");
      if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && containsPlanType(node.type) && comesFromJsonParse(checker, node.expression))
        report("persisted-plan-cast", node, "Persisted JSON must go through the plan decoder and relation checks");
      if (ts.isVariableDeclaration(node) && containsPlanType(node.type) && node.initializer && comesFromJsonParse(checker, node.initializer))
        report("persisted-plan-cast", node, "A type annotation does not decode persisted JSON");
      if (node.kind === ts.SyntaxKind.RegularExpressionLiteral && file !== policy.identifierOwner &&
        idPatterns.has(node.text) && !policy.identifierMirrors?.[file])
        report("duplicate-id-schema", node, "Executable identifier grammar duplicates the canonical owner");
      if (ts.isArrayLiteralExpression(node)) {
        const values = node.elements.filter(ts.isStringLiteralLike).map(value => value.text);
        const parent = strip(node.parent);
        const concreteGrant = ts.isPropertyAssignment(node.parent) && ["capabilities", "delegable"].includes(propertyName(node.parent.name));
        if (!concreteGrant && file !== policy.capabilityOwner && values.length >= 3 && values.every(value => capabilities.has(value)))
          report("duplicate-capability-schema", node, "Executable capability vocabulary duplicates the canonical owner");
        if (file !== policy.methodOwner && values.length >= 3 && values.every(value => methods.has(value)))
          report("duplicate-method-schema", node, "Executable wire method list duplicates the protocol descriptor table");
        void parent;
      }
      if (ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment);
        const schemaProperties = properties.filter(property => {
          const value = strip(property.initializer);
          return checker.getTypeAtLocation(value).getCallSignatures().length > 0 ||
            (ts.isCallExpression(value) && /^check/.test(propertyName(value.expression) ?? "")) ||
            (ts.isObjectLiteralExpression(value) && value.properties.some(item => propertyName(item.name) === "minInclusive"));
        });
        const keys = schemaProperties.map(property => propertyName(property.name));
        if (keys.length >= 3 && file !== policy.resourceOwner && keys.every(key => resourceFields.has(key)))
          report("duplicate-resource-schema", node, "Executable resource schema duplicates its field table");
        if (keys.length >= 3 && file !== policy.limitOwner && keys.every(key => limitFields.has(key)))
          report("duplicate-limit-schema", node, "Executable protocol limit schema duplicates its field table");
      }
      if (ts.isCallExpression(node)) {
        const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : propertyName(node.expression);
        if (["rawRequestHash", "requestHashRaw", "uncheckedRequestHash"].includes(name))
          report("raw-request-hash", node, "Requests must use the canonical identity builder");
        if (name === "canonicalJson" && file !== policy.identityOwner && node.arguments.some(argument => {
          const value = strip(argument);
          return ts.isObjectLiteralExpression(value) && ["method", "params"].every(key => value.properties.some(property => propertyName(property.name) === key));
        })) report("raw-request-hash", node, "Request-domain bytes are owned by buildRequestIdentity, not an independent canonical JSON call");
        if (name === "transaction" && node.arguments[0] && ts.isPropertyAccessExpression(node.expression)) {
          const receiver = checker.getTypeAtLocation(node.expression.expression);
          const signature = checker.getResolvedSignature(node)?.declaration;
          const storeLike = checker.getPropertyOfType(receiver, "claimOperation") ||
            (signature?.parent && declaredName(signature.parent) === "Store");
          if (storeLike) inspectTransaction(node, node.arguments[0]);
        }
      }
    });
  }
  for (const group of stronglyConnected(graph)) report("runtime-import-cycle", sourceByFile.get(group[0]), `Runtime import SCC: ${group.join(" -> ")}`);

  // P5: the measured dependency lattice. Runtime edges may only point into the
  // same or a more fundamental layer. Type-only references are erased at runtime
  // and are evidence, but they may not form an import cycle.
  const programGraph = graphFromProgram(program, { rootDir: root });
  const production = new Set(programGraph.files.filter(file => file.startsWith("src/") || file.startsWith("implementation/")));
  const latticeEdges = programGraph.edges.filter(edge => production.has(edge.from) && production.has(edge.to) && edge.included);
  const anchor = sources[0] ?? program.getSourceFiles()[0];
  for (const finding of latticeFindings(latticeEdges, [...production].sort()))
    report(finding.rule, sourceByFile.get(finding.file) ?? anchor, finding.reason);
  const unionAdjacency = new Map([...production].sort().map(file => [file, new Set()]));
  const productionRuntime = new Map([...production].sort().map(file => [file, new Set()]));
  const runtimeSelfLoop = new Set();
  for (const edge of latticeEdges) {
    unionAdjacency.get(edge.from).add(edge.to);
    if (edge.kind === "runtime") { productionRuntime.get(edge.from).add(edge.to); if (edge.from === edge.to) runtimeSelfLoop.add(edge.from); }
  }
  const runtimeGroups = new Set(stronglyConnected(productionRuntime)
    .filter(group => group.length > 1 || runtimeSelfLoop.has(group[0])).map(group => group.join("\0")));
  const unionGroups = stronglyConnected(unionAdjacency)
    .filter(group => group.length > 1 || unionAdjacency.get(group[0]).has(group[0]))
    .filter(group => !runtimeGroups.has(group.join("\0")));
  for (const finding of cycleFindings(unionGroups))
    report(finding.rule, sourceByFile.get(finding.file) ?? anchor, finding.reason);

  if (checkContracts && sources.length) {
    const fallback = sources[0];
    const compareKeys = (tableName, typeName) => {
      const table = canonicalDeclaration(tableName, policy.methodOwner);
      const contract = canonicalDeclaration(typeName, "implementation/contracts.ts");
      if (!table || !contract) { report("method-exhaustiveness", table ?? fallback, `Missing ${tableName} or ${typeName}`); return; }
      const actual = checker.getPropertiesOfType(checker.getTypeAtLocation(table)).map(symbol => symbol.name).sort();
      const expected = checker.getPropertiesOfType(checker.getTypeAtLocation(contract)).map(symbol => symbol.name).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) report("method-exhaustiveness", table, `${tableName} differs from ${typeName}`);
    };
    compareKeys("PUBLIC_METHODS", "PublicMethods");
    compareKeys("INTERNAL_METHODS", "InternalMethods");
    const plan = canonicalDeclaration("OperationPlan", "implementation/contracts.ts");
    const registry = canonicalDeclaration("OPERATION_CODECS");
    const kinds = new Set();
    let closedPlan = Boolean(plan);
    if (plan) {
      const type = checker.getTypeAtLocation(plan);
      for (const member of type.isUnion() ? type.types : [type]) {
        const kind = checker.getPropertyOfType(member, "kind");
        if (!kind) { closedPlan = false; continue; }
        const kindType = checker.getTypeOfSymbolAtLocation(kind, plan);
        for (const value of kindType.isUnion() ? kindType.types : [kindType]) {
          if (value.isStringLiteral()) kinds.add(value.value);
          else closedPlan = false;
        }
      }
    }
    if (!closedPlan || kinds.size === 0 || !registry)
      report("operation-exhaustiveness", registry ?? plan ?? fallback, "A nonempty closed OperationPlan kind set and OPERATION_CODECS registry are required");
    if (registry) {
      const entries = checker.getPropertiesOfType(checker.getTypeAtLocation(registry));
      if (JSON.stringify(entries.map(entry => entry.name).sort()) !== JSON.stringify([...kinds].sort()))
        report("operation-exhaustiveness", registry, "Operation decoder keys differ from OperationPlan kinds");
      for (const entry of entries) {
        const type = checker.getTypeOfSymbolAtLocation(entry, registry);
        for (const field of ["planCheck", "resultCheck", "relationsCheck"]) {
          const member = checker.getPropertyOfType(type, field);
          if (!member || checker.getTypeOfSymbolAtLocation(member, registry).getCallSignatures().length === 0)
            report("operation-exhaustiveness", entry.valueDeclaration ?? registry, `${entry.name} lacks callable ${field}`);
        }
      }
    }
  }
  return findings;
}

/** No wildcard/line-only exemptions. Every exception is invalidated by source edits. */
export function applyExactBaseline(findings, baseline = []) {
  const allowed = ["rule", "file", "line", "column", "sourceHash", "snippetHash", "reason", "removeIn"];
  const unused = new Set(baseline);
  for (const item of baseline) {
    if (!item || Object.keys(item).some(key => !allowed.includes(key)) || allowed.some(key => !Object.hasOwn(item, key)) ||
      typeof item.file !== "string" || /[*?]/.test(item.file) || !Number.isInteger(item.line) || !Number.isInteger(item.column) ||
      !/^[0-9a-f]{64}$/.test(item.sourceHash) || !/^[0-9a-f]{64}$/.test(item.snippetHash) ||
      typeof item.reason !== "string" || item.reason.trim().length === 0 || !/^R\d{2}$/.test(item.removeIn)) throw new Error("Invalid or wildcard architecture baseline exception");
  }
  const active = findings.filter(finding => {
    const match = baseline.find(item => ["rule", "file", "line", "column", "sourceHash", "snippetHash"].every(key => item[key] === finding[key]));
    if (!match) return true;
    unused.delete(match);
    return false;
  });
  for (const item of unused) active.push({ ...item, rule: "stale-baseline", reason: `Unused or changed exception scheduled for ${item.removeIn}` });
  return active;
}

/** The checked-in lattice evidence is generated, never hand-written. It is
 * compared by the same extractor, so a documented lattice cannot outlive the
 * source it describes. */
function evidenceFreshnessFindings(root) {
  const target = path.join(root, EVIDENCE_PATH);
  if (!fs.existsSync(path.join(root, "docs/architecture-improvement"))) return [];
  const current = dependencyEvidence(collectDependencyGraph({ rootDir: root }));
  const recorded = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (recorded === JSON.stringify(current, null, 1) + "\n") return [];
  return [{ rule: "dependency-evidence-stale", file: EVIDENCE_PATH, line: 1, column: 1,
    sourceHash: digest(recorded), snippetHash: digest(JSON.stringify(current)),
    reason: "P5 lattice evidence differs from the current import graph; run npm run evidence:graph" }];
}

export function runArchitectureCheck(rootDir = process.cwd(), baseline = []) {
  const root = path.resolve(rootDir), program = createArchitectureProgram(root);
  const findings = [...analyzeProgram(program, { rootDir: root }), ...evidenceFreshnessFindings(root)];
  const compiler = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error);
  const manifestPath = path.join(root, "production-files.txt");
  const manifest = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  const closure = runtimeImportClosure({ rootDir: root, manifest, compilerOptions: program.getCompilerOptions(),
    roots: ["src/entry/broker.ts", "src/entry/runner.ts", "src/entry/host.ts", "src/cli.ts", "src/pi-extension.ts"] });
  return { findings: applyExactBaseline(findings, baseline), compiler, closure };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
    const baselinePath = value("--baseline");
    const baseline = baselinePath ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
    const result = runArchitectureCheck(value("--root") ?? process.cwd(), baseline);
    for (const finding of result.findings) console.error(`${finding.file}:${finding.line}:${finding.column} [${finding.rule}] ${finding.reason}`);
    for (const message of result.closure.findings) console.error(`[runtime-closure] ${message}`);
    for (const diagnostic of result.compiler) console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    if (args.includes("--json")) console.log(JSON.stringify(result.findings, null, 2));
    const count = result.findings.length + result.compiler.length + result.closure.findings.length;
    console.log(`Architecture gate: ${count ? "FAIL" : "PASS"}; ${count} findings. Static coverage is not runtime proof.`);
    process.exitCode = count ? 1 : 0;
  } catch (error) {
    console.error(`Architecture gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}