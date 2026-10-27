import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import ts from "typescript";

/** Type-check every declaration, reporting OMA's public declarations and the
 * consumer strictly. Foreign declaration diagnostics remain separately counted:
 * the product's skipLibCheck policy does not exempt authored package APIs. */
export function isolatedDeclarationDiagnostics(entry, authoredDirectories, { types = ["node"] } = {}) {
  const roots = authoredDirectories.map(directory => realpathSync(directory) + sep);
  const consumer = resolve(entry);
  const authored = file => roots.some(root => file.startsWith(root));
  const options = {
    noEmit: true, strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022, types, typeRoots: [join(dirname(consumer), "node_modules", "@types")], skipLibCheck: false,
  };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => dirname(consumer);
  const program = ts.createProgram([consumer], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const own = diagnostics.filter(diagnostic => !diagnostic.file || diagnostic.file.fileName === consumer || authored(diagnostic.file.fileName));
  const checkedDeclarationFiles = program.getSourceFiles().filter(source => source.isDeclarationFile && authored(source.fileName)).map(source => source.fileName);
  return { diagnostics: own, externalDiagnostics: diagnostics.length - own.length,
    checkedDeclarations: checkedDeclarationFiles.length, checkedDeclarationFiles };
}

export function formatDeclarationDiagnostics(diagnostics) {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n",
  });
}
