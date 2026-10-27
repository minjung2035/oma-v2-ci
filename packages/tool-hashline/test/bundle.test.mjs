/** Bundled pi-hashline-edit-pro (file_edit): the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * registers only the anchored `read` and the three file_edit mutations;
 * reads are admitted through the same boundary the workspace guard applies
 * and writes reach the filesystem only through OMA's shared contained
 * writer — serialization, and the read snapshot's
 * inode-identity check included. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, linkSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainedWriter, logicalReadPathView } from "@oma/tool-runtime/contained-tools";
import { FILE_CHANGED_REFUSAL, WorkspaceRefusal, writeWithinUnchanged } from "@oma/tool-files";
import { registerHashlineTools, HASHLINE_EDIT_TOOL_NAMES, HASHLINE_READ_TOOL_NAME } from "@oma/tool-hashline";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "@oma/tool-runtime/vendor-bundle";
import { registerToolSurface } from "@oma/tool-runtime/tool-surface";
import { encodeToolSurfacePlan, planToolSurface } from "@oma/domain/tool-surface";
function tmp(t, prefix = "oma-hashline-") {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
/** A Pi ExtensionAPI stub: tools and event handlers are recorded, nothing
 * else is modeled. */
function fakePi() {
    const tools = new Map();
    const handlers = new Map();
    const pi = {
        tools,
        handlers,
        registerTool(tool) { tools.set(tool.name, tool); },
        on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    };
    return pi;
}
const ctxOf = (workspace, session) => ({
    sessionManager: session === undefined ? {} : {
        getSessionDir: () => session.dir,
        getSessionFile: () => session.file,
        getSessionId: () => "test-session",
    },
    ui: { setStatus() { } },
    cwd: workspace,
});
const BUNDLE_SOURCE = fileURLToPath(new URL("../src/vendor/pi-hashline-edit-pro/", import.meta.url));
const textOf = (result) => result.content.map(part => part.text ?? "").join("");
/** The "X│"-shaped anchors a served read line carries. */
const anchorsOf = (text) => text.split("\n").filter(line => line.includes("│")).map(line => line.slice(0, line.indexOf("│")).trim());
async function hashlineWorld(t, options = {}) {
    const workspace = tmp(t, "oma-hashline-ws-");
    const pi = fakePi();
    const write = createContainedWriter(workspace);
    await registerHashlineTools(pi, {
        workspace,
        readableRoots: options.readableRoots ?? [],
        sandboxed: options.sandboxed ?? false,
        readOnly: options.readOnly ?? false,
        write,
        readPath: options.readPath,
        stateDir: options.session === undefined ? join(tmp(t, "oma-hashline-state-"), "state") : undefined,
    });
    const ctx = ctxOf(workspace, options.session);
    return {
        workspace, pi, ctx,
        run: (name, params, signal) => pi.tools.get(name).execute("call", params, signal, undefined, ctx),
        fire: async (event, payload = {}) => {
            const results = [];
            for (const handler of pi.handlers.get(event) ?? [])
                results.push(await handler(payload, ctx));
            return results;
        },
    };
}
/** Read a file through the anchored read and return its served anchors. */
async function serveAnchors(world, path) {
    const read = await world.run(HASHLINE_READ_TOOL_NAME, { path });
    return anchorsOf(textOf(read));
}
test("native logical inbox uses the existing anchored read and preserves offset/limit without a root mount", async t => {
    const view = tmp(t, "oma-inbox-view-한글-");
    writeFileSync(join(view, "inbox.md"), "first delivery\nsecond delivery\nthird delivery\n");
    const w = await hashlineWorld(t, { sandboxed: true, readPath: logicalReadPathView(true, view) });
    const params = { path: "/inbox.md", offset: 2, limit: 1 };
    // Pi calls this public normalizer before validation/dispatch. The
    // original anchored execute handler remains the engine's to invoke.
    const prepared = w.pi.tools.get("read").prepareArguments(params);
    const answer = textOf(await w.run("read", prepared));
    assert.match(answer, /second delivery/); assert.doesNotMatch(answer, /first delivery|third delivery/);
    assert.equal(params.path, "/inbox.md");
    writeFileSync(join(w.workspace, "inbox.md"), "workspace file\n");
    assert.match(textOf(await w.run("read", { path: "inbox.md" })), /workspace file/);
    assert.equal(logicalReadPathView(false, view)("/inbox.md"), "/inbox.md");
    assert.equal(logicalReadPathView(true, view)("/inbox.md/../other"), "/inbox.md/../other");
    for (const root of ["/", "relative", `${view}/../other`, `${view}\0bad`])
        assert.throws(() => logicalReadPathView(true, root), /normalized non-root/);
});
// ---------------------------------------------------------------------------
// Bundle integrity
test("BL3: the vendored pi-hashline-edit-pro bundle verifies: source tree and the dist copy the adapter loads", () => {
    const source = verifyVendorBundle(BUNDLE_SOURCE);
    assert.equal(source.package, "pi-hashline-edit-pro");
    assert.equal(source.version, "5.1.0");
    assert.equal(source.commit, "49f61eb203acb5bedec476c182f2b3f5e5b3fc04");
    assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
    const deployed = verifyVendorBundle(vendoredBundleDir("pi-hashline-edit-pro", new URL("../dist/", import.meta.url)));
    assert.deepEqual(deployed, source, "the dist copy is the same bundle");
});
test("BL3: bundle verification fails closed on a changed, missing, extra, malformed or linked member", t => {
    const copy = (label) => {
        const dir = join(tmp(t), label);
        cpSync(BUNDLE_SOURCE, dir, { recursive: true });
        return dir;
    };
    const fails = (dir, reason) => assert.throws(() => verifyVendorBundle(dir), (error) => error instanceof VendorIntegrityError && reason.test(error.message));
    // A changed byte in the compiled runtime.
    const changed = copy("changed");
    writeFileSync(join(changed, "runtime", "read.js"), `${readFileSync(join(changed, "runtime", "read.js"), "utf8")} `);
    fails(changed, /file changed|digest does not cover/);
    // A changed byte in the vendored dependency closure.
    const dep = copy("dep");
    writeFileSync(join(dep, "node_modules", "diff", "package.json"), `${readFileSync(join(dep, "node_modules", "diff", "package.json"), "utf8")} `);
    fails(dep, /file changed|digest does not cover/);
    // A missing member.
    const missing = copy("missing");
    rmSync(join(missing, "runtime", "commit.js"));
    fails(missing, /file is missing/);
    // An unlisted extra.
    const extra = copy("extra");
    writeFileSync(join(extra, "runtime", "smuggled.js"), "x");
    fails(extra, /unlisted file/);
    // A linked entry is a special file, not a file to hash.
    const linked = copy("linked");
    symlinkSync(join(linked, "upstream", "LICENSE"), join(linked, "LICENSE-link"));
    fails(linked, /linked or special|unlisted file/);
    // A manifest that does not parse.
    const broken = copy("broken");
    writeFileSync(join(broken, "manifest.json"), "not json");
    fails(broken, /manifest is missing or unreadable/);
    // A manifest whose kind is not the bundle's.
    const rekindled = copy("rekindled");
    const manifest = JSON.parse(readFileSync(join(rekindled, "manifest.json"), "utf8"));
    manifest.kind = "something-else";
    writeFileSync(join(rekindled, "manifest.json"), JSON.stringify(manifest));
    fails(rekindled, /kind/);
});
test("BL3: the vendored dependency closure and upstream test tree are inside the bundle", () => {
    const manifest = JSON.parse(readFileSync(join(BUNDLE_SOURCE, "manifest.json"), "utf8"));
    const paths = new Set(manifest.files.map(entry => entry.path));
    // The pinned runtime dependency closure — every package's manifest is a
    // listed, digest-bound member, resolvable by Node's own node_modules walk
    // from the vendored runtime.
    for (const name of ["diff", "file-type", "xxhash-wasm", "strtok3", "token-types", "uint8array-extras",
        "@tokenizer/inflate", "@tokenizer/token", "@borewit/text-codec", "ieee754", "debug", "ms"])
        assert.ok(paths.has(`node_modules/${name}/package.json`), `vendored dependency ${name} is listed`);
    assert.ok(paths.has("runtime/read.js") && paths.has("runtime/hashline/anchor-table.json"), "the emitted runtime is listed");
    assert.ok(paths.has("upstream/package.json") && paths.has("upstream/src/read.ts"), "the byte-exact upstream tree is listed");
    assert.ok([...paths].some(path => path.startsWith("upstream-tests/")), "the vendored commit's test tree is preserved");
    assert.ok(paths.has("LICENSE") && paths.has("NOTICE"), "license and notice are bundle members");
});
// ---------------------------------------------------------------------------
// Registration, surface and role boundaries
test("BL3: registerHashlineTools registers exactly the anchored read and the file_edit tools, plus the lifecycle hooks", async (t) => {
    const { pi } = await hashlineWorld(t);
    assert.deepEqual([...pi.tools.keys()].sort(), [HASHLINE_READ_TOOL_NAME, ...HASHLINE_EDIT_TOOL_NAMES].sort());
    for (const event of ["session_start", "session_shutdown", "message_end", "turn_end", "tool_result", "tool_call"])
        assert.ok(pi.handlers.has(event), `${event} handler is registered`);
    // A second registration (extension reload) is idempotent.
    const again = fakePi();
    const workspace = tmp(t, "oma-hashline-ws-");
    await registerHashlineTools(again, {
        workspace, readableRoots: [], sandboxed: false, readOnly: false, write: async () => { },
    });
    assert.deepEqual([...again.tools.keys()].sort(), [HASHLINE_READ_TOOL_NAME, ...HASHLINE_EDIT_TOOL_NAMES].sort());
});
test("BL3: a read-only role gets the anchored read but no file_edit mutation tools", async (t) => {
    const { pi } = await hashlineWorld(t, { readOnly: true });
    assert.deepEqual([...pi.tools.keys()], [HASHLINE_READ_TOOL_NAME]);
    for (const name of HASHLINE_EDIT_TOOL_NAMES)
        assert.ok(!pi.tools.has(name), `${name} is not registered for a read-only role`);
});
// Integrity refusal runs against an actual copied owner in test/vendor-owner-binding.test.mjs.

test("BL3: a surface plan naming a file_edit member the registry lacks refuses startup", () => {
    const plan = planToolSurface({
        defaultMode: "DIRECT", direct: [], disabled: [],
        groups: [{ name: "file_edit", description: "x", members: [{ tool: "replace" }, { tool: "hashline_missing" }] }],
        roots: ["file_edit"],
    });
    const handlers = new Map();
    const pi = {
        on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
        registerTool() { },
        getAllTools() { return [{ name: "replace", sourceInfo: { source: "extension", path: "/x" } }]; },
        getActiveTools() { return []; },
        setActiveTools() { },
    };
    let fatal = null;
    const saved = process.env.OMA_TOOL_SURFACE;
    process.env.OMA_TOOL_SURFACE = encodeToolSurfacePlan(plan);
    try {
        registerToolSurface(pi, [], { fatal: message => { fatal = message; throw new Error(message); } });
        assert.throws(() => handlers.get("session_start")?.[0]?.(), /hashline_missing/);
        assert.match(fatal ?? "", /unknown tool "hashline_missing"/);
    }
    finally {
        if (saved === undefined)
            delete process.env.OMA_TOOL_SURFACE;
        else
            process.env.OMA_TOOL_SURFACE = saved;
    }
});
// ---------------------------------------------------------------------------
// Live behavior: anchored read, contained commits, refusals
test("BL3: read serves hashline anchors and replace commits through the contained writer", async (t) => {
    const world = await hashlineWorld(t);
    writeFileSync(join(world.workspace, "a.ts"), "const one = 1;\nconst two = 2;\nconst three = 3;\n");
    const anchors = await serveAnchors(world, "a.ts");
    assert.equal(anchors.length, 3, "one anchor per served line");
    const result = await world.run("replace", { remove_from: anchors[0], remove_to: anchors[0], replacement_lines: "const one = 10;" });
    assert.match(textOf(result), /replaced/i);
    assert.equal(readFileSync(join(world.workspace, "a.ts"), "utf8"), "const one = 10;\nconst two = 2;\nconst three = 3;\n");
});
test("BL3: a stale anchor refuses before a byte is written", async (t) => {
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "one\ntwo\nthree\n");
    const anchors = await serveAnchors(world, "a.ts");
    await world.run("replace", { remove_from: anchors[0], remove_to: anchors[0], replacement_lines: "uno" });
    // The first commit invalidated the served set; replaying its anchor is
    // upstream's [E_STALE_ANCHOR], not a silent re-edit.
    await assert.rejects(world.run("replace", { remove_from: anchors[0], remove_to: anchors[0], replacement_lines: "hacked" }), /E_STALE_ANCHOR|not owned|stale/i);
    assert.equal(readFileSync(file, "utf8"), "uno\ntwo\nthree\n", "the refused edit wrote nothing");
});
test("BL3: the commit channel's identity refusal surfaces as upstream's [E_PATH_CHANGED]", async (t) => {
    // The contained writer refusing on inode identity (the file was swapped
    // between the pipeline's read and its commit) must reach the vendored
    // machinery with upstream's own wording, not as a generic failure.
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "one\ntwo\nthree\n");
    const anchors = await serveAnchors(world, "a.ts");
    // Swap the write seam for one that reports OMA's identity refusal — the
    // exact WorkspaceRefusal writeWithinUnchanged raises.
    const refusing = fakePi();
    await registerHashlineTools(refusing, {
        workspace: world.workspace, readableRoots: [], sandboxed: false, readOnly: false,
        write: async () => { throw new WorkspaceRefusal(FILE_CHANGED_REFUSAL); },
    });
    await assert.rejects(refusing.tools.get("replace").execute("call", { remove_from: anchors[1], remove_to: anchors[1], replacement_lines: "CHANGED" }, undefined, undefined, world.ctx), (error) => {
        // Require upstream's marker itself: FILE_CHANGED_REFUSAL contains
        // "different file", so a loose /changed|different file/ match would
        // also pass on the raw, untranslated refusal.
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /E_PATH_CHANGED/, "OMA's identity refusal must be translated to upstream's wording");
        assert.ok(!message.includes(FILE_CHANGED_REFUSAL), "the raw refusal must not surface untranslated");
        return true;
    });
    assert.equal(readFileSync(file, "utf8"), "one\ntwo\nthree\n", "the refused commit wrote nothing");
});
test("BL3: the commit seam is fail-closed — no silent fallback, and writeAtomic serves only the state dir", async (t) => {
    // The seam is module state the adapter shares; uninstalling exercises
    // the same code path a missing install would hit, and the state-dir
    // confinement is what a never-installed channel leaves for direct
    // writeAtomic callers (replace-undo.js's undo write, if ever registered).
    const fsWrite = await import("../dist/vendor/pi-hashline-edit-pro/runtime/fs-write.js");
    const dir = tmp(t);
    const target = join(dir, "a.ts");
    writeFileSync(target, "original\n");
    const stateDir = join(dir, "state");
    const savedEnv = process.env.PI_HASHLINE_DIR;
    process.env.PI_HASHLINE_DIR = stateDir;
    try {
        fsWrite.omaInstallCommitChannel(undefined);
        await assert.rejects(fsWrite.omaReadFileText(target), /E_OMA_NO_COMMIT_CHANNEL/);
        await assert.rejects(fsWrite.omaWriteCommit(target, "uncontained\n"), /E_OMA_NO_COMMIT_CHANNEL/);
        assert.equal(readFileSync(target, "utf8"), "original\n", "the refused seam wrote nothing");
        // writeAtomic stays alive for the bundle's own state directory —
        // config.js's configPath() domain — and refuses every other target.
        await fsWrite.writeAtomic(join(stateDir, "config.json"), "{}\n");
        assert.equal(readFileSync(join(stateDir, "config.json"), "utf8"), "{}\n", "state-dir writeAtomic still lands");
        await assert.rejects(fsWrite.writeAtomic(target, "undo\n", { dev: 1, ino: 2 }, 0o644), /E_OMA_STATE_DOMAIN/);
        assert.equal(readFileSync(target, "utf8"), "original\n", "the refused direct write wrote nothing");
        // With a channel installed the seam routes through it, identity included.
        const calls = [];
        fsWrite.omaInstallCommitChannel({
            read: async (path) => { calls.push(`read:${path}`); return "body"; },
            write: async (path, _content, expectedIdentity) => { calls.push(`write:${path}:${expectedIdentity?.ino}`); },
        });
        assert.equal(await fsWrite.omaReadFileText("/p"), "body");
        await fsWrite.omaWriteCommit("/p", "c", { dev: 1, ino: 2 });
        assert.deepEqual(calls, ["read:/p", "write:/p:2"]);
    }
    finally {
        // Leave the seam uninstalled: every registerHashlineTools call
        // reinstalls it, and any caller that skips installation must hit the
        // fail-closed path, not a fallback.
        fsWrite.omaInstallCommitChannel(undefined);
        if (savedEnv === undefined)
            delete process.env.PI_HASHLINE_DIR;
        else
            process.env.PI_HASHLINE_DIR = savedEnv;
    }
});
test("BL3: writeWithinUnchanged opens without O_CREAT and refuses a different inode", async (t) => {
    const workspace = tmp(t, "oma-hashline-ws-");
    const file = join(workspace, "a.ts");
    writeFileSync(file, "original\n");
    const stat = statSync(file);
    // Same inode: the write lands.
    writeWithinUnchanged(workspace, "a.ts", "updated\n", { dev: stat.dev, ino: stat.ino });
    assert.equal(readFileSync(file, "utf8"), "updated\n");
    // A rename-swapped replacement carries a different inode: refused before
    // a byte, reported with the refusal text the adapter translates.
    const swapped = join(workspace, "a.ts.next");
    writeFileSync(swapped, "new inode\n");
    renameSync(swapped, file);
    assert.throws(() => writeWithinUnchanged(workspace, "a.ts", "x\n", { dev: stat.dev, ino: stat.ino }), (error) => error instanceof WorkspaceRefusal && error.message === FILE_CHANGED_REFUSAL);
    assert.equal(readFileSync(file, "utf8"), "new inode\n", "the refused write changed nothing");
    // A name that is gone is a changed file, not a new one: no O_CREAT.
    rmSync(file);
    assert.throws(() => writeWithinUnchanged(workspace, "a.ts", "x\n", { dev: stat.dev, ino: stat.ino }), /ENOENT|no such file/i);
    assert.ok(!existsSync(file), "the write did not recreate the file");
});
test("BL3: insert and replace_within commit through the same contained writer", async (t) => {
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "alpha\nbeta\nomega\n");
    const anchors = await serveAnchors(world, "a.ts");
    const inserted = await world.run("insert", { anchor: anchors[1], direction: "after", lines: "gamma" });
    assert.equal(readFileSync(file, "utf8"), "alpha\nbeta\ngamma\nomega\n", `insert: ${textOf(inserted)}`);
    // Fresh anchors after the insert, then a scoped literal replace within
    // the gamma line's range.
    const fresh = await serveAnchors(world, "a.ts");
    assert.equal(fresh.length, 4);
    await world.run("replace_within", {
        replace_from: fresh[1], replace_to: fresh[2], replace_old: "gamma", replace_new: "G",
    });
    assert.equal(readFileSync(file, "utf8"), "alpha\nbeta\nG\nomega\n");
});
test("BL3: hashline commits grow beyond a legacy workspace quota", async (t) => {
    const world = await hashlineWorld(t, {});
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "one\ntwo\nthree\n");
    const anchors = await serveAnchors(world, "a.ts");
    await world.run("replace", { remove_from: anchors[2], remove_to: anchors[2], replacement_lines: "a much longer line that exceeds the old quota" });
    assert.match(readFileSync(file, "utf8"), /a much longer line/);
});
test("BL3: a symlink is never followed — read and edit refuse through the contained opener", async (t) => {
    const world = await hashlineWorld(t);
    const outside = join(tmp(t), "outside.ts");
    writeFileSync(outside, "secret\n");
    writeFileSync(join(world.workspace, "real.ts"), "visible\n");
    symlinkSync(outside, join(world.workspace, "escape.ts"));
    symlinkSync(join(world.workspace, "real.ts"), join(world.workspace, "inner.ts"));
    await assert.rejects(world.run(HASHLINE_READ_TOOL_NAME, { path: "escape.ts" }), /link|outside|refus/i);
    await assert.rejects(world.run(HASHLINE_READ_TOOL_NAME, { path: "inner.ts" }), /link|outside|refus/i, "even an in-workspace link is not followed");
    assert.equal(readFileSync(outside, "utf8"), "secret\n", "nothing outside was touched");
});
test("BL3: a path outside the workspace and readable roots is refused", async (t) => {
    const world = await hashlineWorld(t);
    const outside = join(tmp(t), "outside.ts");
    writeFileSync(outside, "secret\n");
    await assert.rejects(world.run(HASHLINE_READ_TOOL_NAME, { path: outside }), /outside the agent workspace/);
    await assert.rejects(world.run(HASHLINE_READ_TOOL_NAME, { path: "../escape" }), /outside|E_NOT_FOUND|link/i);
});
test("BL3: a readable root admits reads but writes stay rooted at the workspace", async (t) => {
    const store = tmp(t, "oma-hashline-store-");
    writeFileSync(join(store, "pkg.txt"), "package bytes\n");
    const world = await hashlineWorld(t, { readableRoots: [store] });
    const read = await world.run(HASHLINE_READ_TOOL_NAME, { path: join(store, "pkg.txt") });
    assert.match(textOf(read), /package bytes/);
    // The commit channel's write is rooted at the workspace: an anchored
    // edit of a readable-root file must not write there.
    const anchors = anchorsOf(textOf(read));
    await assert.rejects(world.run("replace", { remove_from: anchors[0], remove_to: anchors[0], replacement_lines: "hacked" }), /outside the agent workspace|quota|refus/i);
    assert.equal(readFileSync(join(store, "pkg.txt"), "utf8"), "package bytes\n");
});
test("BL3: a hard link is never touched — a second name would carry any effect elsewhere", async (t) => {
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "one\ntwo\n");
    linkSync(file, join(world.workspace, "b.ts"));
    // The contained opener's ownedFile rule applies to reads too: a file
    // with another name is refused before a byte of it is served.
    await assert.rejects(world.run(HASHLINE_READ_TOOL_NAME, { path: "a.ts" }), /other names|link|refus/i);
    assert.equal(readFileSync(file, "utf8"), "one\ntwo\n");
});
test("BL3: BOM and CRLF survive an anchored edit", async (t) => {
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "bom.ts");
    writeFileSync(file, "\uFEFFone\r\ntwo\r\nthree\r\n");
    const anchors = await serveAnchors(world, "bom.ts");
    assert.equal(anchors.length, 3);
    await world.run("replace", { remove_from: anchors[1], remove_to: anchors[1], replacement_lines: "TWO" });
    const after = readFileSync(file, "utf8");
    assert.ok(after.startsWith("\uFEFF"), "the BOM is preserved");
    assert.equal(after, "\uFEFFone\r\nTWO\r\nthree\r\n", "CRLF endings are preserved");
});
test("BL3: a write whose content echoes a served anchor is blocked by the write hook", async (t) => {
    const world = await hashlineWorld(t);
    writeFileSync(join(world.workspace, "a.ts"), "one\ntwo\n");
    const anchors = await serveAnchors(world, "a.ts");
    const hook = world.pi.handlers.get("tool_call") ?? [];
    assert.ok(hook.length > 0, "the write hook is registered");
    // The echo the hook scans for is a line that is the served anchor itself.
    const call = { toolName: "write", input: { path: "a.ts", content: `${anchors[0]}│one\n` } };
    const results = [];
    for (const handler of hook)
        results.push(await handler(call, world.ctx));
    const blocked = results.find(result => result?.block === true);
    assert.ok(blocked, "the anchor-echo write is blocked");
    assert.match(blocked.reason ?? "", /E_WRITE_HASH_ECHO|anchor/);
    // A clean write is not blocked.
    const clean = [];
    for (const handler of hook)
        clean.push(await handler({ toolName: "write", input: { path: "a.ts", content: "plain\n" } }, world.ctx));
    assert.ok(!clean.some(result => result?.block === true));
});
test("BL3: a successful write tool_result frees old anchors and re-serves the file", async (t) => {
    const world = await hashlineWorld(t);
    const file = join(world.workspace, "a.ts");
    writeFileSync(file, "one\ntwo\nthree\n");
    const anchors = await serveAnchors(world, "a.ts");
    // Simulate the builtin write tool landing a change to the served line —
    // its pre-write anchor must no longer resolve.
    writeFileSync(file, "one\ntwo\nTREE\n");
    const results = await world.fire("tool_result", {
        toolName: "write", isError: false, input: { path: "a.ts" }, content: [{ type: "text", text: "ok" }],
    });
    const merged = results.map(result => result !== null && typeof result === "object" ? textOf(result) : "").join("\n");
    assert.match(merged, /Auto-read/, "the write tool_result carries fresh anchors");
    // The pre-write anchor set no longer owns its hashes.
    await assert.rejects(world.run("replace", { remove_from: anchors[2], remove_to: anchors[2], replacement_lines: "hacked" }), /E_STALE_ANCHOR|not owned|stale|E_PATH_CHANGED|E_CHANGED/i);
});
// ---------------------------------------------------------------------------
// Session state: OMA-owned, restart-shaped, corruption-tolerant
test("BL3: upstream state lands under the adapter's OMA-owned directory, never $HOME", async (t) => {
    const stateRoot = tmp(t, "oma-hashline-state-");
    const sessionDir = join(stateRoot, "session");
    mkdirSync(sessionDir, { recursive: true });
    const world = await hashlineWorld(t, { session: { dir: sessionDir, file: join(sessionDir, "session.jsonl") } });
    const saved = process.env.PI_HASHLINE_DIR;
    try {
        await world.fire("session_start");
        const landed = process.env.PI_HASHLINE_DIR;
        assert.ok(landed !== undefined && landed.startsWith(sessionDir), `state dir lands under the engine's session dir, got ${landed}`);
        assert.ok(!landed.startsWith(realpathSync(process.env.HOME ?? "/nonexistent")), "never the user's home");
        assert.ok(existsSync(landed), "the state directory is created");
    }
    finally {
        if (saved === undefined)
            delete process.env.PI_HASHLINE_DIR;
        else
            process.env.PI_HASHLINE_DIR = saved;
    }
});
test("BL3: served anchors persist through the session sidecar — a restarted session still owns them", async (t) => {
    const stateDir = join(tmp(t, "oma-hashline-state-"), "state");
    const sessionFile = join(stateDir, "session.jsonl");
    const world = await hashlineWorld(t, { session: { dir: stateDir, file: sessionFile } });
    writeFileSync(join(world.workspace, "a.ts"), "one\ntwo\nthree\n");
    const saved = process.env.PI_HASHLINE_DIR;
    try {
        await world.fire("session_start");
        const anchors = await serveAnchors(world, "a.ts");
        assert.equal(anchors.length, 3);
        // The claim is durable state: the registry sidecar under the OMA-owned
        // state dir records the allocation for this session's key.
        const claimsDir = join(process.env.PI_HASHLINE_DIR, "sessions");
        const sidecars = readdirSync(claimsDir).filter(name => name.endsWith(".registry.jsonl"));
        assert.equal(sidecars.length, 1, "one session sidecar holds the claims");
        const rows = readFileSync(join(claimsDir, sidecars[0]), "utf8")
            .split("\n").filter(line => line.length > 0).map(line => JSON.parse(line));
        assert.ok(rows.some(row => row.kind === "allocate"), "the allocation is persisted, not only in memory");
        // A second engine registration over the same session file resumes the
        // claims: the first session's anchors still resolve to their file.
        const second = fakePi();
        await registerHashlineTools(second, {
            workspace: world.workspace, readableRoots: [], sandboxed: false, readOnly: false,
            write: createContainedWriter(world.workspace),
        });
        const secondCtx = ctxOf(world.workspace, { dir: stateDir, file: sessionFile });
        for (const handler of second.handlers.get("session_start") ?? [])
            await handler({}, secondCtx);
        const result = await second.tools.get("replace").execute("call", { remove_from: anchors[0], remove_to: anchors[0], replacement_lines: "uno" }, undefined, undefined, secondCtx);
        assert.match(textOf(result), /replaced/i);
        assert.equal(readFileSync(join(world.workspace, "a.ts"), "utf8"), "uno\ntwo\nthree\n");
    }
    finally {
        if (saved === undefined)
            delete process.env.PI_HASHLINE_DIR;
        else
            process.env.PI_HASHLINE_DIR = saved;
    }
});
test("BL3: a corrupt owned-state file degrades to a logged failure, not a crash — tools still work", async (t) => {
    const stateDir = join(tmp(t, "oma-hashline-state-"), "state");
    mkdirSync(join(stateDir, "sessions"), { recursive: true });
    writeFileSync(join(stateDir, "hash-store.sqlite"), "not a sqlite database");
    const world = await hashlineWorld(t, { session: { dir: stateDir, file: join(stateDir, "s.jsonl") } });
    const saved = process.env.PI_HASHLINE_DIR;
    try {
        await world.fire("session_start"); // must not reject: store load failure is logged, session continues
        writeFileSync(join(world.workspace, "a.ts"), "one\ntwo\n");
        const anchors = await serveAnchors(world, "a.ts");
        assert.equal(anchors.length, 2, "anchored read still works on a corrupt store");
    }
    finally {
        if (saved === undefined)
            delete process.env.PI_HASHLINE_DIR;
        else
            process.env.PI_HASHLINE_DIR = saved;
    }
});
// ---------------------------------------------------------------------------
// F3/F5: evaluation order and manifest self-description
test("BL3/F3: the compiled adapter holds no static vendored import — every vendored load sits behind verification", () => {
    const adapter = readFileSync(fileURLToPath(new URL("../dist/index.js", import.meta.url)), "utf8");
    assert.doesNotMatch(adapter, /^import\s[^;]*["'][^"']*vendor\//m, "a static vendored import would evaluate before verification");
    assert.doesNotMatch(adapter, /^export\s[^;]*from\s*["'][^"']*vendor\//m, "a vendored re-export would evaluate before verification");
    assert.match(adapter, /import\(["'][^"']*vendor\/pi-hashline-edit-pro\/runtime\//, "the dynamic imports are still present — the runtime loads, just late");
});
