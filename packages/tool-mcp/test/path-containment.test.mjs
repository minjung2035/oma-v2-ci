import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const { resolveContainedPath } = await import("../dist/vendor/pi-mcp-adapter/runtime/utils.js");
const { loadClaudePluginBundles } = await import("../dist/vendor/pi-mcp-adapter/runtime/claude-plugin-loader.js");

function temporaryDirectory(t) {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "oma-mcp-containment-")));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test("001. MCP paths accept dot-prefixed child names while rejecting parent traversal", t => {
    const root = temporaryDirectory(t);
    assert.equal(resolveContainedPath(root, "..cache/tool.js"), join(root, "..cache", "tool.js"));
    assert.equal(resolveContainedPath(root, "..tool.js"), join(root, "..tool.js"));
    assert.equal(resolveContainedPath(root, "../outside/tool.js"), null);
    assert.equal(resolveContainedPath(root, "nested/../../outside"), null);
});

test("002. Claude plugin skills accept dot-prefixed child directories and reject escaping links", t => {
    const root = temporaryDirectory(t);
    const plugin = join(root, "plugin");
    const skills = join(plugin, "skills");
    const containedSkill = join(skills, "..notes", "SKILL.md");
    const external = join(root, "external");
    mkdirSync(join(skills, "..notes"), { recursive: true });
    mkdirSync(external);
    writeFileSync(containedSkill, "# Notes\n");
    writeFileSync(join(external, "SKILL.md"), "# Outside\n");
    symlinkSync(external, join(skills, "outside"));

    const loaded = loadClaudePluginBundles(
        [{ path: plugin, skills: true }],
        root,
        () => ({ mcpServers: {} }),
        { skills: true, mcp: false },
    );
    assert.deepEqual(loaded.skillPaths, [containedSkill]);
});
