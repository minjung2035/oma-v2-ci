/** Bundled pi-mcp-adapter (the `mcp` proxy tool): the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * drives upstream's own createMcpAdapter factory through a facade that
 * admits exactly `mcp`; the config is OMA-owned and validated; the
 * child-env scrub, egress pin, credential store and scratch lifecycle are
 * OMA's; and Pi's built-in MCP can never coexist. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME, planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig } from "@oma/domain/tool-surface";
import { admittedChildEnv, CHILD_ENV_SCRATCH_NAMES } from "@oma/tool-runtime/child-env";
import { omaToolNames } from "@oma/extension/mail-tools";
import { MCP_TOOL_NAMES, mcpChildEnvironment } from "@oma/tool-mcp";
import { vendoredBundleDir, verifyVendorBundle } from "@oma/tool-runtime/vendor-bundle";
const SRC_BUNDLE = fileURLToPath(new URL("../../packages/tool-mcp/dist/vendor/pi-mcp-adapter/", import.meta.url));
function tmp(t: import("node:test").TestContext, prefix = "oma-mcp-"): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test("BL5: both role surface plans name `mcp` DIRECT and no group wraps it", () => {
    const base = ["read", "write", "edit", "bash", "grep", "find", "ls",
        "lsp_diagnostics", "lsp_fix", "lsp_status", "replace", "replace_within", "insert",
        "web_search", "source_check", "fetch_content", "get_search_content"];
    const residentRegistered = new Set([...base, ...omaToolNames(false), ...MCP_TOOL_NAMES]);
    const resident = planToolSurface(residentToolSurfaceConfig());
    for (const name of [...resident.direct, ...resident.disabled, ...resident.grouped])
        assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
    const principalRegistered = new Set([...base, ...omaToolNames(true), ...MCP_TOOL_NAMES, ASK_USER_QUESTION_TOOL_NAME]);
    const principal = planToolSurface(principalToolSurfaceConfig());
    for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
        assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
    for (const plan of [resident, principal]) {
        assert.ok(plan.direct.includes(MCP_PROXY_TOOL_NAME), "mcp is DIRECT on the surface");
        assert.ok(plan.groups.every(group => !group.children.includes("mcp")), "no OMA grouping layer wraps mcp");
    }
    assert.equal(MCP_PROXY_TOOL_NAME, "mcp", "the domain constant binds the facade's pinned name");
});
test("BL5: every SDK stdio underlay name has an OMA disposition -- a vendored SDK bump cannot silently re-open the ambient leak", async (t) => {
    // SDK_STDIO_ENV_UNDERLAY is generated from the pinned bundle. This test
    // independently checks the generated names against both builds of the
    // vendored SDK's DEFAULT_INHERITED_ENV_VARS. The SDK export is a
    // platform ternary, so one import yields only this host's list; the
    // win32 list would go unobserved on a POSIX runner. Read BOTH branch
    // lists out of the verified vendored bytes (ESM and CJS builds), pin
    // the builds to each other and to the live export for this platform,
    // then require every listed name to carry a disposition: an explicit
    // `undefined` tombstone, a sanctioned carried value, a scratch-owned
    // name, or a name the shared child-env predicate would admit. A bump
    // that adds a name lands in none of those and fails here until the
    // underlay names it -- verified below with OMA_DRIFT_PROBE.
    verifyVendorBundle(SRC_BUNDLE);
    const sdkDist = join(SRC_BUNDLE, "node_modules", "@modelcontextprotocol", "client", "dist");
    const branchLists = (file: string): {
        win32: string[];
        posix: string[];
    } => {
        const source = readFileSync(join(sdkDist, file), "utf8");
        const ternary = /DEFAULT_INHERITED_ENV_VARS\s*=\s*[^?]*\?\s*\[([^\]]*)\]\s*:\s*\[([^\]]*)\]/.exec(source);
        assert.ok(ternary, `${file}: DEFAULT_INHERITED_ENV_VARS platform ternary not found`);
        const names = (list: string): string[] => [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]!);
        return { win32: names(ternary[1]!), posix: names(ternary[2]!) };
    };
    const esm = branchLists("stdio.mjs");
    const cjs = branchLists("stdio.cjs");
    for (const platform of ["win32", "posix"] as const) {
        assert.ok(esm[platform].length > 0, `the vendored SDK's ${platform} underlay list is empty`);
        assert.deepEqual([...cjs[platform]].sort(), [...esm[platform]].sort(), `the vendored SDK's ESM and CJS ${platform} underlay lists diverged`);
    }
    // The parse reads the same names the SDK itself would export on this
    // host -- the static read is pinned to the live module, not to a guess.
    const live = await import(join(vendoredBundleDir("pi-mcp-adapter", new URL("../../packages/tool-mcp/dist/", import.meta.url)), "node_modules", "@modelcontextprotocol", "client", "dist", "stdio.mjs")) as {
        DEFAULT_INHERITED_ENV_VARS: string[];
    };
    assert.deepEqual([...live.DEFAULT_INHERITED_ENV_VARS].sort(), [...esm[process.platform === "win32" ? "win32" : "posix"]].sort(), "the live SDK export does not match the vendored bytes this host runs");
    const env = mcpChildEnvironment({}, join(tmp(t), "scratch"));
    const undisposed = (names: Iterable<string>): string[] => [...names].filter(name => {
        const tombstoned = Object.hasOwn(env, name) && env[name] === undefined;
        const carried = typeof env[name] === "string";
        const sanctioned = CHILD_ENV_SCRATCH_NAMES.includes(name) ||
            admittedChildEnv(name, "oma-env-disposition-probe");
        return !tombstoned && !carried && !sanctioned;
    });
    assert.deepEqual(undisposed(new Set([...esm.win32, ...esm.posix])), [], "an SDK underlay name reaches a child with no tombstone and no sanction -- regenerate the SDK metadata");
    // The oracle fires on the drift it exists for: an underlay name the
    // tombstone list and the scrub both miss is reported, not passed.
    assert.deepEqual(undisposed([...esm.posix, "OMA_DRIFT_PROBE"]), ["OMA_DRIFT_PROBE"], "a vendored bump adding an uncovered underlay name must fail");
});
