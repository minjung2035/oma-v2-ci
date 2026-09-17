import ts from "typescript";
import { eachNode, filesUnder, finding, normalizeRelativeImport, readJson, sourceOf } from "./shared.mjs";

const isInternalPort = target => target === "src/module-ports.ts" || target.startsWith("src/ports/");

function planned(plan) {
  const values = new Map();
  for (const item of Object.values(plan.items ?? {}))
    values.set(`${item.contract}\0${item.implementation}\0${item.symbol}`, item);
  return values;
}

function references(root) {
  const files = ["implementation/contracts.ts", ...filesUnder(root, "implementation/contracts")];
  const refs = [];
  for (const file of files) {
    const source = sourceOf(root, file);
    eachNode(source, node => {
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        const target = normalizeRelativeImport(file, node.argument.literal.text);
        if (target?.startsWith("src/")) refs.push({ file, target, symbol: node.qualifier?.getText(source) ?? "*" });
        return;
      }
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) return;
      const target = normalizeRelativeImport(file, node.moduleSpecifier.text);
      if (!target?.startsWith("src/")) return;
      const clause = node.importClause;
      if (!clause) { refs.push({ file, target, symbol: "*" }); return; }
      if (clause.name) refs.push({ file, target, symbol: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements) refs.push({ file, target, symbol: (item.propertyName ?? item.name).text });
      else if (bindings) refs.push({ file, target, symbol: "*" });
    });
  }
  return refs;
}

/** Contract owners may point to erased internal-port contracts; concrete src types must be explicit migration debt. */
export function contractDirectionFindings(root) {
  const file = "implementation/contract-direction-plan.json";
  const plan = readJson(root, file);
  const expected = planned(plan);
  const seen = new Set();
  const findings = [];
  for (const ref of references(root)) {
    if (isInternalPort(ref.target)) continue;
    const key = `${ref.file}\0${ref.target}\0${ref.symbol}`;
    if (!expected.has(key)) {
      findings.push(finding("contract-direction", ref.file,
        `unplanned contract -> implementation type reference: ${ref.target} :: ${ref.symbol}`));
      continue;
    }
    seen.add(key);
  }
  for (const [key, item] of expected) {
    if (!seen.has(key))
      findings.push(finding("contract-direction-plan-stale", file,
        `${item.contract} no longer references ${item.implementation} :: ${item.symbol}; remove or complete the migration item`));
  }
  if (plan.currentFrozenContractAliases !== seen.size)
    findings.push(finding("contract-direction-count", file,
      `currentFrozenContractAliases=${plan.currentFrozenContractAliases} but observed planned aliases=${seen.size}`));
  if (plan.targetFrozenContractAliases !== 0)
    findings.push(finding("contract-direction-target", file, "targetFrozenContractAliases must remain 0"));
  return findings;
}
