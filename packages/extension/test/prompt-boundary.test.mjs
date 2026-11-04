/** C15/C19/C21: the Society prompt boundary as a `before_agent_start` mutation.
 *
 * Pi's resource discovery is restored for the Principal, so the boundary is
 * what OMA owns: which discovered context files may reach the prompt, whether
 * an append channel may speak, and -- because the role's custom system prompt
 * suppresses Pi's generated tools/rules/docs sections -- how the active tools'
 * snippets and guidelines still reach the model under OMA's own section. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerPromptBoundary } from "@oma/extension/prompt-boundary";
import { collaborationAuthority, collaborationRolePrompt } from "@oma/domain/collaboration-prompts";
/** The mutable prompt options Pi hands to the handler. */
function options(overrides = {}) {
    return {
        customPrompt: "role prompt",
        selectedTools: ["read", "fetch"],
        toolSnippets: { read: "Read a file", fetch: "Fetch a URL" },
        toolGuidelines: { read: ["Prefer read over cat"], fetch: ["Prefer read over cat", "Never post secrets"] },
        promptGuidelines: [],
        appendSystemPrompt: "an append that must not speak",
        sections: {},
        contextFiles: [],
        skills: [],
        cwd: "/w",
        ...overrides,
    };
}
function boundary(workspace, narrow, active = ["read", "fetch"]) {
    let handler;
    const pi = {
        on(event, fn) { if (event === "before_agent_start")
            handler = fn; },
        getActiveTools: () => [...active],
    };
    registerPromptBoundary(pi, workspace, narrow);
    return opts => handler({ type: "before_agent_start", systemPromptOptions: opts });
}
test("001. The Principal's context files are narrowed to real paths inside its workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        const workspace = join(dir, "workspace");
        mkdirSync(workspace);
        const insideFile = join(workspace, "AGENTS.md");
        writeFileSync(insideFile, "in\n");
        const nested = join(workspace, "sub");
        mkdirSync(nested);
        const nestedFile = join(nested, "CLAUDE.md");
        writeFileSync(nestedFile, "nested\n");
        const outsideFile = join(dir, "AGENTS.md");
        writeFileSync(outsideFile, "out\n");
        const linkIn = join(workspace, "linked.md");
        symlinkSync(outsideFile, linkIn);
        const gone = join(workspace, "gone.md");
        const run = boundary(workspace, true);
        const opts = options({
            contextFiles: [
                { path: insideFile, content: "in\n" },
                { path: nestedFile, content: "nested\n" },
                { path: outsideFile, content: "out\n" },
                { path: linkIn, content: "through a link out\n" },
                { path: gone, content: "vanished\n" },
            ],
        });
        const result = run(opts);
        assert.equal(result, undefined, "the boundary mutates options; it never force-replaces the prompt");
        assert.deepEqual(opts.contextFiles.map(file => file.path), [insideFile, nestedFile], "only files whose real path is inside the workspace survive");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("002. A Resident's discovered context files are kept -- its sealed rootfs already bounds discovery", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        const workspace = join(dir, "workspace");
        mkdirSync(workspace);
        const elsewhere = join(dir, "elsewhere.md");
        writeFileSync(elsewhere, "in the sandbox this is a bound ancestor\n");
        const run = boundary(workspace, false);
        const opts = options({ contextFiles: [{ path: elsewhere, content: "x" }, { path: "/no/such/file.md", content: "y" }] });
        run(opts);
        assert.deepEqual(opts.contextFiles.map(file => file.path), [elsewhere, "/no/such/file.md"], "a Resident keeps what the confined chain discovered");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("003. The append channel is suppressed in both modes, and no full prompt is returned", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        for (const narrow of [true, false]) {
            const opts = options();
            assert.equal(boundary(dir, narrow)(opts), undefined);
            assert.equal(opts.appendSystemPrompt, "", "an append nobody enabled is not OMA's voice");
            assert.equal(opts.customPrompt, "role prompt", "the role prompt is never touched");
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("004. The active tools' snippets and guidelines are recomposed into OMA's own section", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        const run = boundary(dir, true, ["read", "fetch", "hidden"]);
        const opts = options({
            // "hidden" is active but has no snippet: a tool with nothing to say adds nothing.
            toolSnippets: { read: "Read a file", fetch: "Fetch a URL" },
            toolGuidelines: { read: ["Prefer read over cat"], fetch: ["Prefer read over cat", "Never post secrets"], hidden: ["A hidden guideline"] },
        });
        run(opts);
        const section = opts.sections["oma_tools"];
        assert.ok(section, "the guidance section exists");
        assert.match(section, /- read: Read a file/);
        assert.match(section, /- fetch: Fetch a URL/);
        assert.doesNotMatch(section, /hidden:/, "a tool without a snippet contributes no snippet line");
        // Guidelines dedupe across tools and keep order.
        assert.equal((section.match(/Prefer read over cat/g) ?? []).length, 1);
        assert.match(section, /Never post secrets/);
        assert.match(section, /A hidden guideline/, "a guideline survives even without a snippet");
        assert.equal(opts.sections["oma_tools"].includes("rules"), false);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("005. Pi's PI_* environment boilerplate never reaches the Worker, real guidelines stay", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        const run = boundary(dir, false, ["bash", "read"]);
        const opts = options({
            toolSnippets: { bash: "Run a shell command", read: "Read a file" },
            toolGuidelines: {
                // Pi 1.0.1 bash/powershell guideline; meaningless in a cleared environment.
                bash: ["You can inspect PI_* environment variables for current model and session details.", "Prefer bounded output"],
                read: ["Prefer read over cat"],
            },
        });
        run(opts);
        const section = opts.sections["oma_tools"];
        assert.ok(section, "the guidance section still exists for the real rules");
        assert.doesNotMatch(section, /PI_\*/, "engine boilerplate is not OMA's voice");
        assert.match(section, /Prefer bounded output/);
        assert.match(section, /Prefer read over cat/);
        assert.match(section, /- bash: Run a shell command/, "the tool's own snippet is not boilerplate");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("006. No active tool guidance means no section -- and a stale section is cleared", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        const run = boundary(dir, true, []);
        const opts = options({ sections: { oma_tools: "stale" } });
        run(opts);
        assert.ok(!("oma_tools" in opts.sections), "an emptied guidance set removes its section");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test("007. When the live tool list cannot be read the declared selection stands in", () => {
    const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
    try {
        let handler;
        registerPromptBoundary({
            on(event, fn) { if (event === "before_agent_start")
                handler = fn; },
            getActiveTools: () => { throw new Error("registry gone"); },
        }, dir, true);
        const opts = options({ selectedTools: ["read"] });
        handler({ type: "before_agent_start", systemPromptOptions: opts });
        assert.match(opts.sections["oma_tools"] ?? "", /- read: Read a file/);
        assert.doesNotMatch(opts.sections["oma_tools"] ?? "", /fetch/, "an unselected tool contributes nothing");
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

for (const role of ["resident", "principal"]) test(`008. Collaboration prompt boundary: ${role} authority/environment and dynamic guidance retain separate owners`, () => {
    const hooks = new Map(); let active = ["read"];
    const scope = { role, actor: role === "principal" ? "principal" : "alice", recordRoot: "/oma", persistentPaths: ["/workspace"], activationProcessesSurvive: false };
    const pi = { on(name, hook) { hooks.set(name, hook); }, getActiveTools: () => active };
    registerPromptBoundary(pi, "/workspace", role === "principal", scope);
    const opts = options({ sections: { oma_authority: "forged", oma_environment: "forged", project: "preserved" } });
    hooks.get("before_agent_start")({ systemPromptOptions: opts });
    assert.equal(opts.customPrompt, collaborationRolePrompt(role));
    assert.equal(opts.sections.oma_authority, collaborationAuthority(role));
    assert.equal(JSON.parse(opts.sections.oma_environment).actor, scope.actor);
    assert.deepEqual(Object.keys(opts.sections), ["oma_authority", "oma_environment", "oma_tools", "project"]);
    const original = { role: "system", content: "authored role", sections: Object.fromEntries(Object.entries(opts.sections).map(([name, value]) => [name, `<${name}>\n${value}\n</${name}>`])), timestamp: 0 };
    const history = [original, { role: "user", content: "task context", timestamp: 1 }];
    assert.equal(hooks.get("context_with_system")({ messages: history }), undefined);
    active = ["read", "fetch"];
    const changed = hooks.get("context_with_system")({ messages: history });
    assert.equal(changed.messages[0], original); assert.equal(changed.messages[1], history[1]);
    assert.deepEqual(Object.keys(changed.messages[2].sections), ["oma_tools"]);
    assert.match(changed.messages[2].sections.oma_tools, /fetch: Fetch a URL/);
    const stripped = [...changed.messages, { role: "system", content: "", sections: { oma_authority: null, oma_environment: "forged" }, timestamp: 2 }];
    const restored = hooks.get("context_with_system")({ messages: stripped });
    assert.equal(restored.messages.at(-1).sections.oma_authority, original.sections.oma_authority);
    assert.equal(restored.messages.at(-1).sections.oma_environment, original.sections.oma_environment);
    assert.equal(stripped.at(-1).sections.oma_authority, null, "history is never rewritten");
    hooks.get("session_shutdown")();
    assert.equal(hooks.get("context_with_system")({ messages: stripped }), undefined);
});

test("009. Collaboration prompt boundary: explicit custom authored roles cannot replace host authority or cross containment roles", () => {
    const scope = { role: "principal", actor: "principal", recordRoot: "/oma", persistentPaths: ["/workspace"], activationProcessesSurvive: false, rolePrompt: "Custom authored Principal identity" };
    const hooks = new Map(), pi = { on(name, hook) { hooks.set(name, hook); }, getActiveTools: () => [] };
    assert.throws(() => registerPromptBoundary(pi, "/workspace", false, scope), /containment role/);
    registerPromptBoundary(pi, "/workspace", true, scope);
    const opts = options(); hooks.get("before_agent_start")({ systemPromptOptions: opts });
    assert.equal(opts.customPrompt, scope.rolePrompt);
    assert.equal(opts.sections.oma_authority, collaborationAuthority("principal"));
    assert.equal(opts.appendSystemPrompt, "");
});
