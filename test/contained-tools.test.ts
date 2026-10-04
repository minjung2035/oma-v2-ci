/** R6-01 / R6-18 (PR-004, architecture §4): the model's file tools make their
 * effects through the containment primitives -- a link anywhere on the way,
 * dangling or not, is refused rather than followed, and the workspace quota
 * is decided at the moment of the write. The tools are the engine's own,
 * registered with OMA's operations, and are run here the way the engine runs
 * them. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containWorkspaceTools } from "../src/extension/contained-tools.js";
import { guardWorkspaceTools, workspaceUsage } from "../src/extension/workspace-guard.js";

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
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never, workspace, false);
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

test("G10-02: search snapshots hold the source root through replacement and remove private copies on every outcome", async t => {
  const { withSearchSnapshot } = await import("../src/extension/contained-files.js");
  const { workspace, outside } = world(t);
  writeFileSync(join(workspace, "a.txt"), "workspace text");
  writeFileSync(join(outside, "secret.txt"), "host secret");
  const pending = withSearchSnapshot(workspace, ".", 1024, undefined, async snapshot => {
    assert.equal(readFileSync(join(snapshot, "a.txt"), "utf8"), "workspace text");
    assert.equal(existsSync(join(snapshot, "secret.txt")), false);
    return snapshot;
  });
  renameSync(workspace, workspace + "-held"); symlinkSync(outside, workspace);
  const snapshot = await pending;
  assert.equal(existsSync(snapshot), false);
  rmSync(workspace); renameSync(workspace + "-held", workspace);
  let failedSnapshot = "";
  await assert.rejects(withSearchSnapshot(workspace, ".", 1024, undefined, async path => {
    failedSnapshot = path; throw new Error("injected walker failure");
  }), /injected walker failure/);
  assert.equal(existsSync(failedSnapshot), false);
  await assert.rejects(withSearchSnapshot(workspace, ".", 4, undefined, async () => assert.fail("over budget search ran")), /budget/);
  const controller = new AbortController();
  const cancelled = withSearchSnapshot(workspace, ".", 1024, controller.signal, async () => assert.fail("cancelled search ran"));
  controller.abort(); await assert.rejects(cancelled, /aborted/);
});

test("G10-02: contained grep and find preserve regex, glob and workspace ignore rules", async t => {
  const { workspace, outside, run } = world(t);
  const previousConfig = process.env.RIPGREP_CONFIG_PATH;
  const config = join(outside, "ripgrep-config");
  writeFileSync(config, "--glob\n!*.txt\n");
  process.env.RIPGREP_CONFIG_PATH = config;
  t.after(() => { if (previousConfig === undefined) delete process.env.RIPGREP_CONFIG_PATH; else process.env.RIPGREP_CONFIG_PATH = previousConfig; });
  writeFileSync(join(workspace, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(workspace, "ignored.txt"), "secret ignored\n");
  writeFileSync(join(workspace, "a.txt"), "first\nSecret kept\nlast\n");
  writeFileSync(join(workspace, "a.js"), "secret javascript\n");
  // ripgrep's explicit positive --glob overrides .gitignore; test the two
  // engine semantics separately rather than inventing a different rule.
  const grep = await run("grep", { pattern: "^secret kept", ignoreCase: true, context: 1 });
  assert.match(grep, /Secret kept/); assert.match(grep, /first/); assert.match(grep, /last/);
  assert.doesNotMatch(grep, /ignored|javascript|oma-search-/);
  assert.doesNotMatch(await run("grep", { pattern: "ignored" }), /secret ignored/);
  assert.match(await run("grep", { pattern: "secret", ignoreCase: true, glob: "*.js" }), /a.js:1: secret javascript/);
  const find = await run("find", { pattern: "*.txt" });
  assert.match(find, /a.txt/); assert.doesNotMatch(find, /ignored|a.js|oma-search-/);
});

test("G10-02 / P0-4: killing the search caller during copying leaves no snapshot or live search process", { timeout: 15000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  // Many copy yields keep this deterministic without a paid provider or a
  // production-only test hook. Observe the actual child and actual snapshot.
  for (let n = 0; n < 500; n++) writeFileSync(join(workspace, `${n}.txt`), "needle\n".repeat(1000));
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    await searchWorkspace('grep',process.argv[2],{pattern:'needle'},10000000);`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL("../src/extension/contained-search.js", import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: "ignore" });
  const exited = new Promise<void>(resolve => parent.once("close", () => resolve()));
  let children: number[] = [];
  t.after(async () => {
    parent.kill("SIGKILL"); await exited;
    for (const pid of children) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
  });
  for (let n = 0; n < 500 && readdirSync(temporary).length === 0; n++) await delay(5);
  assert.ok(readdirSync(temporary).some(name => name.startsWith("oma-search-")), "no live snapshot observed");
  children = readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
  assert.equal(children.length, 1, "the copy and walker must have one process owner");
  parent.kill("SIGKILL"); await exited;
  const live = (pid: number): boolean => {
    try { return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  for (let n = 0; n < 500 && (readdirSync(temporary).length || children.some(live)); n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), [], "a dead caller left private workspace data");
  assert.equal(children.some(live), false, "a dead caller left a live search owner");
});

for (const outcome of ["abort", "parent-death"] as const) test(`G10-02 / P0-4: ${outcome} removes the copy and kills an uncooperative search walker`, { timeout: 15000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  const agent = join(base, "agent"); const bin = join(agent, "bin"); mkdirSync(bin, { recursive: true });
  const marker = join(base, "walker-pid");
  writeFileSync(join(bin, "rg"), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';
    if(process.argv.includes('--version')) process.exit(0);
    writeFileSync(${JSON.stringify(marker)},String(process.pid));
    process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, { mode: 0o755 });
  writeFileSync(join(workspace, "a.txt"), "needle");
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    const controller=new AbortController();
    if(process.argv[3]==='abort'){process.stdin.resume();process.stdin.once('data',()=>controller.abort());}
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'},1000000,controller.signal);process.exitCode=2;}
    catch{process.exitCode=0;}finally{process.stdin.pause();}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL("../src/extension/contained-search.js", import.meta.url).href, workspace, outcome],
    { env: { ...process.env, TMPDIR: temporary, PI_CODING_AGENT_DIR: agent }, stdio: ["pipe", "ignore", "ignore"] });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  parent.stdin.on("error", () => {});
  let walker: number | undefined; let owner: number | undefined;
  t.after(async () => {
    parent.kill("SIGKILL"); await exited;
    if (owner !== undefined) { try { process.kill(-owner, "SIGKILL"); } catch { /* already gone */ } }
  });
  for (let n = 0; n < 1000 && !existsSync(marker); n++) await delay(5);
  assert.ok(existsSync(marker), "the pinned engine never started the walker");
  walker = Number(readFileSync(marker, "utf8"));
  owner = Number(readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim());
  assert.ok(Number.isSafeInteger(owner) && owner > 0);
  assert.ok(readdirSync(temporary).length > 0);
  if (outcome === "abort") { parent.stdin.write("abort"); assert.equal(await exited, 0); }
  else { parent.kill("SIGKILL"); await exited; }
  const live = (): boolean => {
    try { return !/\) Z /.test(readFileSync(`/proc/${walker}/stat`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  for (let n = 0; n < 500 && (readdirSync(temporary).length || live()); n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), []);
  assert.equal(live(), false, "the walker ignored termination and survived its owner");
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


test("DR27/INV10: empty files and parents have finite cost; a refused write creates neither", async t => {
  const { workspace, run } = world(t, 4);
  assert.equal(workspaceUsage(workspace, 4), 1);
  await run("write", { path: "a/b/empty", content: "" });
  assert.equal(workspaceUsage(workspace, 4), 4);
  await run("write", { path: "a/b/empty", content: "" });
  await assert.rejects(run("write", { path: "next", content: "" }), /quota/);
  await assert.rejects(run("write", { path: "refused/parent/empty", content: "" }), /quota/);
  assert.equal(existsSync(join(workspace, "next")), false);
  assert.equal(existsSync(join(workspace, "refused")), false);
  assert.equal(workspaceUsage(workspace, 4), 4);
});

test("DR27/INV10: concurrent empty-file writes and their parent directories share the same quota owner", async t => {
  const { workspace, run } = world(t, 3);
  const results = await Promise.allSettled([run("write", { path: "a/empty", content: "" }), run("write", { path: "b/empty", content: "" })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(readdirSync(workspace).length, 1);
  assert.equal(workspaceUsage(workspace, 3), 3);
});

test("DR27/INV10: aliases cost metadata once per name and data once per inode; links are not followed", t => {
  const { workspace, outside } = world(t);
  writeFileSync(join(workspace, "a"), "data");
  linkSync(join(workspace, "a"), join(workspace, "b"));
  assert.equal(workspaceUsage(workspace, 100), 7);
  mkdirSync(join(workspace, "empty")); assert.equal(workspaceUsage(workspace, 100), 8);
  symlinkSync("../host-home", join(workspace, "link"));
  const before = workspaceUsage(workspace, 100);
  writeFileSync(join(outside, "large"), "x".repeat(200));
  assert.equal(workspaceUsage(workspace, 100), before);
});

test("FI-4: a workspace holding a real project's Git history and installed dependencies still takes a small write", async t => {
  // The quota bounds what the agent authors through its tools. History the
  // clone came with and the trees a package manager or build regenerates
  // (made through the shell, which the quota never bounded) are not that.
  const { workspace, run } = world(t, 64 * 1024);
  const bulk = "x".repeat(256 * 1024);
  for (const directory of [".git/objects/pack", "node_modules/left-pad", "packages/app/node_modules/react", ".venv/lib",
    "target/debug", "dist", "build"]) {
    mkdirSync(join(workspace, directory), { recursive: true });
    writeFileSync(join(workspace, directory, "artifact"), bulk);
  }
  await run("write", { path: "src/index.ts", content: "export const answer = 42;\n" });
  await run("edit", { path: "src/index.ts", edits: [{ oldText: "42", newText: "43" }] });
  assert.equal(readFileSync(join(workspace, "src/index.ts"), "utf8"), "export const answer = 43;\n");
  // What the agent authors still counts, wherever it sits outside those trees.
  writeFileSync(join(workspace, "src", "generated.json"), bulk);
  await assert.rejects(run("write", { path: "src/more.ts", content: "x" }), /quota/);
});

test("FI-4: the excluded trees are skipped by directory name only, never as files or at the root", t => {
  const { workspace } = world(t);
  writeFileSync(join(workspace, "build"), "data");
  mkdirSync(join(workspace, "node_modules")); writeFileSync(join(workspace, "node_modules", "pkg"), "x".repeat(50));
  // The root (1) and a file named like an excluded tree (1 + 4) are counted;
  // the excluded directory and everything under it are not.
  assert.equal(workspaceUsage(workspace, 100), 6);
  // A workspace that is itself named like an excluded tree is still counted.
  assert.equal(workspaceUsage(join(workspace, "node_modules"), 100), 52);
});

test("DR27/P0V-122: at the exact quota an equal-size edit and a shrinking write remain allowed", async t => {
  const { workspace, run } = world(t, 5);
  await run("write", { path: "a", content: "abc" });
  assert.equal(workspaceUsage(workspace, 5), 5);
  await run("edit", { path: "a", edits: [{ oldText: "abc", newText: "def" }] });
  await assert.rejects(run("write", { path: "a", content: "grow" }), /quota/);
  assert.equal(readFileSync(join(workspace, "a"), "utf8"), "def");
  await run("write", { path: "a", content: "" });
  await run("write", { path: "b", content: "xy" });
  assert.equal(workspaceUsage(workspace, 5), 5);
});
