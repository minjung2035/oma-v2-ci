#!/usr/bin/env node
/** WP32: regenerate implementation/review-ledger.json from the plan's
 * assignments, git history since the plan's baseline, the tree's tests and
 * implementation/review-notes.json. Run it; never edit the ledger by hand. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { LEDGER, PLAN, oraclePresent, testNames } from "./review-closure.mjs";

const root = process.cwd();
const plan = JSON.parse(readFileSync(PLAN, "utf8"));
const notes = JSON.parse(readFileSync("implementation/review-notes.json", "utf8"));
const current = readFileSync("production-files.txt", "utf8").split("\n").filter(Boolean);
const names = testNames(root);
const oraclesOf = new Map(plan.tasks.map(task => [task.id, task.tests.map(test => typeof test === "string" ? test : test.id)]));
const assigned = new Map(plan.production_review_assignments.map(row => [row.path, row.primary_review_task]));
const read = new Map(notes.readUnchanged.map(entry => [entry.path, entry]));
const base = plan.baseline_commit;

/** MAC clause ids as the macOS platform spec and its commits write them:
 * "MAC-210/211/230" and "MAC-619..623" name every clause listed or spanned. */
function macIds(text) {
  const ids = [];
  for (const [, first, rest] of text.matchAll(/\bMAC-(\d{3})((?:(?:\/|\.\.)\d{3})*)/g)) {
    let previous = Number(first);
    ids.push(previous);
    for (const [, joint, number] of rest.matchAll(/(\/|\.\.)(\d{3})/g)) {
      const next = Number(number);
      if (joint === "..") for (let id = previous + 1; id < next; id += 1) ids.push(id);
      ids.push(next);
      previous = next;
    }
  }
  return ids.map(id => `MAC-${String(id).padStart(3, "0")}`);
}
/** The macOS platform spec (macos-platform.md, accepted by DR18) names, in
 * its implementation table, the clauses each of its files implements. Its
 * early commits named a section ("§4.7") rather than a clause, so for those
 * files the table is where the clauses are written down. */
function declaredClauses() {
  const text = readFileSync("implementation/macos-platform.md", "utf8");
  const table = text.slice(text.indexOf("### 구현 현황"), text.indexOf("**NOT_BUILT**"));
  const declared = new Map();
  for (const line of table.split("\n")) {
    const cells = line.split("|").map(cell => cell.trim());
    if (cells.length < 5) continue;
    const clauses = macIds(cells[3]);
    for (const [, path] of cells[2].matchAll(/`(src\/[^`]+)`/g)) {
      const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(path);
      for (const file of brace ? brace[2].split(",").map(part => `${brace[1]}${part}${brace[3]}`) : [path])
        declared.set(file, [...new Set([...(declared.get(file) ?? []), ...clauses])]);
    }
  }
  return declared;
}
const declared = declaredClauses();

function changedBy(path) {
  const subjects = execFileSync("git", ["log", "--format=%s", `${base}..HEAD`, "--", path], { encoding: "utf8" });
  // WP cards of the plan, AV cards of the whole-codebase adversarial pass
  // (implementation/consistency-decisions.md), DR design revisions
  // (implementation/design-revisions.md) and Priority 0 findings
  // (implementation/priority-0-audit.md) and MAC clauses of the macOS
  // platform spec, whose oracle is their own id. A
  // finding range ("P0V-40..43") names every finding in it: a file a
  // P0V-only commit changed is changed, not "read and unchanged".
  const cards = [...(subjects.match(/\b(?:WP\d{2}|AV\d+|DR\d+)\b/g) ?? []), ...macIds(subjects)];
  for (const [, from, to] of subjects.matchAll(/\bP0V-(\d+)(?:\.\.(\d+))?/g))
    for (let id = Number(from); id <= Number(to ?? from); id += 1) cards.push(`P0V-${String(id).padStart(2, "0")}`);
  return [...new Set(cards)].sort();
}
const files = [];
for (const path of [...new Set([...current, ...assigned.keys()])].sort()) {
  const primary = assigned.get(path) ?? null;
  if (!current.includes(path)) { files.push({ path, primary, status: "REMOVED", by: changedBy(path), oracles: [] }); continue; }
  const committed = changedBy(path);
  const by = [...new Set([...committed, ...(committed.length > 0 || declared.has(path) ? declared.get(path) ?? [] : [])])].sort();
  if (by.length > 0) {
    const oracles = [...new Set(by.flatMap(card => oraclesOf.get(card) ?? (/^(?:AV|DR|P0V-|MAC-)/.test(card) ? [card] : [])))]
      .filter(id => oraclePresent(names, id)).sort();
    const note = by.some(card => !committed.includes(card)) ? { note: "clauses declared by macos-platform.md's implementation table" } : {};
    files.push({ path, primary, status: oracles.length > 0 ? "CHANGED_WITH_ORACLE" : "CHANGED_WITHOUT_ORACLE", by, oracles, ...note });
  } else if (read.has(path)) {
    const note = read.get(path);
    files.push({ path, primary, status: "READ_UNCHANGED", by: note.by, oracles: note.oracles, note: note.note });
  } else files.push({ path, primary, status: "NOT_REVIEWED", by: [], oracles: [] });
}
const summary = {};
for (const entry of files) summary[entry.status] = (summary[entry.status] ?? 0) + 1;
writeFileSync(LEDGER, `${JSON.stringify({ version: 1, baseline: base, summary, lanes: notes.lanes, files }, null, 1)}\n`);
console.log(JSON.stringify(summary));
