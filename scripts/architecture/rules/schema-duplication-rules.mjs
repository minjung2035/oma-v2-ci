import { finding, readJson } from "./shared.mjs";

/** Central registry dimensions belong once at the map root, never per mutation. */
export function schemaDuplicationFindings(root) {
  const file = "implementation/mutation-owners.json";
  const map = readJson(root, file);
  const findings = [];
  const registryDimensions = Object.keys(map.registryOwners ?? {});
  const stageSet = new Set();
  for (const stage of map.fanoutStages ?? []) {
    if (stageSet.has(stage))
      findings.push(finding("mutation-fanout-duplicate", file, `fanout stage ${stage} is duplicated`));
    stageSet.add(stage);
    if (!Object.hasOwn(map.registryOwners ?? {}, stage) && stage !== "tests")
      findings.push(finding("mutation-fanout-owner", file, `fanout stage ${stage} has no central registry owner`));
  }
  for (const [mutation, spec] of Object.entries(map.mutations ?? {})) {
    for (const dimension of registryDimensions) {
      if (Object.hasOwn(spec, dimension))
        findings.push(finding("mutation-registry-duplication", file,
          `${mutation} duplicates central ${dimension} ownership; keep the registry locator only in registryOwners`));
    }
  }
  return findings;
}
