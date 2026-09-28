/** R6-01 / R6-18 (PR-004, architecture §4): the model's file tools make their
 * effects through the containment primitives -- a link anywhere on the way,
 * dangling or not, is refused rather than followed, and the workspace quota
 * is decided at the moment of the write. The tools are the engine's own,
 * registered with OMA's operations, and are run here the way the engine runs
 * them. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containWorkspaceTools } from "../src/extension/contained-tools.js";
import { guardWorkspaceTools } from "../src/extension/workspace-guard.js";

type Tool = { name: string; execute(id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown): Promise<{ content: { type: string; text?: string }[] }> };

function world(t: import("node:test").TestContext, quota: number | null = 1024 * 1024, sandboxed = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oma-contained-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "workspace"); mkdirSync(workspace);
  const outside = join(base, "host-home"); mkdirSync(outside);
  const tools: Record<string, Tool> = {};
  containWorkspaceTools({ registerTool: (tool: Tool) => { tools[tool.name] = tool; } } as never, workspace, quota, sandboxed);
  const run = async (name: string, params: Record<string, unknown>): Promise<string> => {
    const result = await tools[name]!.execute("call", params, undefined, undefined, { cwd: workspace });
    return result.content.map(part => part.text ?? "").join("");
  };
  return { base, workspace, outside, tools, run };
}
const refused = (error: unknown) => error instanceof Error && /link|not followed|other names|outside/.test(error.message);

test("P0V-74 / R6-01: a write through a dangling link is refused and makes nothing outside the workspace", async t => {
  const { workspace, outside, run } = world(t);
  const planted = join(outside, ".profile-planted");
  symlinkSync(planted, join(workspace, "notes.md"));
  await assert.rejects(run("write", { path: "notes.md", content: "echo pwned\n" }), refused);
  assert.equal(existsSync(planted), false, "no file was made outside the workspace");
  // The check the guard does for every path tool refuses it too.
  let hook: ((event: { toolName: string; input: unknown }) => unknown) | undefined;
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never, workspace, 1024 * 1024, false);
  for (const tool of ["write", "grep", "find", "read"])
    assert.deepEqual(hook!({ toolName: tool, input: { path: "notes.md", content: "x" } }), { block: true, reason: "tool path is outside the agent workspace" }, tool);
});

test("P0V-74 / R6-01: a directory link on the way is refused for every contained tool, and an existing target outside is not read", async t => {
  const { workspace, outside, run } = world(t);
  writeFileSync(join(outside, "secret"), "host secret\n");
  symlinkSync(outside, join(workspace, "linked"));
  await assert.rejects(run("write", { path: "linked/new.txt", content: "x" }), refused);
  await assert.rejects(run("read", { path: "linked/secret" }), refused);
  await assert.rejects(run("edit", { path: "linked/secret", edits: [{ oldText: "host", newText: "model" }] }), refused);
  await assert.rejects(run("ls", { path: "linked" }), refused);
  assert.equal(readFileSync(join(outside, "secret"), "utf8"), "host secret\n");
  assert.equal(existsSync(join(outside, "new.txt")), false);
});

test("P0V-74 / R6-01: a file with another name is not written through", async t => {
  const { workspace, outside, run } = world(t);
  writeFileSync(join(outside, "profile"), "original\n");
  linkSync(join(outside, "profile"), join(workspace, "alias"));
  await assert.rejects(run("write", { path: "alias", content: "changed\n" }), refused);
  assert.equal(readFileSync(join(outside, "profile"), "utf8"), "original\n", "not even truncated");
});

test("PR-004: inside the workspace the tools work as the engine's own do", async t => {
  const { workspace, run } = world(t);
  await run("write", { path: "a/b/c.txt", content: "one\ntwo\n" });
  assert.equal(readFileSync(join(workspace, "a/b/c.txt"), "utf8"), "one\ntwo\n", "parents are made");
  await run("edit", { path: "a/b/c.txt", edits: [{ oldText: "two", newText: "three" }] });
  assert.equal(readFileSync(join(workspace, "a/b/c.txt"), "utf8"), "one\nthree\n");
  assert.match(await run("read", { path: "a/b/c.txt" }), /one\s*\n.*three/s);
  assert.match(await run("ls", { path: "a" }), /b\//);
});

test("P0V-74 / R6-18: the quota is decided at the write, so two writes that each fit cannot together exceed it", async t => {
  const { workspace, run } = world(t, 1000);
  const results = await Promise.allSettled([run("write", { path: "one", content: "x".repeat(600) }), run("write", { path: "two", content: "y".repeat(600) })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.match(String((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason), /quota/);
  assert.equal([existsSync(join(workspace, "one")), existsSync(join(workspace, "two"))].filter(Boolean).length, 1);
});

test("SB-001: inside the sandbox only write and edit are replaced; reading is the mount plan's", t => {
  const { tools } = world(t, 1024, true);
  assert.deepEqual(Object.keys(tools).sort(), ["edit", "write"]);
});

test("PI-001: the extension's entryAt mirrors the storage primitive -- it accepts and refuses the same entries and names the same path", async () => {
  const { entryAt: mirror } = await import("../src/extension/contained-files.js");
  const { entryAt: original } = await import("../src/storage/contained-fs.js");
  const outcome = (entry: (fd: number, name: string) => string, fd: number, name: string): string => {
    try { return entry(fd, name); } catch { return "refused"; }
  };
  for (const [fd, name] of [[3, "a"], [12, "notes.md"], [3, "한글"], [3, ""], [3, "."], [3, ".."], [3, "a/b"], [3, "a\0b"], [-1, "a"], [1.5, "a"]] as const)
    assert.equal(outcome(mirror, fd, name), outcome(original, fd, name), `${fd} ${JSON.stringify(name)}`);
});
