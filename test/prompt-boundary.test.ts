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
import { registerPromptBoundary } from "../src/pi-extension.js";
import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

/** The mutable prompt options Pi hands to the handler. */
function options(overrides: Partial<NormalizedBuildSystemPromptOptions> = {}): NormalizedBuildSystemPromptOptions {
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
  } as NormalizedBuildSystemPromptOptions;
}

function boundary(workspace: string, narrow: boolean, active: readonly string[] = ["read", "fetch"]): (opts: NormalizedBuildSystemPromptOptions) => unknown {
  let handler!: (event: unknown) => unknown;
  const pi = {
    on(event: string, fn: (event: unknown) => unknown) { if (event === "before_agent_start") handler = fn; },
    getActiveTools: () => [...active],
  };
  registerPromptBoundary(pi as never, workspace, narrow);
  return opts => handler({ type: "before_agent_start", systemPromptOptions: opts });
}

test("C15: the Principal's context files are narrowed to real paths inside its workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
  try {
    const workspace = join(dir, "workspace"); mkdirSync(workspace);
    const insideFile = join(workspace, "AGENTS.md"); writeFileSync(insideFile, "in\n");
    const nested = join(workspace, "sub"); mkdirSync(nested);
    const nestedFile = join(nested, "CLAUDE.md"); writeFileSync(nestedFile, "nested\n");
    const outsideFile = join(dir, "AGENTS.md"); writeFileSync(outsideFile, "out\n");
    const linkIn = join(workspace, "linked.md"); symlinkSync(outsideFile, linkIn);
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
    assert.deepEqual(opts.contextFiles.map(file => file.path), [insideFile, nestedFile],
      "only files whose real path is inside the workspace survive");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("C15: a Resident's discovered context files are kept -- its sealed rootfs already bounds discovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
  try {
    const workspace = join(dir, "workspace"); mkdirSync(workspace);
    const elsewhere = join(dir, "elsewhere.md"); writeFileSync(elsewhere, "in the sandbox this is a bound ancestor\n");
    const run = boundary(workspace, false);
    const opts = options({ contextFiles: [{ path: elsewhere, content: "x" }, { path: "/no/such/file.md", content: "y" }] });
    run(opts);
    assert.deepEqual(opts.contextFiles.map(file => file.path), [elsewhere, "/no/such/file.md"],
      "a Resident keeps what the confined chain discovered");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("C19: the append channel is suppressed in both modes, and no full prompt is returned", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
  try {
    for (const narrow of [true, false]) {
      const opts = options();
      assert.equal(boundary(dir, narrow)(opts), undefined);
      assert.equal(opts.appendSystemPrompt, "", "an append nobody enabled is not OMA's voice");
      assert.equal(opts.customPrompt, "role prompt", "the role prompt is never touched");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("C21: the active tools' snippets and guidelines are recomposed into OMA's own section", () => {
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
    assert.equal(opts.sections["oma_tools"]!.includes("rules"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("C21: no active tool guidance means no section -- and a stale section is cleared", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
  try {
    const run = boundary(dir, true, []);
    const opts = options({ sections: { oma_tools: "stale" } });
    run(opts);
    assert.ok(!("oma_tools" in opts.sections), "an emptied guidance set removes its section");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("C21: when the live tool list cannot be read the declared selection stands in", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pb-"));
  try {
    let handler!: (event: unknown) => unknown;
    registerPromptBoundary({
      on(event: string, fn: (event: unknown) => unknown) { if (event === "before_agent_start") handler = fn; },
      getActiveTools: () => { throw new Error("registry gone"); },
    } as never, dir, true);
    const opts = options({ selectedTools: ["read"] });
    handler({ type: "before_agent_start", systemPromptOptions: opts });
    assert.match(opts.sections["oma_tools"] ?? "", /- read: Read a file/);
    assert.doesNotMatch(opts.sections["oma_tools"] ?? "", /fetch/, "an unselected tool contributes nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
