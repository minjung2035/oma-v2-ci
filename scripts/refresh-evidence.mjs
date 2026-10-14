/** Refresh derived structure only. Authored owners, clause fingerprints and reviews
 * remain inputs; generating identities never turns a historical test into a new PASS.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verificationInputDigest } from "./source-digest.mjs";

const BINDING = /verification input digest `[0-9a-f]{64}` \(\d+ files\)/g;

export function bindVerificationInputs(root = process.cwd()) {
  const path = join(root, "docs/implementation/validation.md");
  const before = readFileSync(path, "utf8");
  if ([...before.matchAll(BINDING)].length !== 1)
    throw new Error("validation must contain exactly one structural input binding");
  const identity = verificationInputDigest(root);
  writeFileSync(path, before.replace(BINDING,
    `verification input digest \`${identity.digest}\` (${identity.files} files)`));
  return { ...identity, runtimeProof: false };
}

export function refreshEvidence(root = process.cwd()) {
  // Preserve stale/invalid authored review refusals rather than rehashing them.
  for (const [script, ...args] of [
    ["scripts/dependency-graph.mjs", "--write-evidence"],
    ["scripts/loc.mjs", "--source-digests"],
    ["scripts/review-ledger.mjs"],
  ]) execFileSync(process.execPath, [join(root, script), ...args], {
    cwd: root, stdio: "inherit", timeout: 120_000, killSignal: "SIGKILL",
  });
  return bindVerificationInputs(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) throw new Error("usage: refresh-evidence.mjs");
  console.log(JSON.stringify({ status: "STRUCTURE_GENERATED", ...refreshEvidence() }));
}
