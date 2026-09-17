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
const isEffectPreparation = file => file === "src/cli/effects.ts" || file.startsWith("src/cli/effects/");

export function effectOwnershipFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "src/cli")) {
    const source = sourceOf(root, file);
    for (const { specifier } of importSpecifiers(source)) {
      if ((RAW_EFFECT_MODULES.has(specifier) || specifier.includes("/process/")) && !isEffectPreparation(file))
        findings.push(finding("cli-effect-owner", file, `${specifier} belongs in src/cli/effects*`));
      if (specifier.endsWith("/request-cache.js") && file !== "src/cli/request-service.ts")
        findings.push(finding("cli-request-cache-owner", file, "RequestCache belongs to src/cli/request-service.ts"));
      if (specifier.endsWith("/protocol/channel.js") && file !== "src/cli/transport.ts")
        findings.push(finding("cli-transport-owner", file, "BrokerChannel belongs to src/cli/transport.ts"));
    }
    eachNode(source, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
      if (ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process" &&
          node.expression.name.text === "exit" && file !== "src/cli/exit.ts")
        findings.push(finding("cli-exit-owner", file, "process.exit belongs to src/cli/exit.ts"));
    });
  }
  return findings;
}
