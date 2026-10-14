import path from "node:path";
import { pathToFileURL } from "node:url";
import { withSourceSnapshot } from "./rules/shared.mjs";
import { importRuleFindings } from "./rules/import-rules.mjs";
import { transactionRuleFindings } from "./rules/transaction-rules.mjs";
import { ownershipRuleFindings } from "./rules/ownership-rules.mjs";
import { schemaDuplicationFindings } from "./rules/schema-duplication-rules.mjs";
import { contractDirectionFindings } from "./rules/contract-direction-rules.mjs";
import { effectOwnershipFindings } from "./rules/effect-ownership-rules.mjs";
import { surfaceRuleFindings } from "./rules/surface-rules.mjs";
import { fenceRuleFindings } from "./rules/fence-rules.mjs";
import { stateRootFindings, stateTreeFindings } from "./rules/state-tree-rules.mjs";
import { ownedStateFindings } from "./rules/owned-state-rules.mjs";

export const ARCHITECTURE_RULES = Object.freeze([
  ["imports", importRuleFindings],
  ["transactions", transactionRuleFindings],
  ["ownership", ownershipRuleFindings],
  ["schema-duplication", schemaDuplicationFindings],
  ["contract-direction", contractDirectionFindings],
  ["effect-ownership", effectOwnershipFindings],
  ["surface", surfaceRuleFindings],
  ["fence", fenceRuleFindings],
  ["state-tree", stateTreeFindings],
  ["state-root", stateRootFindings],
  ["owned-state", ownedStateFindings],
]);

export function runArchitectureRuleCheck(root = process.cwd()) {
  return withSourceSnapshot(() => {
    const findings = [];
    for (const [group, check] of ARCHITECTURE_RULES)
      for (const value of check(path.resolve(root))) findings.push({ group, ...value });
    return findings;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const findings = runArchitectureRuleCheck(process.cwd());
    for (const finding of findings)
      console.error(`${finding.file} [${finding.group}/${finding.rule}] ${finding.reason}`);
    console.log(`Architecture rule modules: ${findings.length ? "FAIL" : "PASS"}; ${findings.length} findings.`);
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(`Architecture rule modules failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
