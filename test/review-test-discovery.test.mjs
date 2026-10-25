/** A relocated real oracle keeps its ID; source snippets cannot invent one. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { testNames, oraclePresent } from "../scripts/review-closure.mjs";

test("DR46: review discovery follows authored workspace tests without counting comments, strings, fixtures or vendor tests", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-review-oracle-owner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put("test/root.test.mjs", 'import test from "node:test"; test("ROOT: actual declaration", () => {});\n// test("COMMENT: never declared", () => {});\nconst example = \'test("STRING: never declared", () => {});\';');
  put("packages/feature/package.json", '{"name":"@oma/feature","version":"0.1.0"}');
  put("packages/feature/test/bridge.test.mjs", 'import test from "node:test"; test("post-listen: same moved oracle", () => {});');
  put("packages/feature/test/fixtures/unused.test.mjs", 'test("FIXTURE: never selected", () => {});');
  put("packages/feature/src/vendor/upstream/unused.test.mjs", 'test("VENDOR: never selected", () => {});');
  const names = testNames(root);
  assert.deepEqual(names.sort(), ["ROOT: actual declaration", "post-listen: same moved oracle"].sort());
  assert.equal(oraclePresent(names, "post-listen"), true);
  for (const id of ["COMMENT", "STRING", "FIXTURE", "VENDOR"]) assert.equal(oraclePresent(names, id), false);
});

test("DR46: review discovery refuses linked oracle sources instead of reading another owner's tests", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-review-linked-oracle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "outside.mjs"), 'test("FOREIGN: not this tree", () => {});');
  symlinkSync(join(root, "outside.mjs"), join(root, "test/linked.test.mjs"));
  assert.throws(() => testNames(root), /symlink in authored test sources/);
});
