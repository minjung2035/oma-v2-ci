// Trace inventories are not runtime proofs. Importing this module writes nothing.
import { readFileSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
export const normativeSources = Object.freeze([
  "docs/implementation-spec.md", "docs/implementation/integration-policy.md",
  "docs/verification-spec.md", "docs/macos-platform.md",
]);
export const digest = bytes => createHash("sha256").update(bytes).digest("hex");
export const traceIdentity = row => JSON.stringify([row.source, row.requirement, row.digest]);
const ruleIdentity = (source, requirement) => JSON.stringify([source, requirement.split(";")[0].trim()]);
export function inventoryClauses(documents) {
  return documents.flatMap(({ source, text }) => [...text.matchAll(/\*\*(MUST(?: NOT)?|SHOULD|OPTIONAL) \[([^\]]+)\]\*\*([^\n]*(?:\n(?!\s*\n|\*\*)[^\n]+)*)/g)].map(match => ({
    requirement: match[2], source, digest: digest(match[0]), normativeText: match[0],
    applicability: "unclassified", rationale: "Requires production-path review; no inference from test names.",
    owner: null, entrypoint: null, callPath: [], negativeTests: [], evidence: null, status: "unverified",
  })));
}
export function indexTrace(rows) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.source !== "string" || typeof row.requirement !== "string" || !/^[0-9a-f]{64}$/.test(row.digest ?? "")))
    throw new Error("trace must be an array of fingerprinted requirement records");
  const result = new Map(rows.map(row => [traceIdentity(row), row]));
  if (result.size !== rows.length) throw new Error("duplicate trace identity");
  return result;
}
const locator = value => typeof value === "string" && /^[^#]+#[^#]+$/.test(value);
const locators = values => Array.isArray(values) && values.length > 0 && values.every(locator) && new Set(values).size === values.length;
/** Explicit links only; no inference from family names or similar test titles.
 * A changed locator invalidates evidence, even if the normative text is unchanged.
 * Unchanged fingerprint AND unchanged links preserve the previous record exactly.
 */
export function applyOwnerLinks(entries, rows, links) {
  const previous = indexTrace(rows);
  if (!Array.isArray(links)) throw new Error("owner links must be an array");
  const required = new Set(entries.map(entry => ruleIdentity(entry.source, entry.requirement)));
  const byRule = new Map();
  for (const link of links) {
    if (!link || typeof link.source !== "string" || !Array.isArray(link.requirements) || link.requirements.length === 0 ||
        !locator(link.owner) || !locator(link.entrypoint) || !locators(link.callPath) || !locators(link.negativeTests) ||
        !link.callPath.includes(link.owner) || !link.callPath.includes(link.entrypoint)) throw new Error("invalid owner link");
    for (const id of link.requirements) {
      if (typeof id !== "string" || id.includes(";") || !id.trim()) throw new Error("invalid linked rule ID");
      const key = ruleIdentity(link.source, id);
      if (byRule.has(key)) throw new Error(`duplicate owner link: ${id}`);
      if (!required.has(key)) throw new Error(`owner link names an absent normative clause: ${id}`);
      byRule.set(key, link);
    }
  }
  return entries.map(entry => {
    const before = previous.get(traceIdentity(entry)) ?? entry;
    const link = byRule.get(ruleIdentity(entry.source, entry.requirement));
    if (!link) return before;
    const fields = { owner: link.owner, entrypoint: link.entrypoint, callPath: [...link.callPath], negativeTests: [...link.negativeTests] };
    if (Object.entries(fields).every(([field, value]) => JSON.stringify(before[field]) === JSON.stringify(value))) return before;
    return { ...before, ...fields, status: "unverified", evidence: null,
      verification: "NOT_RUN", invalidationReason: "authoritative owner, entrypoint, call path or negative-test locator changed" };
  });
}
export function loadTraceInventory(root = ".") {
  const entries = inventoryClauses(normativeSources.map(source => ({ source, text: readFileSync(join(root, source), "utf8") })));
  indexTrace(entries);
  const path = join(root, "implementation/traceability.json");
  const rows = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  const linksPath = join(root, "implementation/source-owners.json");
  const links = existsSync(linksPath) ? JSON.parse(readFileSync(linksPath, "utf8")) : [];
  const linkedRows = applyOwnerLinks(entries, rows, links);
  const identities = new Set(entries.map(traceIdentity));
  return { entries, rows, linkedRows, links, extras: rows.filter(row => !identities.has(traceIdentity(row))) };
}
/** Count normative matrix ROWS, not mentions, unit tests or promises of coverage.
 * Core and tiered are deliberately different scopes, never a replacement 90 count.
 */
export function inventoryAcceptance(documents) {
  const records = documents.flatMap(({ source, text }) => text.split(/\r?\n/).flatMap((line, index) => {
    const match = /^\|\s*T(\d+)\s*\/\s*([^|]+)\|\s*(.+)\|\s*$/.exec(line);
    return match ? [{ id: Number(match[1]), source, line: index + 1, label: `T${match[1]} / ${match[2].trim()}`, oracle: match[3].trim() }] : [];
  }));
  const scope = (name, first, last) => {
    const selected = records.filter(row => row.id >= first && row.id <= last);
    const expected = Array.from({ length: last - first + 1 }, (_, index) => first + index);
    const missing = expected.filter(id => !selected.some(row => row.id === id));
    const duplicate = expected.filter(id => selected.filter(row => row.id === id).length > 1);
    const empty = selected.filter(row => !row.oracle || /^[-:|\s]+$/.test(row.oracle)).map(row => row.id);
    return { name, first, last, rows: selected, missing, duplicate, empty,
      complete: missing.length === 0 && duplicate.length === 0 && empty.length === 0 };
  };
  const core = scope("core", 1, 77), tiered = scope("tiered-target", 78, 90);
  // TEST-008: product surface acceptance uses T91 onward, open-ended. A gap or an
  // empty oracle there is a finding; several oracle rows under one ID (one
  // meaning, e.g. T119's entry wiring) are listed, not failed. Two meanings under
  // one ID are resolved in the matrix by a new ID, not here.
  const productIds = records.filter(row => row.id >= 91).map(row => row.id);
  const product = productIds.length === 0
    ? { name: "product", first: 91, last: 90, rows: [], missing: [], duplicate: [], empty: [], complete: true }
    : (() => { const last = Math.max(...productIds); const view = scope("product", 91, last);
        return { ...view, complete: view.missing.length === 0 && view.empty.length === 0 }; })();
  return { core, tiered, product, extra: records.filter(row => row.id < 1),
    complete: core.complete && tiered.complete && product.complete && records.every(row => row.id >= 1) };
}
/** Real source traversal, not the possibly stale generated production-files.txt.
 * Symlinks and unsupported filesystem entries fail instead of reducing the scope.
 */
export function sourceFiles(root, relative) {
  const path = join(root, relative); const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`symlink in source closure: ${relative}`);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) throw new Error(`unsupported source closure input: ${relative}`);
  return readdirSync(path).sort().filter(name =>
    !(/^(?:packages\/[^/]+|apps\/oma)$/.test(relative) && ["dist", "node_modules", ".tsbuildinfo"].includes(name)) &&
    !(relative === "implementation" && name === "evidence") && !(relative === "docs" && name === "archive"))
    .flatMap(name => sourceFiles(root, `${relative}/${name}`));
}
