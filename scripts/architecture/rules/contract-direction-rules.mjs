import ts from "typescript";
import { eachNode, filesUnder, finding, normalizeRelativeImport, sourceOf } from "./shared.mjs";

/** Public DTO declarations never refer back to an implementation or internal port. */
export function contractDirectionFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "packages/contracts/src")) {
    eachNode(sourceOf(root, file), node => {
      const literal = ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal
        : ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : null;
      if (!literal || !ts.isStringLiteralLike(literal)) return;
      const target = normalizeRelativeImport(file, literal.text);
      if (target === null || !target.startsWith("packages/contracts/src/"))
        findings.push(finding("contract-direction", file, `public contract depends on another owner: ${literal.text}`));
    });
  }
  return findings;
}
