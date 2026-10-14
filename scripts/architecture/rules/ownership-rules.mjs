import { exists, finding, mutationMethods, readJson, registryOwnerSymbol } from "./shared.mjs";

export function ownershipRuleFindings(root) {
  const file = "implementation/mutation-owners.json";
  const map = readJson(root, file);
  const findings = [];
  const expected = mutationMethods(root);
  const actual = Object.keys(map.mutations ?? {}).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    findings.push(finding("mutation-ownership-exhaustiveness", file,
      `mutation ownership keys differ from PUBLIC_METHODS mutations: expected ${expected.join(", ")}; got ${actual.join(", ")}`));
  for (const [dimension, owner] of Object.entries(map.registryOwners ?? {})) {
    if (!owner || typeof owner.path !== "string" || !exists(root, owner.path))
      findings.push(finding("mutation-registry-owner", file, `${dimension} registry owner path is missing`));
    for (const mutation of expected)
      if (!registryOwnerSymbol(root, owner, mutation))
        findings.push(finding("mutation-registry-symbol", file, `${dimension} has no symbol locator for ${mutation}`));
  }
  for (const [mutation, spec] of Object.entries(map.mutations ?? {})) {
    for (const dimension of map.requiredMutationDimensions ?? []) {
      if (!Object.hasOwn(spec, dimension))
        findings.push(finding("mutation-owner-dimension", file, `${mutation} is missing ${dimension}`));
    }
    for (const dimension of ["workflow", "persistence", "cli", "tests"]) {
      const owners = spec[dimension];
      if (!Array.isArray(owners) || owners.length === 0) {
        findings.push(finding("mutation-owner-empty", file, `${mutation}.${dimension} must name at least one owner`));
        continue;
      }
      for (const owner of owners) {
        if (typeof owner?.path !== "string" || typeof owner?.symbol !== "string" || !exists(root, owner.path))
          findings.push(finding("mutation-owner-reference", file, `${mutation}.${dimension} has an invalid or missing owner reference`));
      }
    }
    for (const owner of spec.recovery?.owners ?? [])
      if (typeof owner?.path !== "string" || typeof owner?.symbol !== "string" || !exists(root, owner.path))
        findings.push(finding("mutation-owner-reference", file, `${mutation}.recovery has an invalid or missing owner reference`));
  }
  return findings;
}
