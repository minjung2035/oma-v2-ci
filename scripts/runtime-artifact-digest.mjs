/** Bind actual built workspace bytes/modes to their build records. This is
 * consistency evidence, never a signature or OS support/authority proof. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { workspaceManifests } from "./check-modules.mjs";
import { workspaceOutputs } from "./workspace-build-cache.mjs";
export function runtimeArtifactDigest(root = process.cwd()) {
  const record = JSON.parse(readFileSync(join(root, ".scratch/workspace-build-cache.json"), "utf8"));
  if (record?.schema !== 1 || !record.workspaces || typeof record.workspaces !== "object" || Array.isArray(record.workspaces))
    throw new Error("runtime build record is unavailable");
  const manifests = workspaceManifests(root).sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  const names = manifests.map(workspace => workspace.manifest.name);
  if (!names.length || new Set(names).size !== names.length ||
      JSON.stringify([...names].sort()) !== JSON.stringify(Object.keys(record.workspaces).sort()))
    throw new Error("runtime workspace set differs from build record");
  const hash = createHash("sha256"); let files = 0, workspaces = 0;
  for (const workspace of manifests) {
    const actual = workspaceOutputs(join(root, workspace.path)), expected = record.workspaces?.[workspace.manifest.name]?.outputs;
    if (!expected || JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`runtime output differs from build record: ${workspace.manifest.name}`);
    hash.update(workspace.manifest.name + "\n" + JSON.stringify(actual) + "\n");
    files += Object.values(actual).filter(row => row.sha256 !== undefined).length; workspaces++;
  }
  return { digest: hash.digest("hex"), files, workspaces };
}
