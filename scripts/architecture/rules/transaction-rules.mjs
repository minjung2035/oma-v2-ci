import { finding, readJson } from "./shared.mjs";

/** Recovery metadata makes transaction-complete versus physical-replay ownership explicit. */
export function transactionRuleFindings(root) {
  const map = readJson(root, "implementation/mutation-owners.json");
  const findings = [];
  for (const [mutation, spec] of Object.entries(map.mutations ?? {})) {
    const recovery = spec.recovery;
    if (!recovery || !Array.isArray(recovery.owners)) {
      findings.push(finding("mutation-recovery-shape", "implementation/mutation-owners.json",
        `${mutation} must declare recovery.strategy and recovery.owners`));
      continue;
    }
    if (recovery.strategy === "transaction-complete") {
      if (recovery.owners.length !== 0)
        findings.push(finding("transaction-complete-recovery", "implementation/mutation-owners.json",
          `${mutation} is transaction-complete and must not name a physical recovery owner`));
      const workflow = new Set((spec.workflow ?? []).map(owner => owner.path));
      const persistence = new Set((spec.persistence ?? []).map(owner => owner.path));
      if (![...workflow].some(file => persistence.has(file)))
        findings.push(finding("transaction-complete-owner", "implementation/mutation-owners.json",
          `${mutation} must identify the transaction-completing workflow as a persistence owner`));
    } else if (recovery.strategy === "physical-replay") {
      if (recovery.owners.length === 0)
        findings.push(finding("physical-replay-owner", "implementation/mutation-owners.json",
          `${mutation} requires at least one physical recovery owner`));
    } else {
      findings.push(finding("mutation-recovery-strategy", "implementation/mutation-owners.json",
        `${mutation} has unknown recovery strategy ${String(recovery.strategy)}`));
    }
  }
  return findings;
}
