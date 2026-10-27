/** Bundled pi-web-access (web_research): the vendored payload is verified
 * byte-for-byte before tools register; the adapter drives upstream's own
 * extension factory through a facade that admits exactly the four
 * web_research tools; the Society web policy keeps every ambient-
 * discovery escape closed; and the egress pin is the only proxy value the
 * vendored code may carry. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WEB_RESEARCH_TOOL_NAMES } from "@oma/tool-web";
import { omaToolNames } from "@oma/extension/mail-tools";
import { ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME, planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig } from "@oma/domain/tool-surface";
const SRC_BUNDLE = fileURLToPath(new URL("../../packages/tool-web/src/vendor/pi-web-access/", import.meta.url));
test("BL4: the declared role surfaces name only tools that exist, and web_research groups the four", () => {
    const residentRegistered = new Set([
        "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
        ...omaToolNames(false),
        "lsp_diagnostics", "lsp_fix", "lsp_status",
        "replace", "replace_within", "insert",
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the bundled pi-mcp-adapter's single proxy tool -- DIRECT.
        MCP_PROXY_TOOL_NAME,
    ]);
    const resident = planToolSurface(residentToolSurfaceConfig());
    for (const name of [...resident.direct, ...resident.disabled, ...resident.grouped])
        assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
    const webGroup = resident.groups.find(group => group.name === "web_research");
    assert.ok(webGroup, "resident surface has the web_research group");
    assert.deepEqual([...webGroup.children], [...WEB_RESEARCH_TOOL_NAMES]);
    assert.ok(resident.roots.includes("web_research"));
    const principalRegistered = new Set([
        "read", "grep", "find", "ls",
        ...omaToolNames(true),
        "lsp_diagnostics", "lsp_fix", "lsp_status",
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the Principal holds the same DIRECT `mcp` proxy tool.
        MCP_PROXY_TOOL_NAME,
        ASK_USER_QUESTION_TOOL_NAME,
    ]);
    const principal = planToolSurface(principalToolSurfaceConfig());
    for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
        assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
    const principalWeb = principal.groups.find(group => group.name === "web_research");
    assert.ok(principalWeb, "principal surface has the web_research group");
    assert.deepEqual([...principalWeb.children], [...WEB_RESEARCH_TOOL_NAMES]);
});
// ---------------------------------------------------------------------------
// Manifest metadata
test("BL4: manifest metadata binds the pinned identity, dependency closure and divergence table", async () => {
    const specifier = "../../scripts/vendor-pi-web-access.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
                dependencies?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(join(SRC_BUNDLE, "manifest.json"), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = JSON.parse(JSON.stringify(manifest));
    driftedReason.generated.divergences["utils.js"].reason = "hand-edited";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/);
    const droppedDivergence = JSON.parse(JSON.stringify(manifest));
    delete droppedDivergence.generated.divergences["utils.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/);
    const driftedCommit = JSON.parse(JSON.stringify(manifest));
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/);
    const driftedNpm = JSON.parse(JSON.stringify(manifest));
    driftedNpm.package.npm.integrity = "sha512-" + "A".repeat(86);
    assert.match(manifestMetadataProblems(driftedNpm).join("\n"), /package|pinned/);
    const driftedDep = JSON.parse(JSON.stringify(manifest));
    driftedDep.generated.dependencies["undici"].version = "0.0.0";
    assert.match(manifestMetadataProblems(driftedDep).join("\n"), /dependencies|dependency/);
});
