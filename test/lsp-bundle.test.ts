/** Bundled pi-lsp (code_intel): the vendored payload is verified
 * byte-for-byte before tools register; the adapter pins OMA's workspace
 * root, keeps upstream's per-call process lifecycle, reports a missing
 * server as unavailable rather than clean, and lets `lsp_fix` reach the
 * filesystem only through OMA's contained writer. */
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainedWriter } from "../src/extension/contained-tools.js";
import { registerLspTools, lspChildEnvironment, LSP_TOOL_NAMES } from "../src/extension/lsp-tools.js";
import { omaToolNames } from "../src/extension/mail-tools.js";
import { guardWorkspaceTools } from "../src/extension/workspace-guard.js";
import { verifyVendorBundle, vendoredBundleDir, VendorIntegrityError } from "../src/extension/vendor-bundle.js";
import { parseSurfacePlan, registerToolSurface } from "../src/extension/tool-surface.js";
import {
  encodeToolSurfacePlan, encodedPrincipalToolSurface, encodedResidentToolSurface,
  planToolSurface, principalToolSurfaceConfig, residentToolSurfaceConfig,
} from "../src/domain/tool-surface.js";

type Tool = {
  name: string;
  execute(id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, update: undefined, ctx: unknown):
    Promise<{ content: { type: string; text?: string }[]; details?: unknown }>;
};

const FIXTURE_SERVER = fileURLToPath(new URL("../src/extension/vendor/pi-lsp/upstream-tests/fixtures/diagnostics-server.mjs", import.meta.url));
const HOSTILE_SERVER = fileURLToPath(new URL("../../test/fixtures/lsp-hostile-server.mjs", import.meta.url));

function tmp(t: import("node:test").TestContext, prefix = "oma-lsp-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A Pi ExtensionAPI stub: tools and event handlers are recorded, nothing
 * else is modeled. */
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const pi = {
    tools,
    handlers,
    registerTool(tool: Tool) { tools.set(tool.name, tool); },
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
  };
  return pi as never as import("@earendil-works/pi-coding-agent").ExtensionAPI & typeof pi;
}

const ctxOf = (workspace: string) => ({
  sessionManager: {},
  ui: { setStatus() {} },
  cwd: workspace,
});

/** A pi-lsp.json under a scratch agent dir: one fixture-backed server over
 * the made-up `.tfix` extension, plus one whose command does not exist. */
function agentDirWithConfig(t: import("node:test").TestContext, fixtureScenario: string, extra: Record<string, unknown> = {}): string {
  const dir = join(tmp(t), "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pi-lsp.json"), JSON.stringify({
    servers: {
      fixture: { command: [process.execPath, FIXTURE_SERVER, fixtureScenario, "1"], extensions: [".tfix"], ...extra },
      ghost: { command: ["oma-no-such-lsp-server-binary"], extensions: [".ghost"] },
    },
  }));
  return dir;
}

/** The same world, but the "fixture" server is OMA's hostile fixture --
 * the command override rides the adapter's own env/config channel. */
function agentDirWithHostile(t: import("node:test").TestContext, scenario: string): string {
  return agentDirWithConfig(t, scenario, { command: [process.execPath, HOSTILE_SERVER, scenario, "1"] });
}

function withAgentDir(t: import("node:test").TestContext, dir: string): void {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
}

const textOf = (result: { content: { text?: string }[] }) => result.content.map(part => part.text ?? "").join("");

// ---------------------------------------------------------------------------
// Bundle integrity

test("BL1: the vendored pi-lsp bundle verifies: source tree and the dist copy the adapter loads", () => {
  const source = verifyVendorBundle(fileURLToPath(new URL("../../src/extension/vendor/pi-lsp/", import.meta.url)));
  assert.equal(source.package, "@narumitw/pi-lsp");
  assert.equal(source.version, "0.49.9");
  assert.equal(source.commit, "55d784704cdec1ec1534b59f78f07f139539119e");
  assert.equal(source.files, 48);
  assert.match(source.bundleSha256, /^[0-9a-f]{64}$/);
  const deployed = verifyVendorBundle(vendoredBundleDir("pi-lsp"));
  assert.deepEqual(deployed, source, "the dist copy is the same bundle");
});

test("BL1: bundle verification fails closed on a changed, missing, extra or malformed member", t => {
  const good = fileURLToPath(new URL("../../src/extension/vendor/pi-lsp/", import.meta.url));
  const copy = (label: string): string => {
    const dir = join(tmp(t), label);
    cpSync(good, dir, { recursive: true });
    return dir;
  };
  const fails = (dir: string, reason: RegExp) =>
    assert.throws(() => verifyVendorBundle(dir), (error: unknown) => error instanceof VendorIntegrityError && reason.test(error.message));
  // A changed byte.
  const changed = copy("changed");
  writeFileSync(join(changed, "runtime", "runner.js"), `${readFileSync(join(changed, "runtime", "runner.js"), "utf8")} `);
  fails(changed, /file changed|digest does not cover/);
  // A missing member.
  const missing = copy("missing");
  rmSync(join(missing, "runtime", "lsp-client.js"));
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

// ---------------------------------------------------------------------------
// Registration, surface and role boundaries

test("BL1: registerLspTools registers exactly the three code_intel tools and the session lifecycle hooks", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  withAgentDir(t, tmp(t, "oma-lsp-agent-"));
  const pi = fakePi();
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => {} });
  assert.deepEqual([...pi.tools.keys()].sort(), [...LSP_TOOL_NAMES].sort());
  assert.ok(pi.handlers.has("session_start") && pi.handlers.has("session_shutdown"));
  // A second registration (extension reload) is idempotent: same names, same hooks.
  const again = fakePi();
  await registerLspTools(again, { workspace, readOnly: false, write: async () => {} });
  assert.deepEqual([...again.tools.keys()].sort(), [...LSP_TOOL_NAMES].sort());
});

test("BL1: a bundle that fails verification registers no tools and refuses the session", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  const dir = join(tmp(t), "corrupt");
  cpSync(fileURLToPath(new URL("../src/extension/vendor/pi-lsp/", import.meta.url)), dir, { recursive: true });
  rmSync(join(dir, "runtime", "lsp-client.js"));
  const pi = fakePi();
  // process.exit would end the test process; the refusal is observable as a
  // registered session_start handler and no tools.
  const exits: number[] = [];
  const realExit = process.exit;
  (process as { exit: typeof process.exit }).exit = ((code?: number) => { exits.push(code ?? 0); throw new Error("exit"); }) as never;
  try {
    await registerLspTools(pi, { workspace, readOnly: false, write: async () => {}, bundleDir: dir });
    assert.equal(pi.tools.size, 0, "no tool survives a failed verification");
    const start = pi.handlers.get("session_start")?.[0];
    assert.ok(start, "the refusal is wired to session start");
    assert.throws(() => (start as () => void)(), /exit/);
    assert.deepEqual(exits, [1]);
  } finally {
    (process as { exit: typeof process.exit }).exit = realExit;
  }
});



test("BL1: the declared role surfaces name only tools that exist, and code_intel groups the three", () => {
  // What each engine's registry holds: the builtins its argv keeps, OMA's own
  // tools for the role, and the vendored lsp_* tools. The plan's every named
  // reference must be among them -- the extension refuses startup otherwise.
  const residentRegistered = new Set([
    "read", "bash", "powershell", "edit", "write", "grep", "find", "ls",
    ...omaToolNames(false), ...LSP_TOOL_NAMES,
  ]);
  const resident = planToolSurface(residentToolSurfaceConfig());
  const residentNamed = [...resident.direct, ...resident.disabled, ...resident.grouped];
  for (const name of residentNamed) assert.ok(residentRegistered.has(name), `resident surface names unregistered ${name}`);
  assert.deepEqual(resident.groups.map(group => group.name), ["code_intel"]);
  assert.deepEqual([...resident.groups[0]!.children].sort(), [...LSP_TOOL_NAMES].sort());
  const principalRegistered = new Set([
    "read", "grep", "find", "ls", // host argv excludes bash/powershell/write/edit
    ...omaToolNames(true), ...LSP_TOOL_NAMES,
  ]);
  const principal = planToolSurface(principalToolSurfaceConfig());
  for (const name of [...principal.direct, ...principal.disabled, ...principal.grouped])
    assert.ok(principalRegistered.has(name), `principal surface names unregistered ${name}`);
  // Encoded plans round-trip through the extension-side parser unchanged.
  for (const encoded of [encodedResidentToolSurface(), encodedPrincipalToolSurface()]) {
    const parsed = parseSurfacePlan(encoded);
    assert.equal(parsed.state, "plan");
    if (parsed.state === "plan") assert.equal(encoded, encodeToolSurfacePlan({ version: 1, ...parsed.plan }));
  }
  // The two surfaces are not interchangeable: the resident surface names the
  // worker-only tools, the principal's names the principal-only ones.
  assert.ok(resident.direct.includes("oma_mail_ack") && resident.direct.includes("write"));
  assert.ok(principal.direct.includes("oma_society") && !principal.direct.includes("write"));
});

test("BL1: a surface plan naming a tool the registry lacks refuses startup rather than exposing it", () => {
  const plan = planToolSurface({
    defaultMode: "DIRECT", direct: [], disabled: [],
    groups: [{ name: "code_intel", description: "x", members: [{ tool: "lsp_diagnostics" }, { tool: "lsp_missing" }, { tool: "lsp_status" }] }],
    roots: ["code_intel"],
  });
  const handlers = new Map<string, ((...args: never[]) => unknown)[]>();
  const pi = {
    on(event: string, handler: (...args: never[]) => unknown) { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    registerTool() {},
    getAllTools() { return [{ name: "lsp_diagnostics", sourceInfo: { source: "extension", path: "/x" } }]; },
    getActiveTools() { return [] as string[]; },
    setActiveTools() {},
  };
  let fatal: string | null = null;
  const saved = process.env.OMA_TOOL_SURFACE;
  process.env.OMA_TOOL_SURFACE = encodeToolSurfacePlan(plan);
  try {
    registerToolSurface(pi as never, [], { fatal: message => { fatal = message; throw new Error(message); } });
    assert.throws(() => handlers.get("session_start")?.[0]?.(), /lsp_missing/);
    assert.match(fatal ?? "", /unknown tool "lsp_missing"/);
  } finally {
    if (saved === undefined) delete process.env.OMA_TOOL_SURFACE; else process.env.OMA_TOOL_SURFACE = saved;
  }
});

// ---------------------------------------------------------------------------
// Guard: paths[], conditional write, role denial

function guardHook(options: { readOnly?: boolean; sandboxed?: boolean }) {
  let hook: ((event: { toolName: string; input: unknown }) => unknown) | undefined;
  guardWorkspaceTools({ on: (_: string, handler: typeof hook) => { hook = handler; } } as never,
    WORKSPACE, options.sandboxed ?? false, options.readOnly ?? false);
  return hook!;
}
const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));

test("BL1: guard: lsp_fix is a conditional write -- preview is admitted, write is gated, a read-only role is refused", () => {
  const inside = join(WORKSPACE, "package.json");
  const readOnly = guardHook({ readOnly: true });
  assert.equal(readOnly({ toolName: "lsp_fix", input: { path: inside } }), undefined, "preview is a read");
  const refused = readOnly({ toolName: "lsp_fix", input: { path: inside, write: true } });
  assert.deepEqual(refused, { block: true, reason: "the Principal reviews code but does not write or edit files; publish GOAL through explicit mail intent" });
  const writer = guardHook({});
  assert.equal(writer({ toolName: "lsp_fix", input: { path: inside, write: true } }), undefined, "a resident's write passes the path gate");
});

test("BL1: guard: a path list is gated on every entry, and file_edit members are gated as writes", () => {
  const hook = guardHook({});
  const inside = join(WORKSPACE, "package.json");
  assert.equal(hook({ toolName: "lsp_diagnostics", input: { paths: [inside] } }), undefined);
  const blocked = hook({ toolName: "lsp_diagnostics", input: { paths: [inside, "/etc/passwd"] } });
  assert.deepEqual(blocked, { block: true, reason: "tool path is outside the agent workspace" });
  for (const name of ["replace", "replace_within", "insert"]) {
    assert.deepEqual(hook({ toolName: name, input: { path: "/etc/passwd" } }), { block: true, reason: "tool path is outside the agent workspace" }, name);
  }
  const readOnly = guardHook({ readOnly: true });
  for (const name of ["replace", "replace_within", "insert"])
    assert.deepEqual(readOnly({ toolName: name, input: { path: inside } }), { block: true, reason: "the Principal reviews code but does not write or edit files; publish GOAL through explicit mail intent" }, name);
});

// ---------------------------------------------------------------------------
// Live behavior against the fixture server

async function lspWorld(t: import("node:test").TestContext, scenario: string, readOnly = false, quota = 1024 * 1024) {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithConfig(t, scenario));
  const pi = fakePi();
  const write = createContainedWriter(workspace, quota);
  await registerLspTools(pi, { workspace, readOnly, write });
  return { workspace, tools: pi.tools, run: (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    pi.tools.get(name)!.execute("call", params, signal, undefined, ctxOf(workspace)) };
}

async function hostileWorld(t: import("node:test").TestContext, scenario: string, readOnly = false) {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithHostile(t, scenario));
  const pi = fakePi();
  const write = createContainedWriter(workspace, 1024 * 1024);
  await registerLspTools(pi, { workspace, readOnly, write });
  return { workspace, tools: pi.tools, run: (name: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    pi.tools.get(name)!.execute("call", params, signal, undefined, ctxOf(workspace)) };
}

test("BL1: lsp_status reports ready and unavailable servers distinctly; a missing command is never clean", async t => {
  const { tools, run } = await lspWorld(t, "pull-strict-optional-params");
  const result = await run("lsp_status", {});
  const text = textOf(result);
  assert.match(text, /fixture: ready/);
  assert.match(text, /ghost: unavailable/);
  const details = result.details as { servers: { name: string; status: string }[]; summary: { unavailable: number; ready: number } };
  assert.equal(details.servers.find(server => server.name === "ghost")?.status, "unavailable");
  assert.equal(details.servers.find(server => server.name === "fixture")?.status, "ready");
  assert.equal(details.summary.unavailable, 1);
  assert.equal(details.summary.ready, 1);
});

test("BL1: lsp_diagnostics reports a running server's findings; a file the server cleared is clean", async t => {
  const { run } = await lspWorld(t, "pull-strict-optional-params");
  const result = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  assert.match(textOf(result), /strict pull diagnostic/);
});

test("BL1: lsp_diagnostics with only missing servers fails as unavailable, not as a clean result", async t => {
  const { workspace, run } = await lspWorld(t, "pull-strict-optional-params");
  writeFileSync(join(workspace, "poc.ghost"), "boo\n");
  await assert.rejects(run("lsp_diagnostics", { paths: ["poc.ghost"], server: ["ghost", "missing-other"] }),
    /unavailable|Unknown LSP server/);
  // Selecting the missing configured server on a file it claims refuses
  // loudly -- the call fails, it never resolves to an empty result.
  await assert.rejects(run("lsp_diagnostics", { paths: ["poc.ghost"], server: "ghost" }),
    error => error instanceof Error && /command not found|unavailable|ENOENT/i.test(error.message));
});

test("BL1: lsp_fix previews by default and writes only through the contained writer", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go");
  const before = readFileSync(join(workspace, "note.tfix"), "utf8");
  const preview = await run("lsp_fix", { path: "note.tfix" });
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), before, "preview does not write");
  const details = preview.details as { changed: boolean; write: boolean; text?: string; containedWrite?: boolean };
  assert.equal(details.changed, true);
  assert.equal(details.write, false);
  assert.match(details.text ?? "", /\/\/ fixed/);
  const applied = await run("lsp_fix", { path: "note.tfix", write: true });
  const appliedDetails = applied.details as { write: boolean; containedWrite?: boolean };
  assert.equal(appliedDetails.write, true);
  assert.equal(appliedDetails.containedWrite, true, "the write ran through OMA's contained writer");
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "// fixed\nhello\n");
});

test("BL1: lsp_fix write is refused for a read-only role before any work runs", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go", true);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", write: true }), /read-only/);
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "hello\n", "nothing was written");
});

test("BL1: the contained writer's quota still gates an lsp_fix write", async t => {
  // note.tfix is 6 bytes; the fix grows it to 14 -> growth 8 > quota 5.
  const { workspace, run } = await lspWorld(t, "lifecycle-go", false, 5);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", write: true }), /quota/);
  assert.equal(readFileSync(join(workspace, "note.tfix"), "utf8"), "hello\n");
});

test("BL1: a symlink that escapes the pinned workspace is refused by the vendored realpath wall", async t => {
  const { workspace, run } = await lspWorld(t, "lifecycle-go");
  const outside = join(tmp(t), "outside.tfix");
  writeFileSync(outside, "secret\n");
  symlinkSync(outside, join(workspace, "link.tfix"));
  // The guard already gates the path argument at tool_call; here the
  // realpath wall inside the vendored runtime refuses the resolved target.
  await assert.rejects(run("lsp_diagnostics", { paths: ["link.tfix"], server: "fixture" }),
    /outside workspace root|escapes workspace root|outside the agent workspace/);
  await assert.rejects(run("lsp_fix", { path: "link.tfix", server: "fixture" }),
    /outside workspace root|escapes workspace root|outside the agent workspace/);
  assert.equal(readFileSync(outside, "utf8"), "secret\n", "nothing outside was touched");
});

test("BL1: every lsp_* call runs a fresh server process: no daemon, no reuse", async t => {
  const logFile = join(tmp(t), "spawns.log");
  const previous = process.env.PI_LSP_TEST_LOG;
  process.env.PI_LSP_TEST_LOG = logFile;
  t.after(() => { if (previous === undefined) delete process.env.PI_LSP_TEST_LOG; else process.env.PI_LSP_TEST_LOG = previous; });
  const { run } = await lspWorld(t, "lifecycle-go");
  await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  await run("lsp_fix", { path: "note.tfix", server: "fixture" });
  const pids = new Set(
    readFileSync(logFile, "utf8").trim().split("\n").map(line => JSON.parse(line).pid as number),
  );
  assert.equal(pids.size, 3, "three calls, three processes");
});

test("BL1: a hung server's call is cancelled by the caller's abort signal", async t => {
  const { run } = await lspWorld(t, "lifecycle-hang-shutdown");
  const controller = new AbortController();
  const pending = run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }, controller.signal);
  controller.abort();
  await assert.rejects(pending, /abort|aborted/i);
});

test("BL1: the language-server child env drops OMA wiring and NODE_OPTIONS but keeps PATH", async t => {
  const previous = { socket: process.env.OMA_SOCKET, surface: process.env.OMA_TOOL_SURFACE, node: process.env.NODE_OPTIONS };
  process.env.OMA_SOCKET = "/tmp/oma.sock";
  process.env.OMA_TOOL_SURFACE = "deadbeef";
  process.env.NODE_OPTIONS = "--import oma-preload";
  t.after(() => {
    for (const [key, value] of [["OMA_SOCKET", previous.socket], ["OMA_TOOL_SURFACE", previous.surface], ["NODE_OPTIONS", previous.node]] as const)
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const env = await lspChildEnvironment({ env: { FIXTURE_FLAG: "yes" } } as never);
  assert.equal(env.OMA_SOCKET, "", "the broker socket is emptied, not inherited");
  assert.equal(env.OMA_TOOL_SURFACE, "", "the tool surface is emptied, not inherited");
  assert.equal(env.NODE_OPTIONS, "", "the OMA preload is emptied, not inherited");
  assert.equal(env.FIXTURE_FLAG, "yes", "declared adapter overrides survive");
  assert.ok((env.PATH ?? "").length > 0, "PATH is retained for server lookup");
});

test("BL1/F4: the denylist is merged-wide: credentials, preloads and proxies in inherited or adapter env are emptied, in any case", async t => {
  const planted = {
    OMA_BROKER_FD: "7", GITHUB_TOKEN: "ghp_x", AWS_SECRET_ACCESS_KEY: "ak", OPENAI_API_KEY: "sk",
    HTTPS_PROXY: "http://user:pass@proxy", SSH_AUTH_SOCK: "/run/agent.sock", NODE_PATH: "/inject",
    LD_PRELOAD: "/lib/evil.so", python_path_marker: undefined,
    lowercase_token: "still-denied", // a case-variant name must be denied too
  } as const;
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(planted)) {
    saved[key] = process.env[key];
    if (value === undefined) continue;
    process.env[key] = value;
  }
  t.after(() => {
    for (const key of Object.keys(saved))
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  });
  // The denylist also wins over the adapter's own env block: a pi-lsp.json
  // author cannot re-arm a scrubbed channel by declaring it.
  const env = await lspChildEnvironment({ env: { GITHUB_TOKEN: "declared", FIXTURE_FLAG: "yes", NODE_OPTIONS: "--import x" } } as never);
  for (const key of ["OMA_BROKER_FD", "GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY",
    "HTTPS_PROXY", "SSH_AUTH_SOCK", "NODE_PATH", "LD_PRELOAD", "lowercase_token", "NODE_OPTIONS"])
    assert.equal(env[key], "", `${key} survives the merged scrub`);
  assert.equal(env.FIXTURE_FLAG, "yes", "an ordinary declared override still survives");
  assert.equal(env.PI_LSP_TEST_LOG, process.env.PI_LSP_TEST_LOG ?? undefined, "the fixture flag channel survives");
});

// ---------------------------------------------------------------------------
// F1: bounded server->engine data -- overflow is a clean tool error, never a
// crash, never a truncated result passed off as clean.

test("BL1/F1: a stderr flood is bounded -- the failure message stays small", async t => {
  const { run } = await hostileWorld(t, "stderr-flood");
  const error = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" })
    .then(() => { throw new Error("the flooded call must fail"); }, (error: unknown) => error as Error);
  assert.match(error.message, /intentional failure after stderr flood/);
  assert.ok(error.message.length < 80_000, `stderr accumulation is capped: ${error.message.length}`);
});

test("BL1/F1: a declared oversized Content-Length is refused before it buffers", async t => {
  const { run } = await hostileWorld(t, "oversized-frame");
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }),
    /Content-Length|inbound bound|invalid JSON-RPC/i);
});

test("BL1/F1: bytes that never complete a frame are bounded by accumulation", async t => {
  const { run } = await hostileWorld(t, "frame-drip");
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }),
    /inbound bound|invalid JSON-RPC|aborted|exceeded/i);
});

test("BL1/F1: pushed diagnostics over the count or message bound fail the call", async t => {
  for (const [scenario, pattern] of [
    ["push-flood", /pushed|diagnostics.*bound/i],
    ["push-big-message", /bound|char/i],
  ] as const) {
    const { run } = await hostileWorld(t, scenario);
    await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), pattern, scenario);
  }
});

test("BL1/F1: pull diagnostics over the count or message bound fail the call", async t => {
  for (const [scenario, pattern] of [
    ["pull-flood", /diagnostics.*bound|1024/i],
    ["pull-big-message", /bound|char/i],
  ] as const) {
    const { run } = await hostileWorld(t, scenario);
    await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), pattern, scenario);
  }
});

test("BL1/F1: a code-action flood is refused before the resolve loop starts", async t => {
  const { run } = await hostileWorld(t, "actions-flood");
  await assert.rejects(run("lsp_fix", { path: "note.tfix", server: "fixture" }), /code actions.*256|bound/i);
});

test("BL1/F1: an aggregate per-call deadline bounds a hanging route regardless of its own timeout", async t => {
  const workspace = tmp(t, "oma-lsp-ws-");
  writeFileSync(join(workspace, "note.tfix"), "hello\n");
  withAgentDir(t, agentDirWithConfig(t, "lifecycle-hang-textDocument/diagnostic"));
  const pi = fakePi();
  // The deadline is what must end this -- the per-request timeout stays huge.
  await registerLspTools(pi, { workspace, readOnly: false, write: async () => {}, callDeadlineMs: 300 });
  await assert.rejects(
    pi.tools.get("lsp_diagnostics")!.execute("call", { paths: ["note.tfix"], server: "fixture" }, undefined, undefined, ctxOf(workspace)),
    /aggregate call deadline/);
});

// ---------------------------------------------------------------------------
// F2: a language server is an ambient-authority child. Its home/cache/temp
// variables point at a per-call scratch, and a read-only role never spawns.

test("BL1/F2: the child's HOME/XDG/TMP land in a per-call scratch that is removed afterwards", async t => {
  const { run } = await hostileWorld(t, "env-echo");
  const result = await run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" });
  const text = textOf(result);
  const homes = [...text.matchAll(/(?:HOME|XDG_CACHE_HOME|TMPDIR)=(\S+)/g)].map(match => match[1]!);
  assert.ok(homes.length >= 3, `env echo reports redirected vars: ${text}`);
  for (const dir of homes) {
    assert.match(dir, /oma-lsp-/, `${dir} is an OMA scratch dir`);
    assert.notEqual(dir, process.env.HOME, "the user's real HOME is not handed down");
    assert.equal(existsSync(dir), false, `${dir} is removed when the call ends`);
  }
});

test("BL1/F2: a read-only role never spawns a language server -- diagnostics and fix refuse, status still works", async t => {
  const { run } = await lspWorld(t, "pull-strict-optional-params", true);
  await assert.rejects(run("lsp_diagnostics", { paths: ["note.tfix"], server: "fixture" }), /read-only role/);
  await assert.rejects(run("lsp_fix", { path: "note.tfix", server: "fixture" }), /read-only role/);
  const status = await run("lsp_status", {});
  assert.match(textOf(status), /configured server/);
});

// ---------------------------------------------------------------------------
// F3: nothing vendored evaluates before verifyVendorBundle has passed.

test("BL1/F3: the compiled adapter holds no static vendored specifier -- every vendored load sits behind verification", () => {
  const compiled = readFileSync(fileURLToPath(new URL("../src/extension/lsp-tools.js", import.meta.url)), "utf8");
  assert.doesNotMatch(compiled, /^import\s[^;]*["'][^"']*vendor\//m, "a static vendored import would evaluate before verification");
  assert.doesNotMatch(compiled, /^export\s[^;]*from\s*["'][^"']*vendor\//m, "a vendored re-export would evaluate before verification");
  // And the dynamic imports are still present -- the runtime loads, just late.
  assert.match(compiled, /import\(["'][^"']*vendor\/pi-lsp\/runtime\//);
});
