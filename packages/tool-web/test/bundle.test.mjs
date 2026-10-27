/** Bundled pi-web-access (web_research): the vendored payload is verified
 * byte-for-byte before tools register; the adapter drives upstream's own
 * extension factory through a facade that admits exactly the four
 * web_research tools; the Society web policy keeps every ambient-
 * discovery escape closed; and the egress pin is the only proxy value the
 * vendored code may carry. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerWebTools, WEB_RESEARCH_TOOL_NAMES, webFacadeDropped } from "@oma/tool-web";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "@oma/tool-runtime/vendor-bundle";
const SRC_BUNDLE = fileURLToPath(new URL("../src/vendor/pi-web-access/", import.meta.url));
/** The runtime modules the adapter itself loads: the deployed copy
 * (vendoredBundleDir), NOT the source tree -- importing the source copy
 * would evaluate a second module instance whose policy state the
 * adapter's install never reaches. */
function tmp(t, prefix = "oma-web-") {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
/** A Pi ExtensionAPI stub: tools, event handlers and session plumbing are
 * recorded, nothing else is modeled. */
function fakePi() {
    const tools = new Map();
    const handlers = new Map();
    const appended = [];
    const pi = {
        tools,
        handlers,
        appended,
        registerTool(tool) { tools.set(tool.name, tool); },
        on(event, handler) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
        appendEntry(type, data) { appended.push({ type, data }); },
        sendMessage() { },
        registerCommand() { },
        registerShortcut() { },
        exec() { throw new Error("facade must have refused exec"); },
    };
    return pi;
}
const ctxOf = () => ({
    sessionManager: { getBranch: () => [] },
    ui: { setStatus() { }, notify() { }, setWidget() { }, theme: { fg: (_c, s) => s, bold: (s) => s } },
});
function withAgentDir(t, dir) {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = dir;
    t.after(() => {
        if (previous === undefined)
            delete process.env.PI_CODING_AGENT_DIR;
        else
            process.env.PI_CODING_AGENT_DIR = previous;
    });
}
function withEgress(t, present, port = 47801) {
    const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
    const priorPort = process.env.OMA_EGRESS_PROXY_PORT;
    if (present) {
        process.env.OMA_EGRESS_PROXY_SOCKET = join(tmp(t), "egress.sock");
        process.env.OMA_EGRESS_PROXY_PORT = String(port);
    }
    else {
        delete process.env.OMA_EGRESS_PROXY_SOCKET;
        delete process.env.OMA_EGRESS_PROXY_PORT;
    }
    t.after(() => {
        if (socket === undefined)
            delete process.env.OMA_EGRESS_PROXY_SOCKET;
        else
            process.env.OMA_EGRESS_PROXY_SOCKET = socket;
        if (priorPort === undefined)
            delete process.env.OMA_EGRESS_PROXY_PORT;
        else
            process.env.OMA_EGRESS_PROXY_PORT = priorPort;
    });
}
const textOf = (result) => result.content.map(part => part.text ?? "").join("");
// ---------------------------------------------------------------------------
// Bundle integrity
test("BL4: the vendored pi-web-access bundle verifies: source tree and the dist copy the adapter loads", () => {
    const source = verifyVendorBundle(SRC_BUNDLE);
    assert.equal(source.package, "pi-web-access");
    assert.equal(source.version, "0.35.0");
    assert.equal(source.commit, "72c6e67787d67d8a7d01bf0abf30c072a6112de6");
    assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
    const deployed = verifyVendorBundle(vendoredBundleDir("pi-web-access", new URL("../dist/", import.meta.url)));
    assert.deepEqual(deployed, source, "the dist copy is the same bundle");
    // The runtime dependency closure is inside the verified payload.
    assert.ok(source.files > 10000, "the manifest covers the whole dependency closure");
});
test("BL4: bundle verification fails closed on a changed, missing, extra or malformed member", t => {
    const good = SRC_BUNDLE;
    const copy = (label) => {
        const dir = join(tmp(t), label);
        cpSync(good, dir, { recursive: true });
        return dir;
    };
    const fails = (dir, reason) => assert.throws(() => verifyVendorBundle(dir), (error) => error instanceof VendorIntegrityError && reason.test(error.message));
    // A changed byte.
    const changed = copy("changed");
    writeFileSync(join(changed, "runtime", "index.js"), `${readFileSync(join(changed, "runtime", "index.js"), "utf8")} `);
    fails(changed, /file changed|digest does not cover/);
    // A changed dependency byte.
    const changedDep = copy("changed-dep");
    writeFileSync(join(changedDep, "node_modules", "undici", "package.json"), `${readFileSync(join(changedDep, "node_modules", "undici", "package.json"), "utf8")} `);
    fails(changedDep, /file changed|digest does not cover/);
    // A missing member.
    const missing = copy("missing");
    rmSync(join(missing, "runtime", "utils.js"));
    fails(missing, /file is missing/);
    // An unlisted extra.
    const extra = copy("extra");
    writeFileSync(join(extra, "runtime", "smuggled.js"), "x");
    fails(extra, /unlisted file/);
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
test("BL4: upstream-tests is the vendored commit's own test tree", () => {
    const entries = readdirSync(join(SRC_BUNDLE, "upstream-tests"));
    const tests = entries.filter(name => name.endsWith(".test.mjs"));
    assert.equal(entries.length, 104, "the vendored commit's test/ tree is preserved wholesale");
    assert.equal(tests.length, 102, "102 test files plus the two shared fixtures");
    for (const name of ["ssrf-protection.test.mjs", "credential-source.test.mjs", "ssrf-allow-ranges-config.test.mjs", "isolate-env.mjs"])
        assert.ok(entries.includes(name), `expected upstream test member ${name}`);
});
// ---------------------------------------------------------------------------
// Registration, facade and surface
test("BL4: registerWebTools registers exactly the four web_research tools and forwards only session plumbing", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    const pi = fakePi();
    await registerWebTools(pi);
    assert.deepEqual([...pi.tools.keys()], [...WEB_RESEARCH_TOOL_NAMES], "exactly the four tools, upstream's own order");
    // The facade forwarded the lifecycle hooks (upstream's own session_start/
    // session_tree/session_shutdown plus the run-lifecycle resets) and dropped
    // the rest of the surface.
    for (const event of ["session_start", "session_tree", "session_shutdown"])
        assert.ok(pi.handlers.has(event), `expected a forwarded ${event} hook`);
    assert.deepEqual(webFacadeDropped.filter(entry => entry.kind === "command"), [], "no slash command was registered");
    assert.deepEqual(webFacadeDropped, [], "commands and shortcuts are forwarded");
    // A second registration (extension reload) is idempotent: same names.
    const again = fakePi();
    await registerWebTools(again);
    assert.deepEqual([...again.tools.keys()], [...WEB_RESEARCH_TOOL_NAMES]);
    // web_enable cannot exist: the overlay pins eager activation.
    assert.ok(![...pi.tools.keys()].includes("web_enable"));
});
// Integrity refusal runs against an actual copied owner in test/vendor-owner-binding.test.mjs.

// ---------------------------------------------------------------------------
// The Society web policy: ambient-discovery refusals
test("BL4/DR37: retained cookie, command and ADC credential guards reject hostile env opt-ins", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    const pi = fakePi();
    await registerWebTools(pi);
    const utils = await import("../dist/vendor/pi-web-access/runtime/utils.js");
    const geminiWebConfig = await import("../dist/vendor/pi-web-access/runtime/gemini-web-config.js");
    const credentialSource = await import("../dist/vendor/pi-web-access/runtime/credential-source.js");
    const youtube = await import("../dist/vendor/pi-web-access/runtime/youtube-extract.js");
    const geminiAdc = await import("../dist/vendor/pi-web-access/runtime/gemini-adc.js");
    const video = await import("../dist/vendor/pi-web-access/runtime/video-extract.js");
    // Upstream's env opt-ins cannot open the cookie paths under the policy.
    process.env.PI_ALLOW_BROWSER_COOKIES = "1";
    process.env.FEYNMAN_ALLOW_BROWSER_COOKIES = "1";
    t.after(() => { delete process.env.PI_ALLOW_BROWSER_COOKIES; delete process.env.FEYNMAN_ALLOW_BROWSER_COOKIES; });
    assert.equal(geminiWebConfig.isBrowserCookieAccessAllowed(), false, "browser cookies stay closed");
    // A `!command` credential source refuses before any shell runs.
    await assert.rejects(credentialSource.resolveCredential({ provider: "test", configuredValue: "!echo leaked" }), /E_OMA_COMMAND_CREDENTIAL/);
    // DR37 enables gh CLI integration. Its presence is a host observation,
    // independent of the retained cookie, command and ADC credential guards.
    // The native-media paths are off: no URL classifies as YouTube and the
    // enabled check stays false even if the config enabled it.
    assert.deepEqual(youtube.isYouTubeURL("https://www.youtube.com/watch?v=abc123xyz00"), { isYouTube: true, videoId: "abc123xyz00" });
    assert.equal(youtube.isYouTubeEnabled(), true);
    // The host's ADC file is never probed.
    assert.equal(geminiAdc.isGeminiAdcAvailable(), false, "no Google ADC discovery");
    // A local path or file:// URL is never a fetchable video.
    assert.equal(video.isVideoFile("/tmp/x.mp4"), null);
    assert.equal(video.isVideoFile("file:///tmp/x.mp4"), null);
});
test("BL4: command credential sources fail before a subprocess runs", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    const pi = fakePi();
    await registerWebTools(pi);
    const credentialSource = await import("../dist/vendor/pi-web-access/runtime/credential-source.js");
    // A literal and an $ENV source keep upstream's semantics...
    process.env.OMA_TEST_WEB_TOKEN = "sekret";
    t.after(() => { delete process.env.OMA_TEST_WEB_TOKEN; });
    assert.equal(await credentialSource.resolveCredential({ provider: "test", configuredValue: "literal-token" }), "literal-token");
    assert.equal(await credentialSource.resolveCredential({ provider: "test", configuredValue: "$OMA_TEST_WEB_TOKEN" }), "sekret");
    // ...and the command form refuses before any shell runs.
    await assert.rejects(credentialSource.resolveCredential({ provider: "test", configuredValue: "!cat /etc/passwd" }), /E_OMA_COMMAND_CREDENTIAL/);
});
// ---------------------------------------------------------------------------
// Egress pin
test("BL4: configured and per-call proxies work without egress wiring", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    withEgress(t, false);
    await registerWebTools(fakePi());
    const utils = await import("../dist/vendor/pi-web-access/runtime/utils.js");
    assert.equal(utils.omaEgressPinnedProxy(), null);
    assert.equal(utils.normalizeProxyUrl("http://proxy.example:8080", "proxy"), "http://proxy.example:8080/");
    assert.equal(utils.normalizeProxyUrl("http://127.0.0.1:47801", "proxy"), "http://127.0.0.1:47801/");
    assert.equal(utils.normalizeProxyUrl("", "proxy"), null);
});
test("BL4: explicit proxies remain configurable beside an environment proxy", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    withEgress(t, true, 47813);
    await registerWebTools(fakePi());
    const utils = await import("../dist/vendor/pi-web-access/runtime/utils.js");
    assert.equal(utils.omaEgressPinnedProxy(), "http://127.0.0.1:47813/");
    assert.equal(utils.normalizeProxyUrl("http://proxy.example:8080", "proxy"), "http://proxy.example:8080/");
    assert.equal(utils.normalizeProxyUrl("http://127.0.0.1:47813", "proxy"), "http://127.0.0.1:47813/");
});
// ---------------------------------------------------------------------------
// SSRF and remote-only bounds (upstream's own, kept)
test("BL4: internal targets refuse before any network", async (t) => {
    withAgentDir(t, tmp(t, "oma-web-agent-"));
    const pi = fakePi();
    await registerWebTools(pi);
    const fetchContent = pi.tools.get("fetch_content");
    for (const url of ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data"]) {
        const result = await fetchContent.execute("c", { url }, undefined, undefined, ctxOf());
        assert.match(textOf(result), /Error|Blocked/i, `${url} must not fetch`);
    }
    const asPath = await fetchContent.execute("c", { url: "/etc/passwd" }, undefined, undefined, ctxOf());
    assert.match(textOf(asPath), /Error|Invalid/i, "a bare local path is not a URL");
});
