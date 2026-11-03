import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchWorkspace } from "@oma/tool-runtime/contained-search";
import { readResult, createResult } from "@oma/tool-files";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";
import { guardWorkspaceTools } from "@oma/tool-runtime/workspace-guard";

test("001. Principal streams a 1.8 MB UTF-8 line and pages reconstruct exact result", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-improvement-results-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace"), results = join(root, "results"); mkdirSync(workspace); mkdirSync(results);
  const source = `needle${"한".repeat(600000)}\n`; writeFileSync(join(workspace, "long.txt"), source);
  const answer = await searchWorkspace("grep", workspace, { pattern: "needle" }, undefined, undefined, { root: results });
  assert.ok(Buffer.byteLength(JSON.stringify(answer)) <= 32768);
  const meta = (answer.details as { result: { complete: boolean; reference: string; bytes: number } }).result;
  assert.equal(meta.complete, true); assert.ok(meta.bytes > 1_580_000);
  const pages: string[] = []; let cursor: number | null = 0;
  do { const page = readResult(results, meta.reference, { byteOffset: cursor }); pages.push(page.text); cursor = page.next; } while (cursor !== null);
  assert.equal(pages.join(""), `long.txt:1: ${source}`);
  const tools: string[] = []; containWorkspaceTools({ registerTool: (tool: {name: string}) => { tools.push(tool.name); } } as never, workspace, false, true);
  assert.ok(!tools.includes("write") && !tools.includes("bash"));
  let gate: (event: unknown) => unknown = () => {}; guardWorkspaceTools({ on: (_: string, callback: typeof gate) => { gate = callback; } } as never, workspace, false, true);
  assert.equal(gate({ toolName: "read", input: { path: meta.reference } }), undefined);
  assert.deepEqual(gate({ toolName: "write", input: { path: "long.txt" } }), { block: true, reason: "the Principal reviews code but does not write or edit files" });
  const other = join(root, "other"); mkdirSync(other);
  assert.throws(() => readResult(other, meta.reference));
  const id = meta.reference.split(":")[1]!; const file = join(results, `${id}.result`);
  rmSync(file); symlinkSync(join(workspace, "long.txt"), file);
  assert.throws(() => readResult(results, meta.reference), /link|ELOOP/);
});

test("002. Storage failure is bounded partial output; explicit match limit is reported separately", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-improvement-partial-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "source.txt"), `needle${"x".repeat(100000)}\nneedle two\nneedle three\n`);
  const bad = join(root, "not-a-directory"); writeFileSync(bad, "");
  const partial = await searchWorkspace("grep", root, { pattern: "needle" }, undefined, undefined, { root: bad });
  assert.ok(Buffer.byteLength(JSON.stringify(partial)) <= 32768);
  const pm = (partial.details as { result: { complete: boolean; reason: string; read: unknown } }).result;
  assert.equal(pm.complete, false); assert.ok(pm.reason); assert.equal(pm.read, null);
  const limited = await searchWorkspace("grep", root, { pattern: "needle", limit: 1 }, undefined, undefined, { root: join(root, "results") });
  const lm = (limited.details as { result: { complete: boolean; limitReached: boolean } }).result;
  assert.equal(lm.complete, true); assert.equal(lm.limitReached, true);
});

test("003. Immutable result detects content replacement and line range preserves UTF-8", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-improvement-reader-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const writer = createResult(root); writer.append(Buffer.from("one\n둘째줄\nthree\n")); const result = writer.finish();
  assert.equal(readResult(root, result.reference, { line: 2 }).text, "둘째줄\nthree\n");
  assert.throws(() => readResult(root, result.reference, { byteOffset: 5 }));
  writeFileSync(join(root, `${result.reference.split(":")[1]}.result`), "changed");
  assert.throws(() => readResult(root, result.reference), /digest/);
});

import { fixture } from "./fixtures/review-fixture.js";
import { runGitText } from "@oma/process/policies";

test("004. Large automatic diff is accepted as an exact readable artifact under a small notice bound", async () => {
  const f = fixture({ bundleBytes: 8192 });
  try {
    const candidate = f.candidateWith({ "large.txt": "change\n".repeat(20000) }); await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "large");
    const op = f.applyOp("alice", "large")!;
    assert.equal(op.state, "succeeded"); assert.ok(op.kind === "git.integrate"); assert.equal(op.plan.merge?.version, 3);
    const diff = op.plan.merge?.version === 3 ? op.plan.merge.diff : undefined; assert.ok(diff);
    const chunks: Buffer[] = []; let cursor: number | null = 0;
    do { const page = readResult(join(f.projectGit, "oma-results"), diff.reference, { byteOffset: cursor, encoding: "base64" }); chunks.push(Buffer.from(page.dataBase64, "base64")); cursor = page.next; } while (cursor !== null);
    const actual = runGitText(["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", op.plan.base, candidate], { gitDir: f.projectGit });
    assert.equal(actual.status, 0, actual.stderr);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(actual.stdout), "every stored patch byte matches an independent Git observation, not the removed notice fallback");
    f.reopen(); assert.equal(f.stateOf(f.requestName("large")).display, "applied");
  } finally { f.close(); }
});
