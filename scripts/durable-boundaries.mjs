/** P0-7 (docs/PRIORITY-0.md): the durable boundaries of the product, taken from the
 * code, and the kill/retry/restart tests that stand behind each one.
 *
 * A boundary is a production function that makes a fact durable: a Store
 * transaction, an immutable or derived file publication, a Git CAS, a
 * configuration commit, a receipt publication, or the removal of what nothing
 * accepted owns. The list is not written by hand: every call of a durable
 * primitive outside the primitives' own modules is found in the AST, and the
 * function around it is the boundary's owner. The registry
 * (implementation/durable-boundaries.json) names, for every owner, the tests
 * that stop the process right after the boundary, retry the same request or
 * restart, and check that what was made durable means what it meant. A new
 * boundary without such a test, a registered owner that no longer exists, or a
 * named test that does not exist is a finding. */
import ts from "typescript";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PRIMITIVES = Object.freeze({
  transaction: "db-commit",
  publishImmutableFile: "file-publication", replaceDerivedFile: "file-publication", writeAtomic: "file-publication",
  publishNoReplace: "file-publication", publishUserFile: "file-publication", replaceUserFile: "file-publication",
  writeExclusiveFsyncedFile: "file-publication", writeFsynced: "file-publication", writeExclusiveFsyncedEntry: "file-publication",
  publishStagedDirectory: "file-publication", replaceDerivedSymlink: "file-publication", publishBatchView: "file-publication",
  publishContextRevision: "file-publication", publishProjectBinding: "file-publication",
  prepareSubmitSpool: "file-publication", prepareContextStream: "file-publication",
  publishDeliveryReceipt: "receipt",
  appendMailArrival: "file-publication", publishInboxMessage: "file-publication",
  publishImmutableEntry: "file-publication", publishMailArchive: "file-publication", freezeMailObject: "file-publication",
  commitManagedGeneration: "config-commit", commitInlineConfiguration: "config-commit", createInlineConfiguration: "config-commit",
  authorizeCanonicalNoop: "git-cas", compareAndSwapCanonicalRef: "git-cas", createCanonicalRef: "git-cas", casRef: "git-cas", compareAndSwap: "git-cas", publishRef: "git-cas",
  removeOwnedTree: "collection", removeOwnedEntryAt: "collection", removeOwnedFile: "collection", collectLeasedTree: "collection",
});
/** The primitives' own modules: their internal calls are the mechanism, not boundaries. */
export const PRIMITIVE_MODULES = Object.freeze([
  "packages/storage/src/store.ts", "packages/storage/src/transaction.ts", "packages/storage/src/transitions.ts", "packages/storage/src/operation-transitions.ts",
  "packages/storage/src/operation-journal.ts", "packages/storage/src/durable-fs.ts", "packages/storage/src/immutable-file.ts", "packages/storage/src/staged-tree.ts",
  "packages/native/src/files.ts", "packages/storage/src/directory.ts", "packages/storage/src/delivery-receipt.ts", "packages/storage/src/context-snapshot.ts",
  "packages/storage/src/mailbox.ts", // held mailbox physical operations; Mail owns the decisions
  "packages/storage/src/submit-spool.ts", "packages/storage/src/context-stream.ts", "packages/storage/src/batch-view.ts", "packages/config/src/generations.ts",
  "packages/git/src/canonical-command.ts", "packages/storage/src/tree-lease.ts", "apps/oma/src/runtime/user-files.ts",
]);

function calleeName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}
function ownerOf(node, source) {
  for (let at = node.parent; at; at = at.parent) {
    if ((ts.isMethodDeclaration(at) || ts.isGetAccessorDeclaration(at) || ts.isConstructorDeclaration(at)) && ts.isClassLike(at.parent))
      return `${at.parent.name?.text ?? "(class)"}.${ts.isConstructorDeclaration(at) ? "constructor" : at.name.getText(source)}`;
    if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name) && at.initializer &&
        (ts.isArrowFunction(at.initializer) || ts.isFunctionExpression(at.initializer)) && ts.isSourceFile(at.parent.parent.parent))
      return at.name.text;
  }
  return "(module)";
}
/** Vendored bundled-extension payloads are upstream source kept byte-exact
 * under their own integrity regime: their internal calls name upstream's
 * own primitives (an upstream `writeAtomic` is not OMA's storage
 * `writeAtomic`), and under OMA the durable effects route through the
 * adapter's contained seams — the boundary owner is the adapter plus the
 * shared contained writer, which the registry and its tests cover. */
import { isVendoredExtension } from "./architecture/rules/shared.mjs";

/** Every production call of a durable primitive, grouped by the function around it. */
export function durableBoundaries(root = process.cwd()) {
  const files = readFileSync(join(root, "production-files.txt"), "utf8").split("\n")
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts") && !isVendoredExtension(file));
  const owners = new Map();
  for (const file of files) {
    if (PRIMITIVE_MODULES.includes(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    // P0V-59: a primitive imported under another name is still that primitive;
    // an alias must not hide a boundary from this gate.
    const aliases = new Map();
    for (const statement of source.statements)
      if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings))
        for (const element of statement.importClause.namedBindings.elements)
          if (element.propertyName) aliases.set(element.name.text, element.propertyName.text);
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const called = calleeName(node.expression);
        const name = aliases.get(called) ?? called;
        if (Object.hasOwn(PRIMITIVES, name)) {
          const key = `${file}#${ownerOf(node, source)}`;
          const entry = owners.get(key) ?? { owner: key, kinds: new Set() };
          entry.kinds.add(PRIMITIVES[name]); owners.set(key, entry);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...owners.values()].map(entry => ({ owner: entry.owner, kinds: [...entry.kinds].sort() })).sort((a, b) => a.owner.localeCompare(b.owner));
}
/** P0V-83, R6-08: how a test stops the boundary's process, which the registry
 * states for every test it names and this gate checks against the test's code.
 * - `sigkill`: a real process is killed with SIGKILL at the boundary -- nothing
 *   of it runs after, no finally block, no in-memory cleanup.
 * - `in-process-fault`: the boundary fails inside the test's own process (a
 *   durability observer that throws, an injected errno); what runs on the way
 *   out still runs, and the page cache is shared, so it shows order and
 *   meaning, not that a crash left the same.
 * - `logical`: a retry, a restart or a replay with nothing injected. */
export const INJECTIONS = Object.freeze(["sigkill", "in-process-fault", "logical"]);
const FAULT_CODES = new Set(["EIO", "ENOSPC", "EDQUOT", "EROFS", "EPERM", "EACCES"]);

const parsed = new Map();
function parse(root, file) {
  if (!parsed.has(`${root}\0${file}`)) {
    let source = null;
    try { source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true); } catch { source = null; }
    parsed.set(`${root}\0${file}`, source);
  }
  return parsed.get(`${root}\0${file}`);
}
/** The tests a file declares: each `test(...)`/`it(...)` call, its title as the
 * source spells it, and the function that is its body. */
function declaredTests(source) {
  const tests = [];
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const named = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : "";
      const [first] = node.arguments;
      if ((named === "test" || named === "it") && first &&
          (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) {
        const spelled = ts.isTemplateExpression(first) || ts.isNoSubstitutionTemplateLiteral(first) ? first.getText(source).slice(1, -1) : first.text;
        const body = [...node.arguments].reverse().find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
        tests.push({ title: spelled, text: ts.isStringLiteralLike(first) ? first.text : spelled, body });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return tests;
}
/** The functions a file declares at its top level, by name. */
function topLevelFunctions(source) {
  const functions = new Map();
  for (const statement of source.statements) {
    const declaration = ts.isExportDeclaration(statement) ? null : statement;
    if (declaration && ts.isFunctionDeclaration(declaration) && declaration.name) functions.set(declaration.name.text, declaration);
    if (declaration && ts.isClassDeclaration(declaration) && declaration.name) functions.set(declaration.name.text, declaration);
    if (declaration && ts.isVariableStatement(declaration))
      for (const item of declaration.declarationList.declarations)
        if (ts.isIdentifier(item.name) && item.initializer) functions.set(item.name.text, item.initializer);
  }
  return functions;
}
function relativeImports(source, file) {
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const resolved = join(file, "..", specifier).replace(/\.js$/, ".ts");
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements) imports.set(element.name.text, { file: resolved, name: (element.propertyName ?? element.name).text });
  }
  return imports;
}
/** What a test's body reaches: its own code, the functions of its file it
 * calls, and the functions it imports from the test tree -- transitively. */
function reachable(root, file, body) {
  const nodes = [];
  const seen = new Set();
  const queue = [{ file, node: body }];
  while (queue.length > 0) {
    const { file: at, node } = queue.shift();
    const source = parse(root, at);
    if (source === null || node === undefined) continue;
    const key = `${at}:${node.pos}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
    const functions = topLevelFunctions(source);
    const imports = relativeImports(source, at);
    const visit = inner => {
      if (ts.isIdentifier(inner)) {
        const local = functions.get(inner.text);
        if (local !== undefined) queue.push({ file: at, node: local });
        const imported = imports.get(inner.text);
        if (imported !== undefined && imported.file.startsWith("test/")) {
          const target = parse(root, imported.file);
          const found = target === null ? undefined : topLevelFunctions(target).get(imported.name);
          if (found !== undefined) queue.push({ file: imported.file, node: found });
        }
      }
      ts.forEachChild(inner, visit);
    };
    visit(node);
  }
  return nodes;
}
/** The injection a test's reachable code shows, strongest first. */
function shownInjection(nodes) {
  let sigkill = false;
  let fault = false;
  for (const node of nodes) {
    const visit = inner => {
      if (ts.isStringLiteralLike(inner) && inner.text === "SIGKILL" && ts.isCallExpression(inner.parent)) sigkill = true;
      if (ts.isIdentifier(inner) && inner.text === "DurabilityFaultError") fault = true;
      if (ts.isStringLiteralLike(inner) && FAULT_CODES.has(inner.text)) fault = true;
      // The source of a child the test runs, or of a probe it preloads.
      if (ts.isStringLiteralLike(inner) || ts.isTemplateHead(inner) || ts.isTemplateMiddle(inner) || ts.isTemplateTail(inner)) {
        if (/kill\([^)]*["']SIGKILL["']/.test(inner.text)) sigkill = true;
        if ([...FAULT_CODES].some(code => new RegExp(`["']${code}["']`).test(inner.text))) fault = true;
      }
      // A callback handed to the code under test that throws: a fault seam.
      if (ts.isThrowStatement(inner)) {
        for (let up = inner.parent; up; up = up.parent) {
          if ((ts.isArrowFunction(up) || ts.isFunctionExpression(up)) && ts.isCallExpression(up.parent) && up.parent.arguments.includes(up)) { fault = true; break; }
          if (nodes.includes(up)) break;
        }
      }
      ts.forEachChild(inner, visit);
    };
    visit(node);
  }
  return sigkill ? "sigkill" : fault ? "in-process-fault" : "logical";
}
/** The strongest injection the tests matching a reference's title show, or
 * null when the file declares no such test. */
export function shownInjectionOf(root, reference) {
  const source = parse(root, reference.file);
  if (source === null) return null;
  const matches = declaredTests(source).filter(entry => entry.title.includes(reference.title) || entry.text.includes(reference.title));
  if (matches.length === 0) return null;
  return matches.map(entry => shownInjection(reachable(root, reference.file, entry.body)))
    .sort((a, b) => INJECTIONS.indexOf(a) - INJECTIONS.indexOf(b))[0];
}
/** A test reference: the file, a literal fragment of a declared test's title
 * as the source spells it, the injection it uses, and -- for a table-driven
 * test -- the boundary points it is run at, each of which must appear in that
 * file as a quoted name. A title in a comment, or an injection the test's code
 * does not show, is a finding. */
function checkTest(root, owner, reference, findings) {
  if (reference === null || typeof reference !== "object" || typeof reference.file !== "string" || typeof reference.title !== "string") {
    findings.push(`${owner}: a test reference needs file and title`); return null;
  }
  if (!INJECTIONS.includes(reference.injection)) {
    findings.push(`${owner}: ${reference.file} "${reference.title}" does not say how it stops the process (injection: ${INJECTIONS.join(" | ")})`); return null;
  }
  let text;
  try { text = readFileSync(join(root, reference.file), "utf8"); }
  catch { findings.push(`${owner}: named test file does not exist: ${reference.file}`); return null; }
  const source = parse(root, reference.file);
  const matches = source === null ? [] : declaredTests(source).filter(entry => entry.title.includes(reference.title) || entry.text.includes(reference.title));
  if (matches.length === 0) { findings.push(`${owner}: ${reference.file} has no test titled "${reference.title}"`); return null; }
  for (const point of reference.points ?? [])
    if (!text.includes(`"${point}"`)) findings.push(`${owner}: ${reference.file} does not run at point "${point}"`);
  const rank = kind => INJECTIONS.indexOf(kind);
  const shown = matches.map(entry => shownInjection(reachable(root, reference.file, entry.body))).sort((a, b) => rank(a) - rank(b))[0];
  if (rank(shown) > rank(reference.injection))
    findings.push(`${owner}: ${reference.file} "${reference.title}" is registered as ${reference.injection}, but its code shows ${shown}`);
  return reference.injection;
}
export function checkDurableBoundaries(root = process.cwd()) {
  parsed.clear();
  const registry = JSON.parse(readFileSync(join(root, "implementation", "durable-boundaries.json"), "utf8"));
  const found = durableBoundaries(root);
  const findings = [];
  const registered = new Map(registry.boundaries.map(entry => [entry.owner, entry]));
  for (const boundary of found) {
    const entry = registered.get(boundary.owner);
    if (!entry) { findings.push(`${boundary.owner}: a durable boundary (${boundary.kinds.join(", ")}) has no registered kill/retry/restart test`); continue; }
    if (typeof entry.fact !== "string" || entry.fact.length === 0) findings.push(`${boundary.owner}: the fact this boundary makes durable is not named`);
    if (!Array.isArray(entry.tests) || entry.tests.length === 0) { findings.push(`${boundary.owner}: no test is named`); continue; }
    for (const reference of entry.tests) checkTest(root, boundary.owner, reference, findings);
  }
  for (const entry of registry.boundaries)
    if (!found.some(boundary => boundary.owner === entry.owner)) findings.push(`${entry.owner}: registered, but no such durable boundary exists in the code`);
  return findings;
}
/** P0V-83: the strongest injection each boundary is tested with, so the
 * strength the gate stands for is stated rather than implied. */
export function boundaryStrengths(root = process.cwd()) {
  const registry = JSON.parse(readFileSync(join(root, "implementation", "durable-boundaries.json"), "utf8"));
  return registry.boundaries.map(entry => ({ owner: entry.owner,
    strongest: INJECTIONS.find(kind => (entry.tests ?? []).some(reference => reference.injection === kind)) ?? "none" }));
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--list")) {
    const strengths = new Map(boundaryStrengths().map(entry => [entry.owner, entry.strongest]));
    for (const boundary of durableBoundaries()) console.log(`${boundary.owner}\t${boundary.kinds.join(",")}\t${strengths.get(boundary.owner) ?? "unregistered"}`);
    process.exit(0);
  }
  const findings = checkDurableBoundaries();
  for (const finding of findings) console.error(finding);
  const counts = Object.fromEntries(INJECTIONS.map(kind => [kind, 0]));
  for (const entry of boundaryStrengths()) if (Object.hasOwn(counts, entry.strongest)) counts[entry.strongest] += 1;
  console.log(`Durable boundaries: ${findings.length === 0 ? "PASS" : "FAIL"}; ${findings.length} findings. Strongest injection per boundary: ${INJECTIONS.map(kind => `${kind} ${counts[kind]}`).join(", ")}.`);
  process.exit(findings.length === 0 ? 0 : 1);
}
