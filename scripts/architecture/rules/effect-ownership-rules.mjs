import ts from "typescript";
import { eachNode, filesUnder, finding, importSpecifiers, normalizeRelativeImport, sourceOf } from "./shared.mjs";

const RAW_EFFECT_MODULES = new Set([
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "node:os",
  "node:child_process",
  "child_process",
]);
const isTransportDiscovery = (file, specifier) =>
  file === "packages/client/src/transport.ts" && (specifier === "node:fs" || specifier === "fs");

export function effectOwnershipFindings(root) {
  const findings = [];
  for (const file of filesUnder(root, "packages/client/src")) {
    const source = sourceOf(root, file);
    for (const { specifier } of importSpecifiers(source)) {
      const target = normalizeRelativeImport(file, specifier);
      const rawEffect = RAW_EFFECT_MODULES.has(specifier) || specifier.startsWith("@oma/process/") || specifier.includes("/process/");
      if (rawEffect && !isTransportDiscovery(file, specifier))
        findings.push(finding("client-effect-owner", file, `${specifier} belongs in the injected runtime input-effects owner, not the client library`));
      if (target === "apps/oma/src/request-cache.ts")
        findings.push(finding("client-request-cache-owner", file, "RequestCache belongs to the injected runtime; the client uses CachePort"));
      if ((specifier === "node:net" || specifier === "net") &&
          file !== "packages/client/src/channel.ts" && file !== "packages/client/src/connection.ts")
        findings.push(finding("client-transport-owner", file, "network primitives belong to channel.ts or connection.ts"));
    }
    // A reusable client reports errors to its caller and never terminates the
    // hosting engine. Follow direct, element, destructured and module spellings.
    for (const { specifier } of importSpecifiers(source))
      if (specifier === "node:process" || specifier === "process")
        findings.push(finding("client-process-exit", file, `${specifier} imports can terminate the client's host`));
    const isProcess = expression => ts.isIdentifier(expression) && expression.text === "process" ||
      ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) &&
        expression.expression.text === "globalThis" && expression.name.text === "process";
    eachNode(source, node => {
      if (ts.isPropertyAccessExpression(node) && isProcess(node.expression) && node.name.text === "exit")
        findings.push(finding("client-process-exit", file, "the client must not terminate its host through process.exit"));
      else if (ts.isElementAccessExpression(node) && isProcess(node.expression) &&
          ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "exit")
        findings.push(finding("client-process-exit", file, "the client must not terminate its host through process[\"exit\"]"));
      else if (ts.isVariableDeclaration(node) && node.initializer && isProcess(node.initializer) &&
          ts.isObjectBindingPattern(node.name) && node.name.elements.some(element =>
            (element.propertyName ?? element.name).getText(source) === "exit"))
        findings.push(finding("client-process-exit", file, "the client must not destructure exit from process"));
    });
  }
  return findings;
}
