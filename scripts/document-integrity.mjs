#!/usr/bin/env node
import { VENDORED_EXTENSION_DIRS } from "./vendored-source-roots.mjs";
/** PRIORITY-0 "문서와 식별자에도 같은 원칙", P0-7: the durable boundaries of the
 * documents are checked by machine. A requirement ID or an acceptance number,
 * once given, has one meaning (P0-1); acceptance rows live in the matrix that
 * owns them (P0-2); a committed link or anchor still resolves (P0-3).
 * Importing this module reads nothing. `node scripts/document-integrity.mjs`
 * checks this repository and exits 1 on any finding. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { inventoryAcceptance, inventoryClauses, normativeSources } from "./traceability.mjs";

export const ACCEPTANCE_OWNER = "docs/verification-spec.md";
const ACCEPTANCE_ROW = /^\|\s*T(\d+)\s*\/\s*[^|]+\|/;

/** Requirement IDs defined by more than one clause. */
export function duplicateRequirements(documents) {
  const by = new Map();
  for (const entry of inventoryClauses(documents)) {
    const id = entry.requirement.split(";")[0].trim();
    by.set(id, [...(by.get(id) ?? []), entry.source]);
  }
  return [...by].filter(([, sources]) => sources.length > 1).map(([id, sources]) => `${id} is defined ${sources.length} times (${sources.join(", ")})`);
}

/** Acceptance rows outside the matrix that owns acceptance numbers, and the
 * matrix's own number problems: a duplicate in the Core or tiered band, a gap or
 * an empty oracle in the product band (TEST-008). */
export function acceptanceFindings(documents) {
  const findings = [];
  for (const { source, text } of documents) {
    if (source === ACCEPTANCE_OWNER) continue;
    text.split(/\r?\n/).forEach((line, index) => {
      if (ACCEPTANCE_ROW.test(line)) findings.push(`${source}:${index + 1} looks like an acceptance row; acceptance numbers belong to ${ACCEPTANCE_OWNER}`);
    });
  }
  const matrix = documents.filter(document => document.source === ACCEPTANCE_OWNER);
  const acceptance = inventoryAcceptance(matrix);
  for (const scope of [acceptance.core, acceptance.tiered])
    if (scope.duplicate.length) findings.push(`${scope.name}: T${scope.duplicate.join(", T")} has more than one row`);
  if (acceptance.product.missing.length) findings.push(`product: T${acceptance.product.missing.join(", T")} is missing`);
  if (acceptance.product.empty.length) findings.push(`product: T${acceptance.product.empty.join(", T")} has an empty oracle`);
  return findings;
}

function anchorsOf(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) out.add(heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
  }
  return out;
}

/** Relative links and anchors that do not resolve in `files` under `root`. */
export function brokenLinks(root, files) {
  const findings = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [path, fragment] = target.split("#", 2);
      const resolved = path ? normalize(join(dirname(file), path)) : file;
      if (!existsSync(join(root, resolved))) { findings.push(`${file}: ${target} names a file that does not exist`); continue; }
      if (fragment && resolved.endsWith(".md") && !anchorsOf(readFileSync(join(root, resolved), "utf8")).has(fragment.toLowerCase()))
        findings.push(`${file}: ${target} names a heading that does not exist`);
    }
  }
  return findings;
}

/** Authored Markdown, including new/untracked files, with immutable archives
 * retained as records rather than evaluated as current guidance. The
 * vendored bundled-extension payload under the reviewed tool workspace vendor directories is
 * byte-pinned upstream data, reviewed through its manifest digest -- its
 * README and docs/ travel with the snapshot and are not authored project
 * documentation. */
export function projectDocuments(root = ".") {
  const ignored = new Set([".git", "node_modules", "dist", "data"]);
  const files = [];
  const walk = relative => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!VENDORED_EXTENSION_DIRS.includes(path)) walk(path); }
      else if (entry.name.endsWith(".md")) files.push(path);
    }
  };
  walk("");
  return files.sort();
}

export function documentLayoutFindings(files) {
  return files.filter(file => file !== "README.md" && !file.startsWith("docs/"))
    .map(file => `${file}: project documentation belongs under docs/`);
}

export function documentIntegrity(root = ".") {
  const read = source => ({ source, text: readFileSync(join(root, source), "utf8") });
  const normative = normativeSources.map(read);
  const files = projectDocuments(root);
  const current = files.filter(file => !file.startsWith("docs/archive/"));
  return [
    ...documentLayoutFindings(files),
    ...duplicateRequirements(normative),
    ...acceptanceFindings([...normative, read("docs/architecture.md")]),
    ...brokenLinks(root, current),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const findings = documentIntegrity(".");
  for (const finding of findings) console.error(finding);
  console.log(`Document integrity: ${findings.length === 0 ? "PASS" : "FAIL"}; ${findings.length} findings.`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}
