/** Bundled pi-hashline-edit-pro (file_edit): the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * registers only the anchored `read` and the three file_edit mutations;
 * reads are admitted through the same boundary the workspace guard applies
 * and writes reach the filesystem only through OMA's shared contained
 * writer — serialization, and the read snapshot's
 * inode-identity check included. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HASHLINE_EDIT_TOOL_NAMES } from "@oma/tool-hashline";
import { WEB_RESEARCH_TOOL_NAMES } from "@oma/tool-web";
import { omaToolNames } from "@oma/extension/mail-tools";
import { LSP_TOOL_NAMES } from "@oma/tool-lsp";
import { parseSurfacePlan } from "@oma/tool-runtime/tool-surface";
import { ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME, encodeToolSurfacePlan, encodedPrincipalToolSurface, encodedResidentToolSurface, planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig } from "@oma/domain/tool-surface";
const BUNDLE_SOURCE = fileURLToPath(new URL("../../packages/tool-hashline/dist/vendor/pi-hashline-edit-pro/", import.meta.url));
test("BL3: the declared role surfaces name only tools that exist, and file_edit groups the three mutations", () => {
    const residentRegistered = new Set([
        "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
        ...omaToolNames(false), ...LSP_TOOL_NAMES, ...HASHLINE_EDIT_TOOL_NAMES,
        // BL4: the bundled pi-web-access research tools.
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the bundled pi-mcp-adapter's single proxy tool -- DIRECT.
        MCP_PROXY_TOOL_NAME,
    ]);
    const resident = planToolSurface(residentToolSurfaceConfig());
    for (const name of [...resident.direct, ...resident.disabled, ...resident.grouped])
        assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
    const fileEdit = resident.groups.find(group => group.name === "file_edit");
    assert.ok(fileEdit, "the resident surface groups file_edit");
    assert.deepEqual([...fileEdit.children].sort(), [...HASHLINE_EDIT_TOOL_NAMES].sort());
    assert.ok(resident.roots.includes("file_edit"), "the file_edit group is reachable from a surface root");
    // The anchored read stays DIRECT under the same name the contained read
    // held — it is a replacement, not a new surface member.
    assert.ok(resident.direct.includes("read"));
    assert.ok(!fileEdit.children.includes("read"), "read is not a file_edit member");
    // The Principal is read-only: no file_edit group, no mutation tools.
    const principalRegistered = new Set([
        "read", "grep", "find", "ls", ...omaToolNames(true), ...LSP_TOOL_NAMES,
        // BL4: the Principal groups the same four research tools.
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the Principal holds the same DIRECT `mcp` proxy tool.
        MCP_PROXY_TOOL_NAME,
        ASK_USER_QUESTION_TOOL_NAME,
    ]);
    const principal = planToolSurface(principalToolSurfaceConfig());
    for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
        assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
    assert.ok(!principal.groups.some(group => group.name === "file_edit"), "the principal surface has no file_edit group");
    assert.ok(!principal.grouped.includes("replace"), "the principal surface never names a mutation tool");
    for (const encoded of [encodedResidentToolSurface(), encodedPrincipalToolSurface()]) {
        const parsed = parseSurfacePlan(encoded);
        assert.equal(parsed.state, "plan");
        if (parsed.state === "plan")
            assert.equal(encoded, encodeToolSurfacePlan({ version: 1, ...parsed.plan }));
    }
});
test("BL3/F5: the bundle check refuses a manifest whose metadata drifted from the declared pins", async () => {
    const specifier = "../../scripts/vendor-pi-hashline.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
                dependencies?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(join(BUNDLE_SOURCE, "manifest.json"), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = structuredClone(manifest);
    driftedReason.generated.divergences["commit.js"].reason = "something other than the declared reason";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/, "a divergence-reason edit is caught");
    const droppedDivergence = structuredClone(manifest);
    delete droppedDivergence.generated.divergences["fs-write.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/, "a dropped divergence record is caught");
    const driftedCommit = structuredClone(manifest);
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/, "a commit drift is caught");
    const driftedDep = structuredClone(manifest);
    driftedDep.generated.dependencies["diff"].version = "0.0.0";
    assert.match(manifestMetadataProblems(driftedDep).join("\n"), /dependenc/, "a dependency pin drift is caught");
});
