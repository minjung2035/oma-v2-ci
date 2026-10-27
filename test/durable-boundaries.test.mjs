/** P0-7 (docs/PRIORITY-0.md): the durable boundaries come from the code, and each
 * one has a test that kills, retries or restarts right after it. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDurableBoundaries, durableBoundaries } from "../scripts/durable-boundaries.mjs";

test("P0-7: every durable boundary in the code has a registered kill/retry/restart test", () => {
  assert.deepEqual(checkDurableBoundaries(), []);
  assert.ok(durableBoundaries().length > 40, "the scan finds the product's boundaries");
});

test("P0-7: a new boundary without a test, a stale entry, or a test that does not exist is a finding", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-7-"));
  try {
    mkdirSync(join(root, "apps/oma/src"), {recursive:true}); mkdirSync(join(root, "test")); mkdirSync(join(root, "implementation"));
    writeFileSync(join(root, "production-files.txt"), "apps/oma/src/owner.ts\n");
    writeFileSync(join(root, "apps/oma/src/owner.ts"), "export function commitIt(store) { store.transaction(tx => tx.x()); }\n");
    writeFileSync(join(root, "test/it.test.mjs"), 'test("kills right after commitIt", () => {});\n');
    const registry = boundaries => writeFileSync(join(root, "implementation/durable-boundaries.json"), JSON.stringify({ boundaries }));
    registry([]);
    assert.match(checkDurableBoundaries(root).join("\n"), /src\/owner\.ts#commitIt: a durable boundary \(db-commit\) has no registered/);
    registry([{ owner: "apps/oma/src/owner.ts#commitIt", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "a test that is not there", injection: "logical" }] },
      { owner: "apps/oma/src/owner.ts#gone", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "kills right after commitIt", injection: "logical" }] }]);
    const findings = checkDurableBoundaries(root).join("\n");
    assert.match(findings, /has no test titled "a test that is not there"/);
    assert.match(findings, /src\/owner\.ts#gone: registered, but no such durable boundary exists/);
    registry([{ owner: "apps/oma/src/owner.ts#commitIt", fact: "a fact", tests: [{ file: "test/it.test.mjs", title: "kills right after commitIt", injection: "logical" }] }]);
    assert.deepEqual(checkDurableBoundaries(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0-7, P0V-59: a primitive imported under another name is still a boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-7-alias-"));
  try {
    mkdirSync(join(root, "apps/oma/src"), {recursive:true}); mkdirSync(join(root, "implementation"));
    writeFileSync(join(root, "production-files.txt"), "apps/oma/src/owner.ts\n");
    writeFileSync(join(root, "apps/oma/src/owner.ts"),
      'import { replaceDerivedFile as recordIt } from "./storage/durable-fs.js";\nexport function keep(path) { recordIt(path, "x"); }\n');
    writeFileSync(join(root, "implementation/durable-boundaries.json"), JSON.stringify({ boundaries: [] }));
    assert.deepEqual(durableBoundaries(root).map(entry => entry.owner), ["apps/oma/src/owner.ts#keep"]);
    assert.match(checkDurableBoundaries(root).join("\n"), /src\/owner\.ts#keep: a durable boundary \(file-publication\) has no registered/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("P0V-83 / R6-08: a test says how it stops the process, and its code has to show it", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p0-7-injection-"));
  try {
    mkdirSync(join(root, "apps/oma/src"), {recursive:true}); mkdirSync(join(root, "test/fixtures"), { recursive: true }); mkdirSync(join(root, "implementation"));
    writeFileSync(join(root, "production-files.txt"), "apps/oma/src/owner.ts\n");
    writeFileSync(join(root, "apps/oma/src/owner.ts"), "export function commitIt(store) { store.transaction(tx => tx.x()); }\n");
    writeFileSync(join(root, "test/fixtures/killer.ts"), 'export function killWorker(child) { child.kill("SIGKILL"); }\n');
    writeFileSync(join(root, "test/it.test.mjs"), [
      'import { killWorker } from "./fixtures/killer.js";',
      'function crashAt(child) { child.kill("SIGKILL"); }',
      '// test("only in a comment", () => {});',
      'test("kills through a helper of this file", () => { crashAt(child); });',
      'test("kills through a fixture", () => { killWorker(child); });',
      'test("kills a child script", () => { run(`process.kill(process.pid, "SIGKILL")`); });',
      'test("faults through an observer", () => { commitIt(store, fault => { throw new Error("injected"); }); });',
      'test("retries only", () => { commitIt(store); commitIt(store); });',
      'test("signals something else", () => { child.kill("SIGTERM"); });',
    ].join("\n"));
    const check = (title, injection) => {
      writeFileSync(join(root, "implementation/durable-boundaries.json"), JSON.stringify({ boundaries: [
        { owner: "apps/oma/src/owner.ts#commitIt", fact: "a fact", tests: [{ file: "test/it.test.mjs", title, ...(injection === undefined ? {} : { injection }) }] }] }));
      return checkDurableBoundaries(root).join("\n");
    };
    // Accept: the injection is in the test, in a helper it calls, in a fixture it imports, or in the child it runs.
    for (const title of ["kills through a helper of this file", "kills through a fixture", "kills a child script"])
      assert.equal(check(title, "sigkill"), "", title);
    assert.equal(check("faults through an observer", "in-process-fault"), "");
    assert.equal(check("retries only", "logical"), "");
    // Near miss: saying less than the test does is not a finding.
    assert.equal(check("kills through a fixture", "logical"), "");
    // Reject: no injection named, or one the code does not show.
    assert.match(check("retries only"), /does not say how it stops the process/);
    assert.match(check("retries only", "kill -9"), /does not say how it stops the process/);
    assert.match(check("retries only", "sigkill"), /registered as sigkill, but its code shows logical/);
    assert.match(check("signals something else", "sigkill"), /registered as sigkill, but its code shows logical/);
    assert.match(check("retries only", "in-process-fault"), /registered as in-process-fault, but its code shows logical/);
    assert.match(check("faults through an observer", "sigkill"), /registered as sigkill, but its code shows in-process-fault/);
    // Reject: a title that is only a comment is no test.
    assert.match(check("only in a comment", "logical"), /has no test titled "only in a comment"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
