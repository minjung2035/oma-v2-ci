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

function changedBy(path) {
  const subjects = execFileSync("git", ["log", "--format=%s", `${base}..HEAD`, "--", path], { encoding: "utf8" });
  return [...new Set(subjects.match(/WP\d{2}/g) ?? [])].sort();
}
const files = [];
for (const path of [...new Set([...current, ...assigned.keys()])].sort()) {
  const primary = assigned.get(path) ?? null;
  if (!current.includes(path)) { files.push({ path, primary, status: "REMOVED", by: changedBy(path), oracles: [] }); continue; }
  const by = changedBy(path);
  if (by.length > 0) {
    const oracles = [...new Set(by.flatMap(wp => oraclesOf.get(wp) ?? []))].filter(id => oraclePresent(names, id)).sort();
    files.push({ path, primary, status: oracles.length > 0 ? "CHANGED_WITH_ORACLE" : "CHANGED_WITHOUT_ORACLE", by, oracles });
  } else if (read.has(path)) {
    const note = read.get(path);
    files.push({ path, primary, status: "READ_UNCHANGED", by: note.by, oracles: note.oracles, note: note.note });
  } else files.push({ path, primary, status: "NOT_REVIEWED", by: [], oracles: [] });
}
const summary = {};
for (const entry of files) summary[entry.status] = (summary[entry.status] ?? 0) + 1;
writeFileSync(LEDGER, `${JSON.stringify({ version: 1, baseline: base, summary, lanes: notes.lanes, files }, null, 1)}\n`);
console.log(JSON.stringify(summary));
