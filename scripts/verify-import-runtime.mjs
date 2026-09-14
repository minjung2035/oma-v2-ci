import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
const [beforeRoot, ...files] = process.argv.slice(2);
if (!beforeRoot || !files.length) throw new Error("usage: verify-import-runtime.mjs <baseline-root> <source.ts>...");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const options = { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, removeComments: true };
const report = files.map(file => {
  const before = fs.readFileSync(path.join(beforeRoot, file), "utf8"), after = fs.readFileSync(file, "utf8");
  const a = ts.transpileModule(before, { compilerOptions: options }).outputText;
  const b = ts.transpileModule(after, { compilerOptions: options }).outputText;
  if (a !== b) throw new Error(`runtime output changed: ${file}`);
  return { file, beforeSha256: digest(before), afterSha256: digest(after), emittedSha256: digest(a), identicalRuntime: true };
});
console.log(JSON.stringify({ node: process.version, typescript: ts.version, proof: "transpiled runtime equality, not semantic typecheck", files: report }, null, 2));
