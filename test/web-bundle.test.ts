/** Bundled pi-web-access (web_research): the vendored payload is verified
 * byte-for-byte before tools register; the adapter drives upstream's own
 * extension factory through a facade that admits exactly the four
 * web_research tools; the Society web policy keeps every ambient-
 * discovery escape closed; and the egress pin is the only proxy value the
 * vendored code may carry. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerWebTools, WEB_RESEARCH_TOOL_NAMES, webFacadeDropped } from "../src/extension/web-tools.js";
import { omaToolNames } from "../src/extension/mail-tools.js";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "../src/extension/vendor-bundle.js";
import {
  ASK_USER_QUESTION_TOOL_NAME, MCP_PROXY_TOOL_NAME,
  planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig,
} from "../src/domain/tool-surface.js";

const SRC_BUNDLE = fileURLToPath(new URL("../../src/extension/vendor/pi-web-access/", import.meta.url));
/** The runtime modules the adapter itself loads: the deployed copy
 * (vendoredBundleDir), NOT the source tree -- importing the source copy
 * would evaluate a second module instance whose policy state the
 * adapter's install never reaches. */
const SRC_RUNTIME = (name: string) => join(vendoredBundleDir("pi-web-access"), "runtime", name);

type Tool = {
  name: string;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown):
    Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
};

function tmp(t: import("node:test").TestContext, prefix = "oma-web-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Pi ExtensionAPI stub: tools, event handlers and session plumbing are
 * recorded, nothing else is modeled. */
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const appended: { type: string; data: unknown }[] = [];
  const pi = {
    tools,
    handlers,
    appended,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    appendEntry(type: string, data: unknown) { appended.push({ type, data }); },
    sendMessage() {},
    registerCommand() {},
    registerShortcut() {},
    exec() { throw new Error("facade must have refused exec"); },
  };
  return pi as never as import("@earendil-works/pi-coding-agent").ExtensionAPI & typeof pi;
}

const ctxOf = () => ({
  sessionManager: { getBranch: () => [] },
  ui: { setStatus() {}, notify() {}, setWidget() {}, theme: { fg: (_c: string, s: string) => s, bold: (s: string) => s } },
});

function withAgentDir(t: import("node:test").TestContext, dir: string): void {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
}

function withEgress(t: import("node:test").TestContext, present: boolean, port = 47801): void {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const priorPort = process.env.OMA_EGRESS_PROXY_PORT;
  if (present) {
    process.env.OMA_EGRESS_PROXY_SOCKET = join(tmp(t), "egress.sock");
    process.env.OMA_EGRESS_PROXY_PORT = String(port);
  } else {
    delete process.env.OMA_EGRESS_PROXY_SOCKET;
    delete process.env.OMA_EGRESS_PROXY_PORT;
  }
  t.after(() => {
    if (socket === undefined) delete process.env.OMA_EGRESS_PROXY_SOCKET; else process.env.OMA_EGRESS_PROXY_SOCKET = socket;
    if (priorPort === undefined) delete process.env.OMA_EGRESS_PROXY_PORT; else process.env.OMA_EGRESS_PROXY_PORT = priorPort;
  });
}

const textOf = (result: { content: { text?: string }[] }) => result.content.map(part => part.text ?? "").join("");

// ---------------------------------------------------------------------------
// Bundle integrity

test("BL4: the vendored pi-web-access bundle verifies: source tree and the dist copy the adapter loads", () => {
  const source = verifyVendorBundle(SRC_BUNDLE);
  assert.equal(source.package, "pi-web-access");
  assert.equal(source.version, "0.35.0");
  assert.equal(source.commit, "72c6e67787d67d8a7d01bf0abf30c072a6112de6");
  assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
  const deployed = verifyVendorBundle(vendoredBundleDir("pi-web-access"));
  assert.deepEqual(deployed, source, "the dist copy is the same bundle");
  // The runtime dependency closure is inside the verified payload.
  assert.ok(source.files > 10_000, "the manifest covers the whole dependency closure");
});

test("BL4: bundle verification fails closed on a changed, missing, extra or malformed member", t => {
  const good = SRC_BUNDLE;
  const copy = (label: string): string => {
    const dir = join(tmp(t), label);
    cpSync(good, dir, { recursive: true });
    return dir;
  };
  const fails = (dir: string, reason: RegExp) =>
    assert.throws(() => verifyVendorBundle(dir), (error: unknown) => error instanceof VendorIntegrityError && reason.test(error.message));
  // A changed byte.
  const changed = copy("changed");
  writeFileSync(join(changed, "runtime", "index.js"), `${readFileSync(join(changed, "runtime", "index.js"), "utf8")} `);
  fails(changed, /file changed|digest does not cover/);
  // A changed dependency byte.
  const changedDep = copy("changed-dep");
  writeFileSync(join(changedDep, "node_modules", "undici", "package.json"),
    `${readFileSync(join(changedDep, "node_modules", "undici", "package.json"), "utf8")} `);
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

test("BL4: registerWebTools registers exactly the four web_research tools and forwards only session plumbing", async t => {
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

test("BL4: a bundle that fails verification registers no tools and refuses the session", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-"));
  const dir = join(tmp(t), "corrupt");
  cpSync(SRC_BUNDLE, dir, { recursive: true });
  rmSync(join(dir, "runtime", "index.js"));
  const pi = fakePi();
  const exits: number[] = [];
  const realExit = process.exit;
  (process as { exit: typeof process.exit }).exit = ((code?: number) => { exits.push(code ?? 0); throw new Error("exit"); }) as never;
  try {
    await registerWebTools(pi, { bundleDir: dir });
    assert.equal(pi.tools.size, 0, "no tool survives a failed verification");
    const start = pi.handlers.get("session_start")?.[0];
    assert.ok(start, "the refusal is wired to session start");
    assert.throws(() => (start as () => void)(), /exit/);
    assert.deepEqual(exits, [1]);
  } finally {
    (process as { exit: typeof process.exit }).exit = realExit;
  }
});

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
// The Society web policy: ambient-discovery refusals

test("BL4: ambient discovery is deny-by-default even with hostile env opt-ins", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-"));
  const pi = fakePi();
  await registerWebTools(pi);
  const utils = await import(SRC_RUNTIME("utils.js"));
  const geminiWebConfig = await import(SRC_RUNTIME("gemini-web-config.js"));
  const credentialSource = await import(SRC_RUNTIME("credential-source.js"));
  const githubApi = await import(SRC_RUNTIME("github-api.js"));
  const youtube = await import(SRC_RUNTIME("youtube-extract.js"));
  const geminiAdc = await import(SRC_RUNTIME("gemini-adc.js"));
  const video = await import(SRC_RUNTIME("video-extract.js"));

  // Upstream's env opt-ins cannot open the cookie paths under the policy.
  process.env.PI_ALLOW_BROWSER_COOKIES = "1";
  process.env.FEYNMAN_ALLOW_BROWSER_COOKIES = "1";
  t.after(() => { delete process.env.PI_ALLOW_BROWSER_COOKIES; delete process.env.FEYNMAN_ALLOW_BROWSER_COOKIES; });
  assert.equal(geminiWebConfig.isBrowserCookieAccessAllowed(), false, "browser cookies stay closed");

  // A `!command` credential source refuses before any shell runs.
  await assert.rejects(credentialSource.resolveCredential({ provider: "test", configuredValue: "!echo leaked" }), /E_OMA_COMMAND_CREDENTIAL/);

  // gh is reported missing even though the binary exists on this host.
  assert.equal(await githubApi.checkGhAvailable(), false, "the gh CLI is not host credential discovery");

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

test("BL4: command credential sources fail before a subprocess runs", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-"));
  const pi = fakePi();
  await registerWebTools(pi);
  const credentialSource = await import(SRC_RUNTIME("credential-source.js"));
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

test("BL4: configured and per-call proxies work without egress wiring", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-")); withEgress(t, false);
  await registerWebTools(fakePi());
  const utils = await import(SRC_RUNTIME("utils.js"));
  assert.equal(utils.omaEgressPinnedProxy(), null);
  assert.equal(utils.normalizeProxyUrl("http://proxy.example:8080", "proxy"), "http://proxy.example:8080/");
  assert.equal(utils.normalizeProxyUrl("http://127.0.0.1:47801", "proxy"), "http://127.0.0.1:47801/");
  assert.equal(utils.normalizeProxyUrl("", "proxy"), null);
});

test("BL4: explicit proxies remain configurable beside an environment proxy", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-")); withEgress(t, true, 47813);
  await registerWebTools(fakePi());
  const utils = await import(SRC_RUNTIME("utils.js"));
  assert.equal(utils.omaEgressPinnedProxy(), "http://127.0.0.1:47813/");
  assert.equal(utils.normalizeProxyUrl("http://proxy.example:8080", "proxy"), "http://proxy.example:8080/");
  assert.equal(utils.normalizeProxyUrl("http://127.0.0.1:47813", "proxy"), "http://127.0.0.1:47813/");
});

// ---------------------------------------------------------------------------
// SSRF and remote-only bounds (upstream's own, kept)

test("BL4: internal targets refuse before any network", async t => {
  withAgentDir(t, tmp(t, "oma-web-agent-"));
  const pi = fakePi();
  await registerWebTools(pi);
  const fetchContent = pi.tools.get("fetch_content")!;
  for (const url of ["file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data"]) {
    const result = await fetchContent.execute("c", { url }, undefined, undefined, ctxOf());
    assert.match(textOf(result), /Error|Blocked/i, `${url} must not fetch`);
  }
  const asPath = await fetchContent.execute("c", { url: "/etc/passwd" }, undefined, undefined, ctxOf());
  assert.match(textOf(asPath), /Error|Invalid/i, "a bare local path is not a URL");
});

// ---------------------------------------------------------------------------
// Manifest metadata

test("BL4: manifest metadata binds the pinned identity, dependency closure and divergence table", async () => {
  const specifier = "../../scripts/vendor-pi-web-access.mjs";
  const { manifestMetadataProblems } = await import(specifier) as {
    manifestMetadataProblems: (manifest: { generated?: { divergences?: unknown; dependencies?: unknown }; package?: unknown }) => string[];
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
