import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
const [beforeRoot, ...roots] = process.argv.slice(2);
if (!beforeRoot || !roots.length) throw new Error("usage: verify-import-runtime.mjs <baseline-root> <source.ts>...");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, removeComments: true };
const literal = node => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
// AV-20261003-30: the proof covers what the named files actually run -- their
// relative-import closure resolved through the AST -- not only the entries on
// the command line. An unresolvable relative specifier fails the proof rather
// than silently narrowing it.
const specifiersOf = source => {
  const specifiers = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const text = literal(node.moduleSpecifier);
      if (text !== null) specifiers.push(text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
        ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
      const text = literal(node.arguments[0]);
      if (text !== null) specifiers.push(text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return specifiers;
};
const resolveImport = (fromFile, specifier) => {
  const base = path.normalize(path.join(path.dirname(fromFile), specifier));
  const candidates = base.endsWith(".js") ? [`${base.slice(0, -3)}.ts`]
    : base.endsWith(".jsx") ? [`${base.slice(0, -4)}.tsx`]
    : base.endsWith(".mjs") ? [`${base.slice(0, -4)}.mts`]
    : base.endsWith(".cjs") ? [`${base.slice(0, -4)}.cts`]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, path.join(base, "index.ts")];
  for (const candidate of candidates) if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  throw new Error(`unresolved import ${specifier} in ${fromFile}: the runtime closure cannot be bound`);
};
const files = new Set();
const queue = roots.map(file => path.normalize(file));
while (queue.length > 0) {
  const file = queue.pop();
  if (files.has(file)) continue;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  files.add(file);
  for (const specifier of specifiersOf(source)) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    const resolved = resolveImport(file, specifier);
    if (!files.has(resolved)) queue.push(resolved);
  }
}
const report = [...files].sort().map(file => {
  const before = fs.readFileSync(path.join(beforeRoot, file), "utf8"), after = fs.readFileSync(file, "utf8");
  const a = ts.transpileModule(before, { compilerOptions: options }).outputText;
  const b = ts.transpileModule(after, { compilerOptions: options }).outputText;
  if (a !== b) throw new Error(`runtime output changed: ${file}`);
  return { file, beforeSha256: digest(before), afterSha256: digest(after), emittedSha256: digest(a), identicalRuntime: true };
});
console.log(JSON.stringify({ node: process.version, typescript: ts.version, proof: "transpiled runtime equality over the relative-import closure, not semantic typecheck", roots, files: report }, null, 2));
