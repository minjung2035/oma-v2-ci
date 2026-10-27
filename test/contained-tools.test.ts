/** R6-01 / R6-18 (PR-004, architecture §4): the model's file tools make their
 * effects through the containment primitives -- a link anywhere on the way,
 * dangling or not, is refused rather than followed. Writes are serialized.
 * The tools are the engine's own,
 * registered with OMA's operations, and are run here the way the engine runs
 * them. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { containWorkspaceTools } from "@oma/tool-runtime/contained-tools";
import { guardWorkspaceTools } from "@oma/tool-runtime/workspace-guard";

type Tool = { name: string; execute(id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown): Promise<{ content: { type: string; text?: string }[] }> };

function world(t: import("node:test").TestContext, sandboxed = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oma-contained-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "workspace"); mkdirSync(workspace);
  const outside = join(base, "host-home"); mkdirSync(outside);
  const tools: Record<string, Tool> = {};
  containWorkspaceTools({ registerTool: (tool: Tool) => { tools[tool.name] = tool; } } as never, workspace, sandboxed);
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

test("C18 / PR-004: a read the guard admitted under the package-store root reaches the file, and nothing else of the host's", async t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oma-contained-store-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "workspace"); mkdirSync(workspace);
  const outside = join(base, "host-home"); mkdirSync(outside);
  const store = join(base, ".packages");
  mkdirSync(join(store, "npm", "pkg", "skills", "roll"), { recursive: true });
  writeFileSync(join(store, "npm", "pkg", "skills", "roll", "SKILL.md"), "# roll\nroll the dice\n");
  writeFileSync(join(outside, "secret"), "host secret\n");
  // A link sitting inside the admitted root, pointing out of it.
  symlinkSync(join(outside, "secret"), join(store, "npm", "pkg", "link.md"));
  const tools: Record<string, Tool> = {};
  containWorkspaceTools({ registerTool: (tool: Tool) => { tools[tool.name] = tool; } } as never,
    workspace, false, false, [store]);
  const run = async (name: string, params: Record<string, unknown>): Promise<string> => {
    const result = await tools[name]!.execute("call", params, undefined, undefined, { cwd: workspace });
    return result.content.map(part => part.text ?? "").join("");
  };
  let hook: ((event: { toolName: string; input: unknown }) => { block: boolean; reason: string } | undefined) | undefined;
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never,
    workspace, false, false, undefined, [store]);
  const skill = join(store, "npm", "pkg", "skills", "roll", "SKILL.md");
  const pkg = join(store, "npm", "pkg");
  // Every read-only tool reaches the store file its call already passed.
  assert.equal(hook!({ toolName: "read", input: { path: skill } }), undefined);
  assert.match(await run("read", { path: skill }), /roll the dice/);
  assert.equal(hook!({ toolName: "ls", input: { path: pkg } }), undefined);
  assert.match(await run("ls", { path: pkg }), /skills\//);
  assert.equal(hook!({ toolName: "grep", input: { pattern: "dice", path: store } }), undefined);
  assert.match(await run("grep", { pattern: "dice", path: store }), /SKILL\.md:2: roll the dice/);
  assert.equal(hook!({ toolName: "find", input: { pattern: "*.md", path: store } }), undefined);
  const found = await run("find", { pattern: "*.md", path: store });
  assert.match(found, /SKILL\.md/);
  assert.doesNotMatch(found, /link\.md/, "the copied tree never carries a link");
  // A path under no admitted root is refused the way it always was, and the
  // host file beside the store is not reached by escaping from it either.
  assert.equal(hook!({ toolName: "read", input: { path: join(outside, "secret") } })?.block, true);
  await assert.rejects(run("read", { path: join(outside, "secret") }), /outside the agent workspace/);
  await assert.rejects(run("read", { path: join(store, "..", "host-home", "secret") }), /outside the agent workspace/);
  await assert.rejects(run("ls", { path: outside }), /outside the agent workspace/);
  // Writes and edits stay inside the workspace even under the admitted store.
  await assert.rejects(run("write", { path: join(pkg, "new.md"), content: "x" }), /outside the agent workspace/);
  await assert.rejects(run("edit", { path: skill, edits: [{ oldText: "dice", newText: "cards" }] }), /outside the agent workspace/);
  assert.equal(existsSync(join(pkg, "new.md")), false);
  assert.equal(readFileSync(skill, "utf8"), "# roll\nroll the dice\n");
  // The link inside the store cannot carry any of the read tools outside.
  for (const [name, params] of [["read", { path: join(pkg, "link.md") }], ["ls", { path: join(pkg, "link.md") }],
    ["grep", { pattern: "secret", path: join(pkg, "link.md") }], ["find", { pattern: "*", path: join(pkg, "link.md") }]] as const)
    await assert.rejects(run(name, params), /outside|link|not followed/, name);
});



test("SB-001: inside the sandbox only write and edit are replaced; reading is the mount plan's", t => {
  const { tools } = world(t, true);
  assert.deepEqual(Object.keys(tools).sort(), ["edit", "write"]);
});

test("G10-02: search snapshots hold the source root through replacement and remove private copies on every outcome", async t => {
  const { withSearchSnapshot } = await import("@oma/tool-files");
  const { workspace, outside } = world(t);
  writeFileSync(join(workspace, "a.txt"), "workspace text");
  writeFileSync(join(outside, "secret.txt"), "host secret");
  const pending = withSearchSnapshot(workspace, ".", undefined, async snapshot => {
    assert.equal(readFileSync(join(snapshot, "a.txt"), "utf8"), "workspace text");
    assert.equal(existsSync(join(snapshot, "secret.txt")), false);
    return snapshot;
  });
  renameSync(workspace, workspace + "-held"); symlinkSync(outside, workspace);
  const snapshot = await pending;
  assert.equal(existsSync(snapshot), false);
  rmSync(workspace); renameSync(workspace + "-held", workspace);
  let failedSnapshot = "";
  await assert.rejects(withSearchSnapshot(workspace, ".", undefined, async path => {
    failedSnapshot = path; throw new Error("injected walker failure");
  }), /injected walker failure/);
  assert.equal(existsSync(failedSnapshot), false);
  assert.equal(await withSearchSnapshot(workspace, ".", undefined, async () => "copied"), "copied");
  const controller = new AbortController();
  const cancelled = withSearchSnapshot(workspace, ".", controller.signal, async () => assert.fail("cancelled search ran"));
  controller.abort(); await assert.rejects(cancelled, /aborted/);
});

test("G10-02 / P0-4: a snapshot's name is declared before the directory can exist -- exists implies announced", async t => {
  const { withSearchSnapshot } = await import("@oma/tool-files");
  const { workspace } = world(t);
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  const announced: string[] = [];
  const result = await withSearchSnapshot(workspace, ".", undefined, async snapshot => {
    // The announced name is the directory the snapshot actually lives under.
    assert.equal(snapshot, join(tmpdir(), announced.at(-1)!, "workspace"));
    return "done";
  }, undefined, name => {
    // The ordering a supervising parent's sweep needs: the name is announced
    // before the directory exists, so a copier killed or stopped between the
    // mkdir and its first yield can never leave a private tree nobody can
    // name. An announce that sees the directory already there is the defect.
    assert.equal(existsSync(join(tmpdir(), name)), false,
      `snapshot ${name} was announced only after it already existed`);
    announced.push(name);
  });
  assert.equal(result, "done");
  assert.equal(announced.length, 1);
  assert.equal(existsSync(join(tmpdir(), announced[0]!)), false, "the declared snapshot was not removed");
});

test("G10-02 / P0-4: an already-taken snapshot name is announced again fresh before the retry", async t => {
  const { withSearchSnapshot } = await import("@oma/tool-files");
  const { workspace } = world(t);
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  const announced: string[] = [];
  let stolen = "";
  // Registered before the await: a withSearchSnapshot that rejects after
  // the steal must not leave the planted oma-search-* directory behind.
  t.after(() => { if (stolen !== "") rmSync(join(tmpdir(), stolen), { recursive: true, force: true }); });
  const result = await withSearchSnapshot(workspace, ".", undefined, async snapshot => {
    assert.equal(snapshot, join(tmpdir(), announced.at(-1)!, "workspace"));
    return "done";
  }, undefined, name => {
    assert.equal(existsSync(join(tmpdir(), name)), false,
      `snapshot ${name} was announced only after it already existed`);
    announced.push(name);
    // Steal the first announced name between declare and create -- the
    // EEXIST retry must announce a fresh name, not reuse the collided one.
    if (announced.length === 1) { stolen = name; mkdirSync(join(tmpdir(), name)); }
  });
  assert.equal(result, "done");
  assert.equal(announced.length, 2, "the collided name was not re-announced fresh");
  assert.notEqual(announced[0], announced[1]);
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
    await searchWorkspace('grep',process.argv[2],{pattern:'needle'});`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: "ignore" });
  const exited = new Promise<void>(resolve => parent.once("close", () => resolve()));
  let children: number[] = [];
  t.after(async () => {
    parent.kill("SIGKILL"); await exited;
    for (const pid of children) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
  });
  // Startup includes loading the real engine in two processes. The test
  // proves cleanup after a kill during copying; its 15 s timeout bounds the
  // observation without imposing an unrelated 2.5 s engine startup budget.
  while (parent.exitCode === null && !t.signal.aborted && readdirSync(temporary).length === 0) await delay(5);
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
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'},controller.signal);process.exitCode=2;}
    catch{process.exitCode=0;}finally{process.stdin.pause();}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace, outcome],
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

test("G10-02 / P0-4: a search child killed externally mid-copy still has its announced snapshot swept", { timeout: 20000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  // Enough entries that the copy is still running when the kill lands.
  for (let n = 0; n < 500; n++) writeFileSync(join(workspace, `${n}.txt`), "needle\n".repeat(1000));
  // The parent stays alive and well -- only the child is SIGKILLed, the way
  // an OOM killer or an operator would. The child cannot run its own cleanup
  // then, so the announced-name sweep on `close` is the only owner left.
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'});process.exitCode=3;}
    catch{process.exitCode=0;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: "ignore" });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  t.after(async () => { try { parent.kill("SIGKILL"); } catch {} await exited; });
  // The child declares the snapshot before the first entry lands; entries in
  // the copy prove the declaration reached the parent before the kill.
  let snap = "";
  for (let n = 0; n < 2000; n++) {
    await delay(5);
    const names = readdirSync(temporary).filter(name => name.startsWith("oma-search-"));
    if (names.length > 0 && existsSync(join(temporary, names[0]!, "workspace")) &&
        readdirSync(join(temporary, names[0]!, "workspace")).length >= 3) { snap = names[0]!; break; }
  }
  assert.ok(snap !== "", "the child's copy never started");
  await delay(100);
  const child = Number(readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim());
  assert.ok(Number.isSafeInteger(child) && child > 0, "no owned search child to kill");
  process.kill(child, "SIGKILL");
  assert.equal(await exited, 0, "the parent did not settle after its child died externally");
  for (let n = 0; n < 500 && readdirSync(temporary).length > 0; n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), [], "an externally killed child left its private copy behind");
});

test("G10-02 / P0-4: a child killed the moment its snapshot exists still leaves nothing undeclared", { timeout: 20000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  // A copy long enough that the directory is observable before it finishes.
  for (let n = 0; n < 300; n++) writeFileSync(join(workspace, `${n}.txt`), "needle\n".repeat(300));
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'});process.exitCode=3;}
    catch{process.exitCode=0;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: "ignore" });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  t.after(async () => { try { parent.kill("SIGKILL"); } catch {} await exited; });
  // The defect window was between the mkdir and the child's first event-loop
  // yield: a buffered {p:"d"} could die with the process and leave a copy
  // nobody could name. Kill at the first moment the directory is observable
  // -- a synchronous poll is the closest a sibling process can get to that
  // window. The declaration is a synchronous pipe write that precedes the
  // mkdir, so by the time the directory exists the parent already holds the
  // name to sweep.
  let observed = "";
  const deadline = Date.now() + 10000;
  while (observed === "" && parent.exitCode === null && Date.now() < deadline)
    observed = readdirSync(temporary).find(name => name.startsWith("oma-search-")) ?? "";
  assert.notEqual(observed, "", "the child's snapshot never appeared");
  let child = 0;
  try { child = Number(readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim()); }
  catch { /* the child is still spawning */ }
  if (Number.isSafeInteger(child) && child > 0) process.kill(child, "SIGKILL");
  assert.equal(await exited, 0, "the parent did not settle after its child died at the earliest sighting");
  for (let n = 0; n < 500 && readdirSync(temporary).length > 0; n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), [], "a killed child's snapshot was left behind -- it was never declared");
});

test("G10-02 / P0-4: the child's declaration bytes reach the pipe before the snapshot can be observed", { timeout: 20000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  for (let n = 0; n < 100; n++) writeFileSync(join(workspace, `${n}.txt`), "needle\n".repeat(50));
  // Drive the real child body over a real pipe: searchChildBody runs the
  // same declare it runs inside the spawned search child, and this process
  // watches the wire and the filesystem side by side.
  const script = `const {searchChildBody}=await import(process.argv[1]);
    const emit=o=>{try{process.stdout.write(JSON.stringify(o)+'\\n')}catch{}};
    const input={name:'grep',root:process.argv[2],params:{path:'.'},maximum:1<<22,heartbeat:50};
    const out=await searchChildBody(input,new AbortController().signal,emit,
      async()=>{await new Promise(r=>setTimeout(r,400));return '{"done":1}';});
    process.stdout.write(out+'\\n');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: ["ignore", "pipe", "ignore"] });
  // close fires once after stdio drains -- every byte the child wrote is
  // in hand by then. Attach before polling so the event is never missed.
  const childClosed = new Promise(resolve => child.once("close", resolve));
  t.after(() => { try { child.kill("SIGKILL"); } catch {} });
  const declared = new Set<string>();
  let rest = "";
  child.stdout.on("data", chunk => {
    rest += chunk.toString("utf8");
    for (let at = rest.indexOf("\n"); at >= 0; at = rest.indexOf("\n")) {
      const line = rest.slice(0, at); rest = rest.slice(at + 1);
      try {
        const frame = JSON.parse(line) as { p?: string; s?: string };
        if (frame?.p === "d" && typeof frame.s === "string") declared.add(frame.s);
      } catch { /* the last line is the body result, not a frame */ }
    }
  });
  // A directory that exists was already declared: the declaration's bytes
  // entered the pipe before the mkdir ran, so at most one drain separates
  // seeing the directory from holding its name.
  const deadline = Date.now() + 15000;
  for (;;) {
    for (const name of readdirSync(temporary).filter(n => n.startsWith("oma-search-"))) {
      if (!declared.has(name)) {
        await delay(10);
        assert.ok(declared.has(name), `snapshot ${name} exists but no {p:"d"} for it reached the pipe first`);
      }
    }
    if (child.exitCode !== null || Date.now() > deadline) break;
    await delay(2);
  }
  await childClosed;
  assert.equal(declared.size > 0, true, "no snapshot name was ever declared");
});

test("G10-02 / P0: a hidden walker default is not the answer -- the same snapshot yields every match", async t => {
  const { workspace, run } = world(t);
  // 150 hits is past the engine's own default of 100; a caller that asked for
  // nothing gets them all, not a notice that the rest were dropped.
  for (let n = 0; n < 150; n++) writeFileSync(join(workspace, `m${String(n).padStart(3, "0")}.txt`), "needle\n");
  const found = await run("grep", { pattern: "needle" });
  const hits = found.split("\n").filter(line => /^m\d+\.txt:1: needle$/.test(line));
  assert.equal(hits.length, 150, `${hits.length} of 150 matches were returned`);
  assert.match(found, /m149\.txt:1: needle/);
  assert.doesNotMatch(found, /limit reached/);
});

test("G10-02 / P0: a hidden walker result bound is not the answer -- find returns every path", { timeout: 60000 }, async t => {
  const { workspace, tools } = world(t);
  // Past the engine's own 1000-result default.
  for (let n = 0; n < 1100; n++) writeFileSync(join(workspace, `f${String(n).padStart(4, "0")}.txt`), "");
  const result = await tools["find"]!.execute("call", { pattern: "f*.txt" }, undefined, undefined, { cwd: workspace });
  const found = result.content.map(part => part.text ?? "").join("");
  const rows = found.split("\n").filter(line => /^f\d+\.txt$/.test(line));
  assert.equal(rows.length, 1100, `${rows.length} of 1100 results were returned`);
  const details = (result as { details?: Record<string, unknown> }).details;
  assert.equal(details?.resultLimitReached, undefined, "complete results do not retain the hidden renderer limit");
  assert.equal(details?.truncation, undefined);
});

test("G10-02 / P0: a hidden byte/line bound is not the answer -- long lines and large output arrive whole", { timeout: 60000 }, async t => {
  const { workspace, run } = world(t);
  // 150 lines of 600 chars: past the 500-char line cut and the 50 KiB output cut.
  for (let n = 0; n < 150; n++)
    writeFileSync(join(workspace, `w${String(n).padStart(3, "0")}.txt`), `needle${"x".repeat(594)}\n`);
  const found = await run("grep", { pattern: "needle" });
  const hits = found.split("\n").filter(line => /^w\d+\.txt:1: needle/.test(line));
  assert.equal(hits.length, 150);
  assert.ok(hits.every(line => line.length === 600 + "w000.txt:1: ".length), "a line arrived cut");
});

test("G10-02: explicit fd limit zero remains unlimited during complete rendering", { timeout: 60000 }, async t => {
  const { workspace, tools } = world(t);
  for (let n = 0; n < 300; n++) writeFileSync(join(workspace, `z${String(n).padStart(3, "0")}${"x".repeat(190)}.txt`), "");
  const result = await tools["find"]!.execute("call", { pattern: "z*.txt", limit: 0 }, undefined, undefined, { cwd: workspace });
  const text = result.content.map(part => part.text ?? "").join("");
  assert.equal(text.split("\n").filter(line => /^z\d{3}x+\.txt$/.test(line)).length, 300);
  assert.equal((result as { details?: Record<string, unknown> }).details?.resultLimitReached, undefined);
});

test("G10-02: grep completion keeps Pi's fractional limit and discards buffered excess", { timeout: 60000 }, async t => {
  const { workspace, tools } = world(t);
  for (let n = 0; n < 6; n++) writeFileSync(join(workspace, `q${n}.txt`), `needle${"x".repeat(594)}\n`);
  const result = await tools["grep"]!.execute("call", { pattern: "needle", limit: 2.5 }, undefined, undefined, { cwd: workspace });
  const hits = result.content.map(part => part.text ?? "").join("").split("\n").filter(line => /^q\d\.txt:1: needle/.test(line));
  assert.equal(hits.length, 3); assert.ok(hits.every(line => line.length === "q0.txt:1: ".length + 600));
  assert.equal((result as { details?: Record<string, unknown> }).details?.linesTruncated, undefined);
  assert.equal((result as { details?: Record<string, unknown> }).details?.matchLimitReached, 2.5);
});

test("G10-02 / P0: an answer beyond one result is spooled into the workspace, and the named path is one the model's own tools can read", { timeout: 90000 }, async t => {
  const { workspace, tools, run } = world(t);
  // One 1.3 MiB matching line: the complete answer cannot ride inline.
  writeFileSync(join(workspace, "huge.txt"), `needle${"y".repeat(1_300_000)}\n`);
  const result = await tools["grep"]!.execute("call", { pattern: "needle" }, undefined, undefined, { cwd: workspace });
  const text = result.content.map((part: { text?: string }) => part.text ?? "").join("");
  assert.match(text, /oma: \[preview\] the complete \d+-byte result is at /);
  const file = / is at (\S+)/.exec(text)?.[1];
  const spoolDir = join(workspace, ".oma", "search-results");
  assert.ok(file !== undefined && file.startsWith(`${spoolDir}${sep}`),
    `the named path is not inside the workspace spool: ${file}`);
  assert.equal((result as { details?: { complete?: { path?: string; bytes?: number } } }).details?.complete?.path, file,
    "details.complete does not name the admitted path");
  // Reachability is the guard's verdict, not file existence: the same
  // admission the tool_call gate gives, then the same contained operations
  // the registered tools make.
  let hook: ((event: { toolName: string; input: unknown }) => { block: boolean; reason: string } | undefined) | undefined;
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never, workspace, false);
  for (const tool of ["read", "grep", "find", "ls"])
    assert.equal(hook!({ toolName: tool, input: { path: file!, pattern: "needle" } }), undefined,
      `${tool} is refused at the spool path the result named`);
  // The tools themselves reach it: ls and find list it, read opens it (the
  // single line is past the read renderer's own cap -- proof it read THIS
  // file), and grep over it completes the whole pipeline on the path.
  const name = basename(file!);
  assert.match(await run("ls", { path: spoolDir }), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(await run("find", { pattern: "oma-search-result-*.txt", path: spoolDir }), /oma-search-result-.*\.txt/);
  assert.match(await run("read", { path: file! }), /exceeds|Line 1/, "read did not reach the spooled file");
  const searched = await run("grep", { pattern: "needle", path: file!, limit: 1 });
  assert.match(searched, /needle/, "grep could not read the file the result named");
  // The model can read every byte of the saved answer.
  const saved = readFileSync(file!, "utf8");
  assert.ok(saved.startsWith("huge.txt:1: needle"), "the saved answer is not the complete rendering");
  assert.equal(Buffer.byteLength(saved) > 1_300_000, true);
});



test("G10-02 / P0: a stalled child is refused and its group and copy are swept", { timeout: 20000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'},undefined,300);process.exitCode=3;}
    catch(error){process.exitCode=/produced no output/.test(String(error&&error.message))?0:2;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: "ignore" });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  t.after(async () => { try { parent.kill("SIGKILL"); } catch {} await exited; });
  for (let n = 0; n < 1000 && !readdirSync(temporary).some(name => name.startsWith("oma-search-")); n++) await delay(5);
  const child = Number(readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim());
  assert.ok(Number.isSafeInteger(child) && child > 0, "no owned search child to stop");
  // A child that cannot emit is a stall, not a process that needs more time.
  process.kill(child, "SIGSTOP");
  assert.equal(await exited, 0, "the silent child was not refused inside its stall window");
  for (let n = 0; n < 500 && readdirSync(temporary).length > 0; n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), [], "the wedged child's copy survived it");
  const live = (): boolean => {
    try { return !/\) Z /.test(readFileSync(`/proc/${child}/stat`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  assert.equal(live(), false, "the wedged child's group was not put down");
});

test("G10-02 / P0: a slow child that keeps reporting is waited for -- real progress resets the observation", { timeout: 20000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  const agent = join(base, "agent"); const bin = join(agent, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  // The walker says nothing for 1.5 s -- longer than a silence window -- and
  // then answers. The child's heartbeats prove life inside the heartbeat-only
  // ceiling (10 windows); the answer arrives.
  writeFileSync(join(bin, "rg"), `#!${process.execPath}
const {setTimeout:delay}=require('node:timers/promises');
(async()=>{
if(process.argv.includes('--version')) process.exit(0);
const target=process.argv.at(-1);
await delay(1500);
console.log(JSON.stringify({type:'match',data:{path:{text:target+'/a.txt'},line_number:1,lines:{text:'needle\\n'}}}));
})();
`, { mode: 0o755 });
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{
      const result=await searchWorkspace('grep',process.argv[2],{pattern:'needle'},undefined,1000);
      const text=result&&result.content&&result.content[0]&&result.content[0].text||'';
      process.exitCode=/a\\.txt:1: needle/.test(text)?0:3;
    }catch(error){console.error(String(error&&error.message||error));process.exitCode=2;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary, PI_CODING_AGENT_DIR: agent }, stdio: ["ignore", "ignore", "inherit"] });
  const code = await new Promise<number | null>(resolve => parent.once("close", resolve));
  assert.equal(code, 0, "a heartbeating child inside its progress window was cut as a stall");
});

test("G10-02 / P0: a child that only ever heartbeats is reclaimed inside a bounded multiple of the stall window", { timeout: 30000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  const agent = join(base, "agent"); const bin = join(agent, "bin"); mkdirSync(bin, { recursive: true });
  const marker = join(base, "walker-pid");
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  // The walker never exits and never prints: after it starts, the child's
  // only output is the worker's heartbeat. Liveness is not progress -- the
  // heartbeat-only ceiling must still end the search.
  writeFileSync(join(bin, "rg"), `#!${process.execPath}
if(process.argv.includes('--version')) process.exit(0);
require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
`, { mode: 0o755 });
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'},undefined,600);process.exitCode=3;}
    catch(error){process.exitCode=/only heartbeats/.test(String(error&&error.message))?0:2;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary, PI_CODING_AGENT_DIR: agent }, stdio: ["ignore", "ignore", "ignore"] });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  t.after(async () => { try { parent.kill("SIGKILL"); } catch {} await exited; });
  let walker = 0; let child = 0;
  for (let n = 0; n < 1000 && (!existsSync(marker) || child === 0); n++) {
    await delay(5);
    try { child = Number(readFileSync(`/proc/${parent.pid}/task/${parent.pid}/children`, "utf8").trim()); } catch { /* spawning */ }
  }
  assert.ok(existsSync(marker), "the pinned walker never started -- there was nothing wedged to reclaim");
  walker = Number(readFileSync(marker, "utf8"));
  assert.equal(await exited, 0, "a heartbeat-only child was not reclaimed inside its ceiling");
  const live = (pid: number): boolean => {
    try { return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  };
  for (let n = 0; n < 500 && (readdirSync(temporary).length || live(walker) || live(child)); n++) await delay(5);
  assert.deepEqual(readdirSync(temporary), [], "the heartbeat-only child's copy survived it");
  assert.equal(live(walker), false, "the wedged walker survived its owner");
  assert.equal(live(child), false, "the heartbeat-only child's group was not put down");
});

test("G10-02 / P0: sparse real progress outlives the heartbeat-only ceiling -- a completion pass that drips is never cut", { timeout: 30000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  const agent = join(base, "agent"); const bin = join(agent, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(workspace, "a.txt"), "needle\n");
  // Pass one floods past the engine's 100-match default so the hidden bound
  // triggers the completion pass; the pinned walker's second run then emits
  // one match every 400 ms. 10 drips is 4 s -- past a 3 s heartbeat-only
  // ceiling -- and each line is a real {p:"r"} frame, so nothing cuts it.
  writeFileSync(join(bin, "rg"), `#!${process.execPath}
if(process.argv.includes('--version')) process.exit(0);
const fs=require('node:fs');
const target=process.argv.at(-1);
const line=i=>JSON.stringify({type:'match',data:{path:{text:target+'/m'+i+'.txt'},line_number:1,lines:{text:'needle\\n'}}});
const mark=process.env.PI_CODING_AGENT_DIR+'/rg-drip-mark';
if(!fs.existsSync(mark)){fs.writeFileSync(mark,'1');for(let i=0;i<150;i++)console.log(line(i));}
else{(async()=>{const{setTimeout:d}=require('node:timers/promises');for(let i=0;i<10;i++){await d(400);console.log(line(i));}})();}
`, { mode: 0o755 });
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{
      const result=await searchWorkspace('grep',process.argv[2],{pattern:'needle'},undefined,300);
      const text=result&&result.content&&result.content[0]&&result.content[0].text||'';
      process.exitCode=/m9\\.txt:1: needle/.test(text)?0:3;
    }catch(error){console.error(String(error&&error.message||error));process.exitCode=2;}`;
  const parent = spawn(process.execPath, ["--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary, PI_CODING_AGENT_DIR: agent }, stdio: ["ignore", "ignore", "inherit"] });
  const code = await new Promise<number | null>(resolve => parent.once("close", resolve));
  assert.equal(code, 0, "a child whose real progress was sparse was cut by the heartbeat-only ceiling");
});

test("G10-02 / P0: depth is never refused -- a tree past every historical level bound copies whole", { timeout: 30000 }, async t => {
  const { workspace } = world(t);
  const { withSearchSnapshot } = await import("@oma/tool-files");
  // 180 levels: past the former 128 refusal and past what recursion by path
  // could hold open, but nowhere near an operating-system limit.
  let deep = workspace;
  for (let n = 0; n < 180; n++) { deep = join(deep, "d"); mkdirSync(deep); }
  writeFileSync(join(deep, "leaf.txt"), "needle at depth\n");
  const seen = await withSearchSnapshot(workspace, ".", undefined, async snapshot => {
    const leaf = join(snapshot, ...Array.from({ length: 180 }, () => "d"), "leaf.txt");
    assert.equal(readFileSync(leaf, "utf8"), "needle at depth\n");
    return existsSync(leaf);
  });
  assert.equal(seen, true);
});

test("G10-02 / P0-4: a descriptor-starved copy refuses in words -- EMFILE/ENFILE is not an unexplained failure", { timeout: 30000 }, async t => {
  const { base, workspace } = world(t);
  const temporary = join(base, "temporary"); mkdirSync(temporary);
  // Deeper than any small descriptor budget: the copy holds one descriptor
  // per open level on both sides, so a tight limit fires mid-copy -- at a
  // source readdir or open, not only at the wrapped destination opens.
  let deep = workspace;
  for (let n = 0; n < 400; n++) { deep = join(deep, "d"); mkdirSync(deep); }
  writeFileSync(join(deep, "leaf.txt"), "needle\n");
  const script = `const {searchWorkspace}=await import(process.argv[1]);
    try{await searchWorkspace('grep',process.argv[2],{pattern:'needle'});process.exitCode=3;}
    catch(error){const m=String(error&&error.message||error);process.stdout.write(m);
      process.exitCode=/file descriptors/.test(m)?0:2;}`;
  // The fd ceiling is set with prlimit's direct argv -- the local lane
  // forbids a shell, and `ulimit` exists only inside one -- and the search
  // child the script spawns inherits it.
  const parent = spawn("prlimit", ["--nofile=96:96",
    process.execPath, "--input-type=module", "-e", script,
    new URL(import.meta.resolve("@oma/tool-runtime/contained-search"), import.meta.url).href, workspace],
    { env: { ...process.env, TMPDIR: temporary }, stdio: ["ignore", "pipe", "inherit"] });
  const exited = new Promise<number | null>(resolve => parent.once("close", code => resolve(code)));
  t.after(async () => { try { parent.kill("SIGKILL"); } catch {} await exited; });
  let out = "";
  parent.stdout!.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
  assert.equal(await exited, 0, `the starved child was not refused in words: ${out}`);
});

test("G10-02 / R6-01: a destination directory swapped mid-copy cannot carry a write through a link", { timeout: 30000 }, async t => {
  const { base, workspace, outside } = world(t);
  const { withSearchSnapshot } = await import("@oma/tool-files");
  mkdirSync(join(workspace, "d"));
  // Enough entries that the copy is still inside `d` when the swap lands.
  for (let n = 0; n < 2000; n++) writeFileSync(join(workspace, "d", `${n}.txt`), "x".repeat(2048));
  const probe = join(outside, "probe-target"); mkdirSync(probe);
  // The private tree is mode-700, not a boundary: a same-uid racer can rename
  // its directories and plant names in it. The attack F5 closed is exactly
  // that -- the destination's own name is swapped for a link after the real
  // directory exists and is open.
  let baseName = "";
  const done = withSearchSnapshot(workspace, ".", undefined, async () => "used",
    undefined, name => { baseName = name; });
  const destinationDir = (): string => join(tmpdir(), baseName, "workspace", "d");
  for (let n = 0; n < 15000; n++) {
    await delay(1);
    if (baseName !== "" && existsSync(destinationDir())) {
      try { if (readdirSync(destinationDir()).length >= 5) break; } catch { /* racing */ }
    }
  }
  assert.ok(existsSync(destinationDir()), "the destination dir was never observed mid-copy");
  const moved = join(base, "d-held");
  renameSync(destinationDir(), moved);
  symlinkSync(probe, destinationDir());
  // Writes must keep reaching the directory the copy actually opened: the
  // entry count grows past the swap point inside the renamed real dir, and
  // nothing lands through the planted link.
  const atSwap = readdirSync(moved).length;
  assert.ok(atSwap < 2000, `the copy had already finished before the swap (${atSwap})`);
  await done;
  assert.equal(readdirSync(probe).length, 0, "a write crossed the swapped link");
  assert.equal(readdirSync(moved).length, 2000, "the held descriptor lost its real directory");
});









test("FI-4: a workspace holding a real project's Git history and installed dependencies still takes a small write", async t => {
  // Existing Git/build/dependency trees do not affect contained writer ownership.
  const { workspace, run } = world(t);
  const bulk = "x".repeat(256 * 1024);
  for (const directory of [".git/objects/pack", "node_modules/left-pad", "packages/app/node_modules/react", ".venv/lib",
    "target/debug", "dist", "build"]) {
    mkdirSync(join(workspace, directory), { recursive: true });
    writeFileSync(join(workspace, directory, "artifact"), bulk);
  }
  await run("write", { path: "apps/oma/src/index.ts", content: "export const answer = 42;\n" });
  await run("edit", { path: "apps/oma/src/index.ts", edits: [{ oldText: "42", newText: "43" }] });
  assert.equal(readFileSync(join(workspace, "apps/oma/src/index.ts"), "utf8"), "export const answer = 43;\n");
  // What the agent authors still counts, wherever it sits outside those trees.
  writeFileSync(join(workspace, "apps/oma/src", "generated.json"), bulk);
  await run("write", { path: "apps/oma/src/more.ts", content: "x" });
});
