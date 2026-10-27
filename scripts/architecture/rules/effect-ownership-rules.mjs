import ts from "typescript";
import { eachNode, filesUnder, finding, importSpecifiers, sourceOf } from "./shared.mjs";

const RAW_EFFECT_MODULES = new Set([
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "node:os",
  "node:child_process",
  "child_process",
]);
const isEffectPreparation = file => file === "apps/oma/src/cli/effects.ts" || file.startsWith("apps/oma/src/cli/effects/");
const isTransportDiscovery = (file, specifier) =>
  file === "apps/oma/src/cli/transport.ts" && (specifier === "node:fs" || specifier === "fs");

export function effectOwnershipFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "apps/oma/src/cli")) {
    const source = sourceOf(root, file);
    for (const { specifier } of importSpecifiers(source)) {
      const rawEffect = RAW_EFFECT_MODULES.has(specifier) || specifier.includes("/process/");
      if (rawEffect && !isEffectPreparation(file) && !isTransportDiscovery(file, specifier))
        findings.push(finding("cli-effect-owner", file, `${specifier} belongs in src/cli/effects* or its dedicated transport owner`));
      if (specifier.endsWith("/request-cache.js") && file !== "apps/oma/src/cli/request-service.ts")
        findings.push(finding("cli-request-cache-owner", file, "RequestCache belongs to src/cli/request-service.ts"));
      if (specifier.endsWith("/protocol/channel.js") && file !== "apps/oma/src/cli/transport.ts")
        findings.push(finding("cli-transport-owner", file, "BrokerChannel belongs to src/cli/transport.ts"));
    }
    if (file === "apps/oma/src/cli/exit.ts") continue;
    // WP29: the rule's scope is the global `process` and the `node:process`
    // module in src/cli. It follows the spellings that reach `exit` without the
    // literal `process.exit(` -- element access, destructuring, a module import --
    // and not arbitrary data flow (a value passed through a function is out of
    // scope; the CLI exit behaviour tests own that).
    for (const { specifier } of importSpecifiers(source))
      if (specifier === "node:process" || specifier === "process")
        findings.push(finding("cli-exit-owner", file, `${specifier} imports belong to src/cli/exit.ts`));
    const isProcess = expression => ts.isIdentifier(expression) && expression.text === "process" ||
      ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
        expression.expression.text === "globalThis" && expression.name.text === "process";
    eachNode(source, node => {
      if (ts.isPropertyAccessExpression(node) && isProcess(node.expression) && node.name.text === "exit")
        findings.push(finding("cli-exit-owner", file, "process.exit belongs to src/cli/exit.ts"));
      else if (ts.isElementAccessExpression(node) && isProcess(node.expression) &&
          ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "exit")
        findings.push(finding("cli-exit-owner", file, "process[\"exit\"] belongs to src/cli/exit.ts"));
      else if (ts.isVariableDeclaration(node) && node.initializer && isProcess(node.initializer) &&
          ts.isObjectBindingPattern(node.name) && node.name.elements.some(element =>
            (element.propertyName ?? element.name).getText(source) === "exit"))
        findings.push(finding("cli-exit-owner", file, "exit destructured from process belongs to src/cli/exit.ts"));
    });
  }
  return findings;
}
