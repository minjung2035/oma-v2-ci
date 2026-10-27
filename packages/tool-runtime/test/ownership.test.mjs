import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainedWriter } from "@oma/tool-runtime/contained-tools";
import { createToolProvenance } from "@oma/tool-runtime/provenance";

test("a refused queued write does not poison the next contained write", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-tool-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const write = createContainedWriter(workspace);
  const first = write(join(root, "escape"), "must refuse");
  const second = write(join(workspace, "nested", "answer"), "complete");
  await assert.rejects(first);
  await second;
  assert.equal(existsSync(join(root, "escape")), false);
  assert.equal(readFileSync(join(workspace, "nested", "answer"), "utf8"), "complete");
});
test("a later tool shadow is checked against the current registry", () => {
  let tools = [{ name: "read", sourceInfo: { source: "builtin" } }];
  const proof = createToolProvenance(() => tools, "/owned/core.js", []);
  assert.equal(proof.permitted("read"), true);
  tools = [{ name: "read", sourceInfo: { source: "extension", path: "/unverified/shadow.js" } }];
  assert.equal(proof.permitted("read"), false);
  assert.equal(proof.own("read"), false);
  tools = [];
  assert.equal(proof.permitted("read"), false);
});
