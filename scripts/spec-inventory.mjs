#!/usr/bin/env node
/** Doc↔inventory drift (F-3): a normative clause's text is its fingerprint, so
 * a doc edit that does not re-fingerprint `implementation/traceability.json`
 * and a row that no longer matches any current clause are both drift. No other
 * check compares the pairing: check:documents sees identifiers and links,
 * check:inventory sees production sources, and `compliance.mjs --inventory`
 * regenerates rather than verifies.
 * Importing this module reads nothing. `node scripts/spec-inventory.mjs`
 * checks this repository and exits 1 on any finding; the repair is
 * `node scripts/compliance.mjs --inventory` after the clause text is right. */
import { pathToFileURL } from "node:url";
import { loadTraceInventory, traceIdentity } from "./traceability.mjs";

/** Clauses whose current text no row fingerprints, and rows whose recorded
 * fingerprint no current clause produces. Each pair is one drifted clause. */
export function specInventoryFindings(root = ".") {
  const { entries, extras, rows } = loadTraceInventory(root);
  const rowIds = new Set(rows.map(traceIdentity));
  return [
    ...entries
      .filter(entry => !rowIds.has(traceIdentity(entry)))
      .map(entry => `${entry.source}: [${entry.requirement}] changed without a re-fingerprinted traceability row`),
    ...extras.map(row => `${row.source}: [${row.requirement}] row ${row.digest.slice(0, 12)}… fingerprints text no clause says`),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const findings = specInventoryFindings(".");
  for (const finding of findings) console.error(finding);
  console.log(`Spec inventory: ${findings.length === 0 ? "PASS" : "FAIL"}; ${findings.length} drifted clause records.`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}
