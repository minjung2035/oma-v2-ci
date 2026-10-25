/** Bundled pi-lsp (code_intel): the vendored payload is verified
 * byte-for-byte before tools register; the adapter pins OMA's workspace
 * root, keeps upstream's per-call process lifecycle, reports a missing
 * server as unavailable rather than clean, and lets `lsp_fix` reach the
 * filesystem only through OMA's contained writer. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LSP_TOOL_NAMES } from "@oma/tool-lsp";
import { WEB_RESEARCH_TOOL_NAMES } from "@oma/tool-web";
import { omaToolNames } from "@oma/extension/mail-tools";
import { parseSurfacePlan } from "@oma/tool-runtime/tool-surface";
import { ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME, encodeToolSurfacePlan, encodedPrincipalToolSurface, encodedResidentToolSurface, planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig } from "@oma/domain/tool-surface";
test("BL1: the declared role surfaces name only tools that exist, and code_intel groups the three", () => {
    // What each engine's registry holds: the builtins its argv keeps, OMA's own
    // tools for the role, and the vendored lsp_* tools. The plan's every named
    // reference must be among them -- the extension refuses startup otherwise.
    const residentRegistered = new Set([
        "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
        ...omaToolNames(false), ...LSP_TOOL_NAMES,
        // BL3: the bundled hashline editor's file_edit members.
        "replace", "replace_within", "insert",
        // BL4: the bundled pi-web-access research tools.
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the bundled pi-mcp-adapter's single proxy tool -- DIRECT.
        MCP_PROXY_TOOL_NAME,
    ]);
    const resident = planToolSurface(residentToolSurfaceConfig());
    const residentNamed = [...resident.direct, ...resident.disabled, ...resident.grouped];
    for (const name of residentNamed)
        assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
    assert.deepEqual(resident.groups.map(group => group.name), ["code_intel", "file_edit", "web_research"]);
    assert.deepEqual([...resident.groups[0]!.children].sort(), [...LSP_TOOL_NAMES].sort());
    assert.deepEqual([...resident.groups[1]!.children].sort(), ["insert", "replace", "replace_within"]);
    assert.deepEqual([...resident.groups[2]!.children].sort(), [...WEB_RESEARCH_TOOL_NAMES].sort());
    const principalRegistered = new Set([
        "read", "grep", "find", "ls", // host argv excludes bash/powershell/write/edit
        ...omaToolNames(true), ...LSP_TOOL_NAMES,
        // BL4: the Principal groups the same four research tools.
        ...WEB_RESEARCH_TOOL_NAMES,
        // BL5: the Principal holds the same DIRECT `mcp` proxy tool.
        MCP_PROXY_TOOL_NAME,
        // BL2: the channel-attached engine registers ask_user_question; a
        // Resident/Worker registry never holds it and its plan never names it.
        ASK_USER_QUESTION_TOOL_NAME,
    ]);
    const principal = planToolSurface(principalToolSurfaceConfig());
    for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
        assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
    // Encoded plans round-trip through the extension-side parser unchanged.
    for (const encoded of [encodedResidentToolSurface(), encodedPrincipalToolSurface()]) {
        const parsed = parseSurfacePlan(encoded);
        assert.equal(parsed.state, "plan");
        if (parsed.state === "plan")
            assert.equal(encoded, encodeToolSurfacePlan({ version: 1, ...parsed.plan }));
    }
    // The two surfaces are not interchangeable: the resident surface names the
    // worker-only tools, the principal's names the principal-only ones.
    assert.ok(resident.direct.includes("oma_mail_ack") && resident.direct.includes("write"));
    assert.ok(principal.direct.includes("oma_society") && !principal.direct.includes("write"));
});
// ---------------------------------------------------------------------------
// F3: nothing vendored evaluates before verifyVendorBundle has passed.
test("BL1/F3: no compiled extension module statically imports vendored code -- every vendored load sits behind verification", () => {
    // Round 1 scanned lsp-tools.js only; the invariant is the whole compiled
    // extension: any module holding a static vendored edge would evaluate
    // unverified bytes when loaded. Dynamic import() behind verification is
    // the one sanctioned load (the extension-dynamic-load architecture rule
    // enforces the same boundary on sources).
    const extensionDir = fileURLToPath(new URL("../../packages/extension/dist/", import.meta.url));
    const compiledModules: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "vendor")
                    walk(absolute);
            }
            else if (entry.name.endsWith(".js"))
                compiledModules.push(absolute);
        }
    };
    walk(extensionDir);
    const lspDir = fileURLToPath(new URL("../../packages/tool-lsp/dist/", import.meta.url));
    walk(lspDir);
    for (const name of ["tool-runtime", "tool-hashline", "tool-web", "tool-mcp"])
        walk(fileURLToPath(new URL(`../../packages/${name}/dist/`, import.meta.url)));
    assert.ok(compiledModules.length >= 15, `the scan sees the compiled extension modules, got ${compiledModules.length}`);
    for (const file of compiledModules) {
        const name = relative(extensionDir, file);
        const compiled = readFileSync(file, "utf8");
        assert.doesNotMatch(compiled, /^import\s[^;]*["'][^"']*vendor\//m, `${name}: a static vendored import would evaluate before verification`);
        assert.doesNotMatch(compiled, /^export\s[^;]*from\s*["'][^"']*vendor\//m, `${name}: a vendored re-export would evaluate before verification`);
    }
    // And the dynamic imports are still present -- the runtime loads, just late.
    const adapter = readFileSync(join(lspDir, "index.js"), "utf8");
    assert.match(adapter, /import\(["'][^"']*vendor\/pi-lsp\/runtime\//);
});
// ---------------------------------------------------------------------------
// F5: --check verifies the manifest's own metadata, not just file bytes.
test("BL1/F5: the bundle check refuses a manifest whose metadata drifted from the declared pins", async () => {
    // File bytes and the bundle digest were always compared; round 2 adds the
    // manifest's own words: generated.divergences against the script's
    // OMA_DIVERGENCES and package.* against the pinned upstream identity.
    const specifier = "../../scripts/vendor-pi-lsp.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../packages/tool-lsp/dist/vendor/pi-lsp/manifest.json", import.meta.url)), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = structuredClone(manifest);
    driftedReason.generated.divergences["runner.js"].reason = "something other than the declared reason";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/, "a divergence-reason edit is caught");
    const droppedDivergence = structuredClone(manifest);
    delete droppedDivergence.generated.divergences["files.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/, "a dropped divergence record is caught");
    const driftedCommit = structuredClone(manifest);
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/, "a commit drift is caught");
    const driftedNpm = structuredClone(manifest);
    driftedNpm.package.npm.integrity = "sha512-forged";
    assert.match(manifestMetadataProblems(driftedNpm).join("\n"), /package|pinned/, "an npm integrity drift is caught");
});
