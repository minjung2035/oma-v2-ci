/** P0-7 (PRIORITY-0.md): the durable boundaries of the product, taken from the
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
  writeExclusiveFsyncedFile: "file-publication", writeFsynced: "file-publication", writeExclusiveFsyncedEntry: "file-publication",
  publishStagedDirectory: "file-publication", replaceDerivedSymlink: "file-publication", publishBatchView: "file-publication",
  publishContextRevision: "file-publication", publishProjectBinding: "file-publication",
  prepareSubmitSpool: "file-publication", prepareContextStream: "file-publication",
  publishDeliveryReceipt: "receipt",
  commitManagedGeneration: "config-commit", commitInlineConfiguration: "config-commit", createInlineConfiguration: "config-commit",
  compareAndSwapCanonicalRef: "git-cas", casRef: "git-cas", compareAndSwap: "git-cas", publishRef: "git-cas",
  removeOwnedTree: "collection", removeOwnedFile: "collection",
});
/** The primitives' own modules: their internal calls are the mechanism, not boundaries. */
export const PRIMITIVE_MODULES = Object.freeze([
  "src/store.ts", "src/storage/transaction.ts", "src/storage/transitions.ts", "src/storage/operation-transitions.ts",
  "src/storage/operation-journal.ts", "src/storage/durable-fs.ts", "src/storage/immutable-file.ts", "src/storage/staged-tree.ts",
  "src/storage/contained-fs.ts", "src/storage/directory.ts", "src/storage/delivery-receipt.ts", "src/storage/context-snapshot.ts",
  "src/storage/submit-spool.ts", "src/storage/context-stream.ts", "src/storage/batch-view.ts", "src/config/generations.ts",
  "src/git/canonical-command.ts",
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
/** Every production call of a durable primitive, grouped by the function around it. */
export function durableBoundaries(root = process.cwd()) {
  const files = readFileSync(join(root, "production-files.txt"), "utf8").split("\n").filter(file => file.startsWith("src/") && file.endsWith(".ts"));
  const owners = new Map();
  for (const file of files) {
    if (PRIMITIVE_MODULES.includes(file)) continue;
    const source = ts.createSourceFile(file, readFileSync(join(root, file), "utf8"), ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node.expression);
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
/** A test reference: the file, a literal fragment of the test's title as the
 * source spells it, and -- for a table-driven test -- the boundary points it is
 * run at, each of which must appear in that file as a quoted name. */
function checkTest(root, owner, reference, findings) {
  if (reference === null || typeof reference !== "object" || typeof reference.file !== "string" || typeof reference.title !== "string") {
    findings.push(`${owner}: a test reference needs file and title`); return;
  }
  let text;
  try { text = readFileSync(join(root, reference.file), "utf8"); }
  catch { findings.push(`${owner}: named test file does not exist: ${reference.file}`); return; }
  if (!text.includes(reference.title)) findings.push(`${owner}: ${reference.file} has no test titled "${reference.title}"`);
  for (const point of reference.points ?? [])
    if (!text.includes(`"${point}"`)) findings.push(`${owner}: ${reference.file} does not run at point "${point}"`);
}
export function checkDurableBoundaries(root = process.cwd()) {
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
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--list")) { for (const boundary of durableBoundaries()) console.log(`${boundary.owner}\t${boundary.kinds.join(",")}`); process.exit(0); }
  const findings = checkDurableBoundaries();
  for (const finding of findings) console.error(finding);
  console.log(`Durable boundaries: ${findings.length === 0 ? "PASS" : "FAIL"}; ${findings.length} findings.`);
  process.exit(findings.length === 0 ? 0 : 1);
}
