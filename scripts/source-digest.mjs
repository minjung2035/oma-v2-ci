// The identity of the source a verification run covered.
//
// A record that names a commit says which revision was meant; it does not say
// which bytes were run, and a stale line in it is indistinguishable from a
// current one. This digest is the bytes: every file under the executed source
// roots, by path and content, in path order. Recording it beside a run's
// results makes the two verifiable together -- a source change that is not
// re-run and re-recorded fails, instead of leaving figures from an earlier
// tree looking current.
//
// Importing this module measures nothing and writes nothing.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { digest, sourceFiles } from "./traceability.mjs";

/** What a run executes: production and test sources, their shared contract,
 * and the tools that run them. Documents are fingerprinted clause by clause in
 * the trace inventory and are not repeated here. */
export const EXECUTED_SOURCE_ROOTS = Object.freeze([
  "src", "test", "scripts", "implementation/contracts.ts",
]);

/** The digest of the executed source, with the file count it covers.
 *
 * Real traversal, not a generated manifest: a file added and never listed would
 * otherwise leave the digest unchanged. `sourceFiles` refuses symlinks, so the
 * set cannot be widened or narrowed by a link.
 */
export function executedSourceDigest(root = ".") {
  const files = EXECUTED_SOURCE_ROOTS.flatMap(directory => sourceFiles(root, directory)).sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file} ${digest(readFileSync(join(root, file)))}\n`);
  return { files: files.length, digest: hash.digest("hex") };
}
