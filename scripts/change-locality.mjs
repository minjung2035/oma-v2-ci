/** Actual changeset measurements. Owner intersections are an inventory join,
 * never an inference that every intersected feature changed. */
import { isVendoredExtension } from "./architecture/rules/shared.mjs";
import { execFileSync } from "node:child_process";

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
export function changeLocality(root, base, until, inventory = []) {
  const resolve = revision => git(root, ["rev-parse", "--verify", `${revision}^{commit}`]).trim();
  const from = resolve(base), to = until === undefined ? "working-tree" : resolve(until);
  const split = value => value.split("\0").filter(Boolean);
  const files = split(git(root, ["diff", "--name-only", "--no-renames", "--no-ext-diff", "-z", from,
    ...(until === undefined ? [] : [to]), "--"]));
  if (until === undefined) files.push(...split(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])));
  const changedFiles = [...new Set(files)].sort();
  const category = file => isVendoredExtension(file) ? "vendor" : file.startsWith("apps/oma/src/") || /^packages\/[^/]+\/src\//.test(file) ? "source"
    : file.startsWith("test/") ? "tests" : file.startsWith("scripts/") ? "tools" : "metadata";
  const counts = { source: 0, tests: 0, tools: 0, metadata: 0, vendor: 0 };
  for (const file of changedFiles) counts[category(file)]++;
  return { from, to, totalFiles: changedFiles.length, counts, changedFiles,
    ownerIntersections: inventory.map(row => ({ mutation: row.mutation,
      files: changedFiles.filter(file => row.refs.some(ref => ref.path === file)) })),
    meaning: "Actual files changed in this explicit changeset; owner intersections do not attribute changes to features. Compare changesets for one declared feature to measure feature locality.",
  };
}
